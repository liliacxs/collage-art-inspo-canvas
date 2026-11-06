import { ActiveSelection, Canvas, FabricImage, filters, Path, PencilBrush, util } from 'fabric';
import type { FabricObject, TSimplePathData } from 'fabric';

import { recolorLabels } from '@/editor/effects/clustering';
import { rgbToHex } from '@/editor/effects/colour';
import { applyColourFilter } from '@/editor/effects/palette';
import type { GridSettings } from '@/editor/store/editorStore';
import type { CanvasObject, ColourClustering, CollageDocument, DrawingObject, ImageAsset, ImageObject } from '@/types/editor';

import { ClusteringClient } from './ClusteringClient';

const EPSILON = 0.01;
const CLUSTER_DEBOUNCE_MS = 150;
const CLUSTER_WORKING_MAX_DIMENSION = 400;
const SNAP_THRESHOLD = 8;

export type CanvasTool = 'select' | 'draw' | 'erase';

export interface BrushOptions {
  color: string;
  size: number;
}

export interface DrawingCreatedPayload {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  stroke: string;
  strokeWidth: number;
}

export interface PositionPatch {
  id: string;
  x: number;
  y: number;
}

export interface MergeResult {
  blob: Blob;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasControllerListeners {
  onObjectTransformed: (
    id: string,
    patch: { x: number; y: number; width: number; height: number; rotation: number },
  ) => void;
  // Fired once at the end of a multi-object (ActiveSelection) drag — translation only,
  // since resize/rotate controls are disabled for multi-selections.
  onObjectsTransformed: (patches: PositionPatch[]) => void;
  onSelectionChanged: (ids: string[]) => void;
  onDrawingCreated: (drawing: DrawingCreatedPayload) => void;
  onEraseObject: (id: string) => void;
  // Alt-drag duplicate: reported once, at drag end, alongside the dragged object's own
  // new position — never mid-gesture (see the `pendingAltDuplicateOrigin` comment below).
  onAltDragDuplicate: (
    origin: PositionPatch,
    movedId: string,
    movedPatch: { x: number; y: number; width: number; height: number; rotation: number },
  ) => void;
  onClusteringPaletteComputed: (id: string, palette: string[]) => void;
  onClusteringPendingChanged: (id: string, pending: boolean) => void;
  onPaletteRegenerated: (id: string, palette: string[]) => void;
}

function imageSourceRect(object: ImageObject, asset: ImageAsset | undefined) {
  if (object.crop) return { x: object.crop.x, y: object.crop.y, width: object.crop.width, height: object.crop.height };
  return { x: 0, y: 0, width: asset?.naturalWidth ?? object.width, height: asset?.naturalHeight ?? object.height };
}

interface ClusteringState {
  computeSignature: string; // identifies what `labels` was computed for (asset/crop/colours)
  labels: Uint8Array;
  width: number;
  height: number;
  bakedPaletteKey: string; // the palette currently baked into `clusteredCanvases`
}

// Identifies the cluster *structure* (which pixel belongs to which label) — the
// part only a fresh k-means run can produce. Deliberately excludes the palette:
// editing or applying a palette must NOT re-trigger the worker, only a rebake.
function clusteringComputeSignature(object: ImageObject, clustering: ColourClustering) {
  const crop = object.crop ? `${object.crop.x},${object.crop.y},${object.crop.width}x${object.crop.height}` : 'full';
  return `${object.assetId}|${crop}|${clustering.colours}`;
}

// Identifies what's currently baked into `clusteredCanvases`: the raw palette plus
// the colour filter multiplied over it at bake time.
function bakeKeyFor(palette: string[], colourFilter: string | undefined) {
  return `${palette.join('|')}::${colourFilter ?? ''}`;
}

function drawSourceToImageData(
  image: HTMLImageElement,
  sourceRect: { x: number; y: number; width: number; height: number },
): ImageData {
  const scale = Math.min(1, CLUSTER_WORKING_MAX_DIMENSION / Math.max(sourceRect.width, sourceRect.height));
  const width = Math.max(1, Math.round(sourceRect.width * scale));
  const height = Math.max(1, Math.round(sourceRect.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(image, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function filtersSignature(object: ImageObject) {
  return `${object.filters.brightness}|${object.filters.contrast}|${object.filters.saturation}`;
}

// Fabric's 2D filters only read `imageData` off the options object they're given
// (see e.g. Brightness.applyTo2d), so a minimal object covers it without needing
// the full T2DPipelineState (canvas/context/backend) Fabric normally supplies —
// that shape isn't exported from the package anyway.
interface Minimal2dFilter {
  applyTo2d(options: { imageData: ImageData }): void;
}

// Applies brightness/contrast/saturation to a (typically palette-sized) ImageData
// using Fabric's own filter math via applyTo2d, so "regenerate palette" reproduces
// the exact on-screen colour rather than an approximation of it.
function applyImageFiltersToImageData(imageData: ImageData, imageFilters: ImageObject['filters']) {
  const active: Minimal2dFilter[] = [];
  if (imageFilters.brightness !== 0) active.push(new filters.Brightness({ brightness: imageFilters.brightness }));
  if (imageFilters.contrast !== 0) active.push(new filters.Contrast({ contrast: imageFilters.contrast }));
  if (imageFilters.saturation !== 0) active.push(new filters.Saturation({ saturation: imageFilters.saturation }));
  for (const filter of active) filter.applyTo2d({ imageData });
}

// Fabric's own getScaledWidth()/getScaledHeight() fold strokeWidth into the pre-scale size
// (since strokeUniform defaults to false: displayWidth = (width + strokeWidth) * scaleX).
// Scale must be derived the same way here, or every read-back/re-apply round trip (e.g. on
// every drag) compounds a small inflation into runaway growth.
function drawingIntrinsicSize(fabricObject: FabricObject) {
  return {
    width: (fabricObject.width || 0) + (fabricObject.strokeWidth || 0) || 1,
    height: (fabricObject.height || 0) + (fabricObject.strokeWidth || 0) || 1,
  };
}

// Picks whichever of an object's leading/center/trailing edge lands closest to a
// candidate (grid line, canvas edge/center, another object's edge/center) within
// `threshold`, and returns the resulting snapped position for `pos` — or null if
// nothing is close enough to snap to.
function snapAxis(pos: number, size: number, candidates: number[], threshold: number): number | null {
  const points = [
    { at: pos, offset: 0 },
    { at: pos + size / 2, offset: size / 2 },
    { at: pos + size, offset: size },
  ];
  let best: { dist: number; pos: number } | null = null;
  for (const point of points) {
    for (const candidate of candidates) {
      const dist = Math.abs(point.at - candidate);
      if (dist <= threshold && (!best || dist < best.dist)) best = { dist, pos: candidate - point.offset };
    }
  }
  return best ? best.pos : null;
}

export class CanvasController {
  private canvas: Canvas;
  private listeners: CanvasControllerListeners;
  private objectsById = new Map<string, FabricObject>();
  private idByObject = new WeakMap<FabricObject, string>();
  private pendingIds = new Set<string>();
  private assets: Record<string, ImageAsset> = {};
  private latestObjectsById = new Map<string, CanvasObject>();
  private appliedFilterSignatures = new WeakMap<FabricObject, string>();
  private applyingSelection = false;
  private tool: CanvasTool = 'select';
  private zoom = 1;
  private disposed = false;

  // The selection as last set by React (via `setSelection`), independent of whatever
  // fabric's own ActiveSelection instance currently looks like — `sync()` rebuilds
  // the fabric-level grouping from this on every document change (see `regroupSelection`).
  private currentSelectionIds: string[] = [];
  // Baseline for turning an ActiveSelection's own left/top delta (translation only —
  // resize/rotate controls are disabled on it) into an absolute-coordinate patch for
  // each member, without ever reading a member's own (group-relative) left/top.
  private multiSelectDragOrigin: { left: number; top: number } | null = null;
  // Armed on mouse:down when Alt is held over a single (non-grouped) object; consumed
  // by the next object:modified for that same object. Deliberately NOT acted on until
  // then — writing to the document mid-drag would fight the live drag (see `sync()`).
  private pendingAltDuplicateOrigin: { id: string; x: number; y: number } | null = null;
  private snapEnabled = true;
  private snapGrid: GridSettings = { visible: false, horizontalLines: 0, verticalLines: 0 };

  // Colour clustering: the quantised result is derived, cached runtime state, never
  // written into the document (only `colourClustering.colours`/`palette` are stored).
  // `labels` (which cluster each pixel belongs to) is the expensive, worker-computed
  // part; recolouring labels through a palette is cheap and redone on the main
  // thread whenever the palette changes (edited by hand, or a different one
  // applied), without re-running k-means.
  private originalImageElements = new Map<string, HTMLImageElement>();
  private clusteredCanvases = new Map<string, HTMLCanvasElement>();
  private clusteringState = new Map<string, ClusteringState>();
  private clusteringRequestByObject = new Map<string, number>();
  private clusteringDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private clusteringClient: ClusteringClient | null = null;

  constructor(el: HTMLCanvasElement, listeners: CanvasControllerListeners) {
    this.listeners = listeners;
    this.canvas = new Canvas(el, { preserveObjectStacking: true });

    this.canvas.on('object:modified', (event) => {
      const target = event.target;
      if (!target) return;

      const altOrigin = this.pendingAltDuplicateOrigin;
      this.pendingAltDuplicateOrigin = null;

      if (target instanceof ActiveSelection) {
        const origin = this.multiSelectDragOrigin;
        this.multiSelectDragOrigin = { left: target.left ?? 0, top: target.top ?? 0 };
        if (!origin) return;
        const dx = (target.left ?? 0) - origin.left;
        const dy = (target.top ?? 0) - origin.top;
        if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return;

        const patches: PositionPatch[] = [];
        for (const member of target.getObjects()) {
          const id = this.idByObject.get(member);
          const original = id ? this.latestObjectsById.get(id) : undefined;
          if (id && original) patches.push({ id, x: original.x + dx, y: original.y + dy });
        }
        if (patches.length) this.listeners.onObjectsTransformed(patches);
        return;
      }

      const id = this.idByObject.get(target);
      if (!id) return;
      const patch = {
        x: target.left ?? 0,
        y: target.top ?? 0,
        width: target.getScaledWidth(),
        height: target.getScaledHeight(),
        rotation: target.angle ?? 0,
      };
      if (altOrigin && altOrigin.id === id) {
        this.listeners.onAltDragDuplicate(altOrigin, id, patch);
      } else {
        this.listeners.onObjectTransformed(id, patch);
      }
    });

    const handleSelection = (selected?: FabricObject[]) => {
      if (this.applyingSelection) return;
      const ids = (selected ?? []).map((t) => this.idByObject.get(t)).filter((id): id is string => !!id);
      this.listeners.onSelectionChanged(ids);
    };
    this.canvas.on('selection:created', (e) => handleSelection(e.selected));
    this.canvas.on('selection:updated', (e) => handleSelection(e.selected));
    this.canvas.on('selection:cleared', () => {
      if (!this.applyingSelection) this.listeners.onSelectionChanged([]);
    });

    this.canvas.on('path:created', (event) => {
      const path = event.path as unknown as InstanceType<typeof Path>;
      this.canvas.remove(path);
      this.listeners.onDrawingCreated({
        path: util.joinPath(path.path as unknown as TSimplePathData),
        x: path.left ?? 0,
        y: path.top ?? 0,
        width: path.getScaledWidth(),
        height: path.getScaledHeight(),
        rotation: path.angle ?? 0,
        stroke: (path.stroke as string) ?? '#000000',
        strokeWidth: path.strokeWidth ?? 1,
      });
    });

    this.canvas.on('mouse:down', (event) => {
      if (this.tool === 'erase') {
        const target = event.target;
        const id = target && this.idByObject.get(target);
        if (id) this.listeners.onEraseObject(id);
        return;
      }

      this.pendingAltDuplicateOrigin = null;
      if (this.tool !== 'select') return;
      const target = event.target;
      const altHeld = (event.e as MouseEvent).altKey ?? false;
      if (!altHeld || !target || target instanceof ActiveSelection) return;
      const id = this.idByObject.get(target);
      const original = id ? this.latestObjectsById.get(id) : undefined;
      if (id && original) this.pendingAltDuplicateOrigin = { id, x: original.x, y: original.y };
    });

    this.canvas.on('mouse:up', () => {
      this.pendingAltDuplicateOrigin = null;
    });

    this.canvas.on('object:moving', (event) => {
      const target = event.target;
      if (!target || target instanceof ActiveSelection) return;
      if (this.snapEnabled) this.applySnap(target, this.idByObject.get(target));
    });
  }

  sync(document: CollageDocument, assets: Record<string, ImageAsset>) {
    if (this.disposed) return;
    this.assets = assets;

    // A live multi-selection groups its members with fabric-internal, group-relative
    // coordinates. Reconciling geometry below always writes absolute document
    // coordinates, so any such grouping must be torn down first — `regroupSelection()`
    // rebuilds it at the end, once every member is back to an absolute position.
    if (this.canvas.getActiveObject() instanceof ActiveSelection) {
      this.applyingSelection = true;
      this.canvas.discardActiveObject();
      this.applyingSelection = false;
    }

    if (this.canvas.width !== document.canvas.width || this.canvas.height !== document.canvas.height) {
      // backstoreOnly: the CSS (on-screen) size is driven separately by `zoom` —
      // a plain setDimensions here would reset it back to 1:1, clobbering zoom.
      this.canvas.setDimensions({ width: document.canvas.width, height: document.canvas.height }, { backstoreOnly: true });
      this.applyZoom();
    }
    if (this.canvas.backgroundColor !== document.canvas.background) {
      this.canvas.backgroundColor = document.canvas.background;
    }

    const currentIds = new Set(document.objects.map((o) => o.id));
    for (const [id, fabricObject] of this.objectsById) {
      if (!currentIds.has(id)) {
        this.canvas.remove(fabricObject);
        this.objectsById.delete(id);
        this.idByObject.delete(fabricObject);
        this.forgetClusteringState(id);
        this.originalImageElements.delete(id);
        this.latestObjectsById.delete(id);
      }
    }

    for (const object of document.objects) {
      this.latestObjectsById.set(object.id, object);
      const existing = this.objectsById.get(object.id);
      if (existing) {
        this.applyPatch(existing, object);
      } else if (!this.pendingIds.has(object.id)) {
        this.pendingIds.add(object.id);
        void this.createFabricObject(object);
      }
    }

    this.applyOrder(document.objects);
    this.regroupSelection();
    this.canvas.requestRenderAll();
  }

  setSelection(ids: string[]) {
    if (this.disposed) return;
    this.currentSelectionIds = ids;
    this.regroupSelection();
    this.canvas.requestRenderAll();
  }

  // Rebuilds fabric's active-object state from `currentSelectionIds` — filtering out
  // any id that no longer exists (deleted/merged away). Always safe to call after any
  // structural change; cheap even though it discards and recreates the ActiveSelection
  // instance every time (see `sync()`'s call site).
  private regroupSelection() {
    const ids = this.currentSelectionIds.filter((id) => this.objectsById.has(id));
    this.applyingSelection = true;
    try {
      if (ids.length === 0) {
        if (this.canvas.getActiveObject()) this.canvas.discardActiveObject();
        this.multiSelectDragOrigin = null;
      } else if (ids.length === 1) {
        const target = this.objectsById.get(ids[0])!;
        if (this.canvas.getActiveObject() !== target) this.canvas.setActiveObject(target);
        this.multiSelectDragOrigin = null;
      } else {
        const targets = ids.map((id) => this.objectsById.get(id)).filter((o): o is FabricObject => !!o);
        const selection = new ActiveSelection(targets, { canvas: this.canvas });
        selection.hasControls = false;
        this.canvas.setActiveObject(selection);
        this.multiSelectDragOrigin = { left: selection.left ?? 0, top: selection.top ?? 0 };
      }
    } finally {
      this.applyingSelection = false;
    }
  }

  setTool(tool: CanvasTool, brush: BrushOptions) {
    if (this.disposed) return;
    this.tool = tool;
    this.canvas.isDrawingMode = tool === 'draw';
    this.canvas.selection = tool === 'select';

    if (tool === 'draw') {
      if (!(this.canvas.freeDrawingBrush instanceof PencilBrush)) {
        this.canvas.freeDrawingBrush = new PencilBrush(this.canvas);
      }
      this.canvas.freeDrawingBrush.color = brush.color;
      this.canvas.freeDrawingBrush.width = brush.size;
    }

    if (tool !== 'select') {
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
    }
  }

  setSnapEnabled(enabled: boolean) {
    this.snapEnabled = enabled;
  }

  setGrid(grid: GridSettings) {
    this.snapGrid = grid;
  }

  // A purely visual (CSS-only) scale: the backstore pixel buffer — and therefore
  // object coordinates, hit-testing, and export — is untouched. Fabric derives
  // pointer positions from the ratio between the CSS size and the backstore size,
  // so drawing/selecting/dragging all keep working correctly at any zoom level.
  setZoom(zoom: number) {
    if (this.disposed) return;
    this.zoom = zoom;
    this.applyZoom();
  }

  private applyZoom() {
    this.canvas.setDimensions(
      { width: this.canvas.width * this.zoom, height: this.canvas.height * this.zoom },
      { cssOnly: true },
    );
  }

  // Exports exactly what's on the Fabric canvas — the grid overlay lives in a
  // separate DOM layer above it (see EditorCanvas), so it's never included here
  // without any extra filtering.
  exportPng(): Promise<Blob | null> {
    return this.canvas.toBlob({ format: 'png', multiplier: 1 });
  }

  // Flattens a set of objects into a single baked PNG, cropped to their combined
  // bounding box. Requires the objects to be at the top level (not mid-grouped in a
  // live ActiveSelection) since `filter` only sees the canvas's top-level objects —
  // any active multi-selection is discarded first, same as `sync()` does.
  async mergeObjects(ids: string[]): Promise<MergeResult | null> {
    if (this.disposed) return null;
    if (this.canvas.getActiveObject() instanceof ActiveSelection) {
      this.applyingSelection = true;
      this.canvas.discardActiveObject();
      this.applyingSelection = false;
      this.canvas.requestRenderAll();
    }

    const idSet = new Set(ids);
    const targets = ids.map((id) => this.objectsById.get(id)).filter((o): o is FabricObject => !!o);
    if (targets.length < 2) return null;

    const rects = targets.map((t) => t.getBoundingRect());
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.left + r.width));
    const bottom = Math.max(...rects.map((r) => r.top + r.height));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return null;

    const blob = await this.canvas.toBlob({
      format: 'png',
      multiplier: 1,
      left,
      top,
      width,
      height,
      filter: (obj) => idSet.has(this.idByObject.get(obj as unknown as FabricObject) ?? ''),
    });
    if (!blob) return null;
    return { blob, x: left, y: top, width, height };
  }

  dispose() {
    this.disposed = true;
    for (const timer of this.clusteringDebounceTimers.values()) clearTimeout(timer);
    this.clusteringDebounceTimers.clear();
    this.clusteringClient?.dispose();
    this.canvas.dispose();
  }

  private async createFabricObject(object: CanvasObject) {
    try {
      const fabricObject =
        object.type === 'image' ? await this.createImageFabricObject(object) : this.createDrawingFabricObject(object);
      if (!fabricObject || this.disposed) return;

      this.objectsById.set(object.id, fabricObject);
      this.idByObject.set(fabricObject, object.id);
      this.canvas.add(fabricObject);
      this.canvas.requestRenderAll();
    } finally {
      this.pendingIds.delete(object.id);
    }
  }

  private async createImageFabricObject(object: ImageObject): Promise<FabricObject | null> {
    const asset = this.assets[object.assetId];
    if (!asset) return null;

    const image = await FabricImage.fromURL(asset.url);
    if (this.disposed) return null;

    image.set({ originX: 'left', originY: 'top' });
    this.originalImageElements.set(object.id, image.getElement() as HTMLImageElement);
    this.applyImageGeometryAndFilters(object.id, image, object, asset);
    return image;
  }

  private createDrawingFabricObject(object: DrawingObject): FabricObject {
    const path = new Path(object.path, {
      left: object.x,
      top: object.y,
      angle: object.rotation,
      opacity: object.opacity,
      originX: 'left',
      originY: 'top',
      visible: object.visible,
      flipX: object.flipX,
      flipY: object.flipY,
      stroke: object.stroke,
      strokeWidth: object.strokeWidth,
      fill: null,
    });
    const intrinsic = drawingIntrinsicSize(path);
    path.set({
      scaleX: object.width / intrinsic.width,
      scaleY: object.height / intrinsic.height,
    });
    return path;
  }

  private applyPatch(fabricObject: FabricObject, object: CanvasObject) {
    if (object.type === 'image') {
      this.applyImageGeometryAndFilters(object.id, fabricObject as FabricImage, object, this.assets[object.assetId]);
    } else {
      applyDrawingPatch(fabricObject, object);
    }
  }

  // The single place image objects reconcile against the document: source element
  // (original asset vs. a cached clustered canvas), crop rect, transform, and
  // filters. Used for both first creation and every later patch so those two paths
  // can never drift apart.
  private applyImageGeometryAndFilters(id: string, image: FabricImage, object: ImageObject, asset: ImageAsset | undefined) {
    // Must run before resolveImageSource(): this is what actually rebakes
    // `clusteredCanvases` for a changed palette (or schedules a worker run for a
    // changed structure). Resolving the source first would read the cache as it
    // stood before this reconcile — one edit behind.
    if (asset) this.reconcileClustering(id, object, asset);
    else this.forgetClusteringState(id);

    const resolved = this.resolveImageSource(id, object, asset);
    if (resolved.element && image.getElement() !== resolved.element) {
      image.setElement(resolved.element, { width: resolved.width, height: resolved.height });
    }

    const scaleX = object.width / resolved.width;
    const scaleY = object.height / resolved.height;

    const changed =
      Math.abs((image.left ?? 0) - object.x) > EPSILON ||
      Math.abs((image.top ?? 0) - object.y) > EPSILON ||
      Math.abs((image.angle ?? 0) - object.rotation) > EPSILON ||
      Math.abs((image.opacity ?? 1) - object.opacity) > EPSILON ||
      Math.abs((image.scaleX ?? 1) - scaleX) > EPSILON ||
      Math.abs((image.scaleY ?? 1) - scaleY) > EPSILON ||
      Math.abs((image.cropX ?? 0) - resolved.cropX) > EPSILON ||
      Math.abs((image.cropY ?? 0) - resolved.cropY) > EPSILON ||
      image.visible !== object.visible ||
      Boolean(image.flipX) !== object.flipX ||
      Boolean(image.flipY) !== object.flipY;

    if (changed) {
      image.set({
        left: object.x,
        top: object.y,
        angle: object.rotation,
        opacity: object.opacity,
        visible: object.visible,
        flipX: object.flipX,
        flipY: object.flipY,
        cropX: resolved.cropX,
        cropY: resolved.cropY,
        width: resolved.width,
        height: resolved.height,
        scaleX,
        scaleY,
      });
      image.setCoords();
    }

    this.applyImageFilters(image, object);
  }

  private resolveImageSource(id: string, object: ImageObject, asset: ImageAsset | undefined) {
    const clustered = object.colourClustering?.enabled ? this.clusteredCanvases.get(id) : undefined;
    if (clustered) {
      return { element: clustered as HTMLImageElement | HTMLCanvasElement, cropX: 0, cropY: 0, width: clustered.width, height: clustered.height };
    }
    const source = imageSourceRect(object, asset);
    return {
      element: this.originalImageElements.get(id) as HTMLImageElement | HTMLCanvasElement | undefined,
      cropX: source.x,
      cropY: source.y,
      width: source.width,
      height: source.height,
    };
  }

  private applyImageFilters(image: FabricImage, object: ImageObject) {
    const signature = filtersSignature(object);
    if (this.appliedFilterSignatures.get(image) === signature) return;
    this.appliedFilterSignatures.set(image, signature);

    const active = [];
    if (object.filters.brightness !== 0) active.push(new filters.Brightness({ brightness: object.filters.brightness }));
    if (object.filters.contrast !== 0) active.push(new filters.Contrast({ contrast: object.filters.contrast }));
    if (object.filters.saturation !== 0) active.push(new filters.Saturation({ saturation: object.filters.saturation }));

    image.filters = active;
    image.applyFilters();
    this.canvas.requestRenderAll();
  }

  // Decides whether the document's clustering state for this object requires a
  // fresh (expensive, worker) k-means run, or just a (cheap, synchronous) rebake of
  // already-computed labels against a changed palette.
  private reconcileClustering(id: string, object: ImageObject, asset: ImageAsset) {
    const clustering = object.colourClustering;
    const existingTimer = this.clusteringDebounceTimers.get(id);

    if (!clustering?.enabled) {
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.clusteringDebounceTimers.delete(id);
      }
      this.clusteringState.delete(id);
      this.clusteredCanvases.delete(id);
      return;
    }

    const computeSignature = clusteringComputeSignature(object, clustering);
    const state = this.clusteringState.get(id);

    if (!state || state.computeSignature !== computeSignature) {
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        this.clusteringDebounceTimers.delete(id);
        void this.runClustering(id, computeSignature, clustering.colours, asset);
      }, CLUSTER_DEBOUNCE_MS);
      this.clusteringDebounceTimers.set(id, timer);
      return;
    }

    const paletteKey = bakeKeyFor(clustering.palette, clustering.colourFilter);
    if (state.bakedPaletteKey !== paletteKey) {
      this.bakeClusteredCanvas(id, state, clustering.palette, clustering.colourFilter);
      state.bakedPaletteKey = paletteKey;
    }
  }

