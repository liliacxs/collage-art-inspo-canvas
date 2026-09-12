import { Canvas, FabricImage, filters, Path, PencilBrush, util } from 'fabric';
import type { FabricObject, TSimplePathData } from 'fabric';

import type { CanvasObject, ColourClustering, CollageDocument, DrawingObject, ImageAsset, ImageObject } from '@/types/editor';

import { ClusteringClient } from './ClusteringClient';

const EPSILON = 0.01;
const CLUSTER_DEBOUNCE_MS = 150;
const CLUSTER_WORKING_MAX_DIMENSION = 400;

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

export interface CanvasControllerListeners {
  onObjectTransformed: (
    id: string,
    patch: { x: number; y: number; width: number; height: number; rotation: number },
  ) => void;
  onSelectionChanged: (id: string | null) => void;
  onDrawingCreated: (drawing: DrawingCreatedPayload) => void;
  onEraseObject: (id: string) => void;
  onClusteringPaletteComputed: (id: string, palette: string[]) => void;
  onClusteringPendingChanged: (id: string, pending: boolean) => void;
}

function imageSourceRect(object: ImageObject, asset: ImageAsset | undefined) {
  if (object.crop) return { x: object.crop.x, y: object.crop.y, width: object.crop.width, height: object.crop.height };
  return { x: 0, y: 0, width: asset?.naturalWidth ?? object.width, height: asset?.naturalHeight ?? object.height };
}

function clusteringSignature(object: ImageObject, clustering: ColourClustering) {
  const crop = object.crop ? `${object.crop.x},${object.crop.y},${object.crop.width}x${object.crop.height}` : 'full';
  return `${object.assetId}|${crop}|${clustering.colours}`;
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
  private disposed = false;

  // Colour clustering: the quantised result is derived, cached runtime state, never
  // written into the document (only `colourClustering.colours`/`palette` are stored).
  private originalImageElements = new Map<string, HTMLImageElement>();
  private clusteredCanvases = new Map<string, HTMLCanvasElement>();
  private clusteringSignatures = new Map<string, string>();
  private clusteringRequestByObject = new Map<string, number>();
  private clusteringDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private clusteringClient: ClusteringClient | null = null;

  constructor(el: HTMLCanvasElement, listeners: CanvasControllerListeners) {
    this.listeners = listeners;
    this.canvas = new Canvas(el, { preserveObjectStacking: true });

    this.canvas.on('object:modified', (event) => {
      const target = event.target;
      const id = target && this.idByObject.get(target);
      if (!target || !id) return;
      this.listeners.onObjectTransformed(id, {
        x: target.left ?? 0,
        y: target.top ?? 0,
        width: target.getScaledWidth(),
        height: target.getScaledHeight(),
        rotation: target.angle ?? 0,
      });
    });

    const handleSelection = (selected?: FabricObject[]) => {
      if (this.applyingSelection) return;
      const target = selected?.[0];
      const id = target ? this.idByObject.get(target) ?? null : null;
      this.listeners.onSelectionChanged(id);
    };
    this.canvas.on('selection:created', (e) => handleSelection(e.selected));
    this.canvas.on('selection:updated', (e) => handleSelection(e.selected));
    this.canvas.on('selection:cleared', () => {
      if (!this.applyingSelection) this.listeners.onSelectionChanged(null);
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
      if (this.tool !== 'erase') return;
      const target = event.target;
      const id = target && this.idByObject.get(target);
      if (id) this.listeners.onEraseObject(id);
    });
  }

  sync(document: CollageDocument, assets: Record<string, ImageAsset>) {
    if (this.disposed) return;
    this.assets = assets;

    if (this.canvas.width !== document.canvas.width || this.canvas.height !== document.canvas.height) {
      this.canvas.setDimensions({ width: document.canvas.width, height: document.canvas.height });
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
    this.canvas.requestRenderAll();
  }

  setSelection(id: string | null) {
    if (this.disposed) return;
    this.applyingSelection = true;
    try {
      const target = id ? this.objectsById.get(id) : undefined;
      if (target) {
        if (this.canvas.getActiveObject() !== target) this.canvas.setActiveObject(target);
      } else {
        this.canvas.discardActiveObject();
      }
      this.canvas.requestRenderAll();
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
      image.visible !== object.visible;

    if (changed) {
      image.set({
        left: object.x,
        top: object.y,
        angle: object.rotation,
        opacity: object.opacity,
        visible: object.visible,
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

    if (asset) this.scheduleClusteringCompute(id, object, asset);
    else this.forgetClusteringState(id);
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

  private scheduleClusteringCompute(id: string, object: ImageObject, asset: ImageAsset) {
    const clustering = object.colourClustering;
    const existingTimer = this.clusteringDebounceTimers.get(id);

    if (!clustering?.enabled) {
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.clusteringDebounceTimers.delete(id);
      }
      return;
    }

    const signature = clusteringSignature(object, clustering);
    if (this.clusteringSignatures.get(id) === signature) return;

    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.clusteringDebounceTimers.delete(id);
      void this.runClustering(id, signature, clustering.colours, asset);
    }, CLUSTER_DEBOUNCE_MS);
    this.clusteringDebounceTimers.set(id, timer);
  }

  private async runClustering(id: string, signature: string, colours: number, asset: ImageAsset) {
    const original = this.originalImageElements.get(id);
    const object = this.latestObjectsById.get(id);
    if (!original || !object || object.type !== 'image') return;

    this.clusteringSignatures.set(id, signature);
    this.listeners.onClusteringPendingChanged(id, true);

    try {
      const sourceRect = imageSourceRect(object, asset);
      const workingImageData = drawSourceToImageData(original, sourceRect);

      const client = this.getClusteringClient();
      const { requestId, promise } = client.compute(workingImageData, colours);
      this.clusteringRequestByObject.set(id, requestId);

      const result = await promise;
      if (this.disposed || this.clusteringRequestByObject.get(id) !== requestId) return;

      const canvas = document.createElement('canvas');
      canvas.width = result.imageData.width;
      canvas.height = result.imageData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.putImageData(result.imageData, 0, 0);

      this.clusteredCanvases.set(id, canvas);
      this.listeners.onClusteringPaletteComputed(id, result.palette);

      const fabricObject = this.objectsById.get(id);
      const latestObject = this.latestObjectsById.get(id);
      if (fabricObject && latestObject?.type === 'image') {
        this.applyImageGeometryAndFilters(id, fabricObject as FabricImage, latestObject, this.assets[latestObject.assetId]);
        this.canvas.requestRenderAll();
      }
    } finally {
      this.listeners.onClusteringPendingChanged(id, false);
    }
  }

  private getClusteringClient(): ClusteringClient {
    if (!this.clusteringClient) this.clusteringClient = new ClusteringClient();
    return this.clusteringClient;
  }

  private forgetClusteringState(id: string) {
    this.clusteredCanvases.delete(id);
    this.clusteringSignatures.delete(id);
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
    fabricObject.visible !== object.visible;

  if (!changed) return;
  fabricObject.set({
    left: object.x,
    top: object.y,
    angle: object.rotation,
    opacity: object.opacity,
    visible: object.visible,
    scaleX: targetScaleX,
    scaleY: targetScaleY,
  });
  fabricObject.setCoords();
}