  private async runClustering(id: string, computeSignature: string, colours: number, asset: ImageAsset) {
    const original = this.originalImageElements.get(id);
    const object = this.latestObjectsById.get(id);
    if (!original || !object || object.type !== 'image') return;

    this.listeners.onClusteringPendingChanged(id, true);

    try {
      const sourceRect = imageSourceRect(object, asset);
      const workingImageData = drawSourceToImageData(original, sourceRect);

      const client = this.getClusteringClient();
      const { requestId, promise } = client.compute(workingImageData, colours);
      this.clusteringRequestByObject.set(id, requestId);

      const result = await promise;
      if (this.disposed || this.clusteringRequestByObject.get(id) !== requestId) return;

      const latestObject = this.latestObjectsById.get(id);
      const colourFilter = latestObject?.type === 'image' ? latestObject.colourClustering?.colourFilter : undefined;

      const state: ClusteringState = {
        computeSignature,
        labels: result.labels,
        width: result.width,
        height: result.height,
        bakedPaletteKey: bakeKeyFor(result.palette, colourFilter),
      };
      this.clusteringState.set(id, state);
      this.bakeClusteredCanvas(id, state, result.palette, colourFilter);
      // Writes into the store as object.colourClustering.palette; the next sync()
      // will see bakedPaletteKey already matching it, so this doesn't re-bake.
      this.listeners.onClusteringPaletteComputed(id, result.palette);

      const fabricObject = this.objectsById.get(id);
      // `latestObjectsById` is only refreshed inside sync(), so it doesn't yet know
      // about the palette we just wrote via onClusteringPaletteComputed above —
      // patch it in explicitly, or reconcileClustering would see a stale (possibly
      // empty) palette below and immediately rebake over the one we just baked.
      if (fabricObject && latestObject?.type === 'image' && latestObject.colourClustering) {
        const patchedObject: ImageObject = {
          ...latestObject,
          colourClustering: { ...latestObject.colourClustering, palette: result.palette },
        };
        this.applyImageGeometryAndFilters(id, fabricObject as FabricImage, patchedObject, this.assets[patchedObject.assetId]);
        this.canvas.requestRenderAll();
      }
    } finally {
      this.listeners.onClusteringPendingChanged(id, false);
    }
  }

  // Explicit, on-demand action outside the normal reconcile/debounce cycle:
  // freezes each palette colour's exact current on-screen appearance — the
  // colour filter multiplied in, then brightness/contrast/saturation applied,
  // via Fabric's own filter math — as the new base palette, then resets those
  // adjustments to neutral (left active, they'd apply a second time on top of
  // the now-baked result). This deliberately does NOT re-run k-means: the
  // existing labels (which pixel belongs to which cluster) are reused as-is, so
  // a pixel's colour is guaranteed to match what was already on screen rather
  // than drifting to whatever a fresh best-fit clustering happens to produce.
  regeneratePalette(id: string) {
    const object = this.latestObjectsById.get(id);
    if (!object || object.type !== 'image' || !object.colourClustering?.enabled) return;
    const clustering = object.colourClustering;
    if (clustering.palette.length === 0) return;

    const paletteRgb = applyColourFilter(clustering.palette, clustering.colourFilter);
    const imageData = new ImageData(paletteRgb.length, 1);
    paletteRgb.forEach(([r, g, b], i) => {
      imageData.data[i * 4] = r;
      imageData.data[i * 4 + 1] = g;
      imageData.data[i * 4 + 2] = b;
      imageData.data[i * 4 + 3] = 255;
    });
    applyImageFiltersToImageData(imageData, object.filters);

    const newPalette = paletteRgb.map((_, i) => {
      const offset = i * 4;
      return rgbToHex([imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2]]);
    });

    const state = this.clusteringState.get(id);
    if (state) {
      state.bakedPaletteKey = bakeKeyFor(newPalette, undefined);
      this.bakeClusteredCanvas(id, state, newPalette, undefined);
    }
    // Writes the new palette and resets filters/colourFilter in the store as one
    // update; the next sync() will see bakedPaletteKey already matching it.
    this.listeners.onPaletteRegenerated(id, newPalette);

    const fabricObject = this.objectsById.get(id);
    if (fabricObject) {
      const patchedObject: ImageObject = {
        ...object,
        filters: { brightness: 0, contrast: 0, saturation: 0 },
        colourClustering: { ...clustering, palette: newPalette, colourFilter: undefined },
      };
      this.applyImageGeometryAndFilters(id, fabricObject as FabricImage, patchedObject, this.assets[patchedObject.assetId]);
      this.canvas.requestRenderAll();
    }
  }

  private bakeClusteredCanvas(id: string, state: ClusteringState, palette: string[], colourFilter: string | undefined) {
    const paletteRgb = applyColourFilter(palette, colourFilter);
    const imageData = recolorLabels(state.labels, state.width, state.height, paletteRgb);

    const canvas = document.createElement('canvas');
    canvas.width = state.width;
    canvas.height = state.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(imageData, 0, 0);
    this.clusteredCanvases.set(id, canvas);
  }

  private getClusteringClient(): ClusteringClient {
    if (!this.clusteringClient) this.clusteringClient = new ClusteringClient();
    return this.clusteringClient;
  }

  private forgetClusteringState(id: string) {
    this.clusteredCanvases.delete(id);
    this.clusteringState.delete(id);
    this.clusteringRequestByObject.delete(id);
    const timer = this.clusteringDebounceTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.clusteringDebounceTimers.delete(id);
    }
  }

  private applyOrder(objects: CanvasObject[]) {
    objects.forEach((object, index) => {
      const fabricObject = this.objectsById.get(object.id);
      if (fabricObject) this.canvas.moveObjectTo(fabricObject, index);
    });
  }

  // Single-object drag snapping: candidates are the canvas edges/center, the visible
  // grid lines, and every other object's edges/center — all in the same backstore
  // pixel space as `document` coordinates, so the threshold behaves consistently
  // regardless of zoom (a CSS-only transform, see `setZoom`).
  private applySnap(target: FabricObject, movingId: string | undefined) {
    const width = target.getScaledWidth();
    const height = target.getScaledHeight();
    const canvasWidth = this.canvas.width ?? 0;
    const canvasHeight = this.canvas.height ?? 0;

    const xCandidates = [0, canvasWidth / 2, canvasWidth];
    const yCandidates = [0, canvasHeight / 2, canvasHeight];

    if (this.snapGrid.visible) {
      const { horizontalLines, verticalLines } = this.snapGrid;
      for (let i = 1; i <= verticalLines; i++) xCandidates.push((canvasWidth * i) / (verticalLines + 1));
      for (let i = 1; i <= horizontalLines; i++) yCandidates.push((canvasHeight * i) / (horizontalLines + 1));
    }

    for (const [id, object] of this.latestObjectsById) {
      if (id === movingId) continue;
      xCandidates.push(object.x, object.x + object.width / 2, object.x + object.width);
      yCandidates.push(object.y, object.y + object.height / 2, object.y + object.height);
    }

    const snappedLeft = snapAxis(target.left ?? 0, width, xCandidates, SNAP_THRESHOLD);
    const snappedTop = snapAxis(target.top ?? 0, height, yCandidates, SNAP_THRESHOLD);
    if (snappedLeft !== null || snappedTop !== null) {
      target.set({
        ...(snappedLeft !== null ? { left: snappedLeft } : {}),
        ...(snappedTop !== null ? { top: snappedTop } : {}),
      });
      target.setCoords();
    }
  }
}

function applyDrawingPatch(fabricObject: FabricObject, object: DrawingObject) {
  const intrinsic = drawingIntrinsicSize(fabricObject);
  const targetScaleX = object.width / intrinsic.width;
  const targetScaleY = object.height / intrinsic.height;

  const changed =
    Math.abs((fabricObject.left ?? 0) - object.x) > EPSILON ||
    Math.abs((fabricObject.top ?? 0) - object.y) > EPSILON ||
    Math.abs((fabricObject.angle ?? 0) - object.rotation) > EPSILON ||
    Math.abs((fabricObject.opacity ?? 1) - object.opacity) > EPSILON ||
    Math.abs((fabricObject.scaleX ?? 1) - targetScaleX) > EPSILON ||
    Math.abs((fabricObject.scaleY ?? 1) - targetScaleY) > EPSILON ||
    fabricObject.visible !== object.visible ||
    Boolean(fabricObject.flipX) !== object.flipX ||
    Boolean(fabricObject.flipY) !== object.flipY;

  if (!changed) return;
  fabricObject.set({
    left: object.x,
    top: object.y,
    angle: object.rotation,
    opacity: object.opacity,
    visible: object.visible,
    flipX: object.flipX,
    flipY: object.flipY,
    scaleX: targetScaleX,
    scaleY: targetScaleY,
  });
  fabricObject.setCoords();
}
