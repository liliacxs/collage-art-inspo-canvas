import { nanoid } from 'nanoid';
import { create } from 'zustand';

import { loadImageDimensions } from '@/lib/image';
import type {
  CanvasObject,
  CanvasObjectBase,
  CollageDocument,
  DrawingObject,
  ImageAsset,
  ImageCrop,
  ImageFilters,
  ImageObject,
} from '@/types/editor';

const MAX_HISTORY = 50;
const MAX_PLACED_DIMENSION = 500;
const DEFAULT_CLUSTER_COLOURS = 12;
const MIN_CLUSTER_COLOURS = 4;
const MAX_CLUSTER_COLOURS = 32;
const MIN_CANVAS_DIMENSION = 50;
const MAX_CANVAS_DIMENSION = 4000;
const MAX_GRID_LINES = 50;
const DUPLICATE_OFFSET = 20;
const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

const initialDocument: CollageDocument = {
  version: 1,
  canvas: { width: 1200, height: 800, background: '#ffffff' },
  objects: [],
};

export type Tool = 'select' | 'draw' | 'erase';
export type AlignMode = 'left' | 'right' | 'centerH' | 'top' | 'bottom' | 'centerV';
export type DistributeAxis = 'horizontal' | 'vertical';
export type FlipAxis = 'horizontal' | 'vertical';

export interface GridSettings {
  visible: boolean;
  horizontalLines: number;
  verticalLines: number;
}

const initialGrid: GridSettings = { visible: false, horizontalLines: 0, verticalLines: 0 };

type TransformPatch = Partial<Pick<CanvasObjectBase, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity' | 'visible' | 'name'>>;

export interface MergedLayerResult {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EditorState {
  document: CollageDocument;
  assets: Record<string, ImageAsset>;
  selectedIds: string[];
  past: CollageDocument[];
  future: CollageDocument[];

  tool: Tool;
  brushColor: string;
  brushSize: number;

  cropTargetId: string | null;

  // Ephemeral: whether a colour-clustering computation is currently running for an
  // object. Lives outside `document` so it is never snapshotted into undo/redo.
  clusteringPending: Record<string, boolean>;

  // Ephemeral: a one-shot signal for CanvasController to regenerate an object's
  // palette. The nonce (not the id alone) is what a listener diffs against, so
  // repeated requests for the same object are still each detected.
  paletteRegenerationRequest: { id: string; nonce: number } | null;

  // Ephemeral: a one-shot signal for CanvasController to flatten a set of objects
  // into a single baked image. Same nonce pattern as palette regeneration.
  mergeRequest: { ids: string[]; nonce: number } | null;

  canvasSettingsOpen: boolean;

  // Ephemeral: purely an editing aid, never part of the exported image, so it's
  // not part of `document` and never pushed to undo history.
  grid: GridSettings;

  // Ephemeral: whether dragging snaps to the grid, canvas edges/center, and other
  // objects' edges. A view/interaction preference, not part of the document.
  snapEnabled: boolean;

  // Ephemeral: a one-shot signal for CanvasController to export the canvas. A
  // plain nonce (no id needed — export always applies to the whole canvas).
  exportRequest: number;

  // Ephemeral: purely a view setting (CSS-only canvas scaling), never part of
  // the document and never pushed to undo history. 1 = 100%.
  zoom: number;

  addImageFile: (file: File) => Promise<void>;
  addDrawing: (drawing: Omit<DrawingObject, 'id' | 'name' | 'opacity' | 'visible' | 'flipX' | 'flipY'>) => void;
  updateObject: (id: string, patch: TransformPatch) => void;
  updateObjectsPositions: (patches: { id: string; x: number; y: number }[]) => void;
  updateImageFilters: (id: string, patch: Partial<ImageFilters>) => void;
  deleteObjects: (ids: string[]) => void;
  deleteObject: (id: string) => void;
  deleteSelected: () => void;
  selectObject: (id: string | null) => void;
  selectObjects: (ids: string[]) => void;
  toggleSelectObject: (id: string) => void;
  toggleVisibility: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  undo: () => void;
  redo: () => void;

  duplicateSelected: () => void;
  // Alt-drag: the object being dragged reports its pre-drag position (`origin`) and
  // its dropped position (`movedPatch`) in one shot, so a clone can be inserted at
  // the origin without ever writing to the document mid-gesture (see CanvasController).
  duplicateAndMove: (
    origin: { id: string; x: number; y: number },
    movedId: string,
    movedPatch: { x: number; y: number; width: number; height: number; rotation: number },
  ) => void;

  flipSelected: (axis: FlipAxis) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  alignSelected: (mode: AlignMode) => void;
  distributeSelected: (axis: DistributeAxis) => void;

  requestMerge: (ids: string[]) => void;
  applyMerge: (ids: string[], result: MergedLayerResult) => void;

  setTool: (tool: Tool) => void;
  setBrushColor: (color: string) => void;
  setBrushSize: (size: number) => void;

  openCrop: (id: string) => void;
  closeCrop: () => void;
  applyCrop: (id: string, crop: ImageCrop) => void;

  setClusteringEnabled: (id: string, enabled: boolean) => void;
  setClusteringColours: (id: string, colours: number) => void;
  setClusteringPalette: (id: string, palette: string[]) => void;
  setClusteringPending: (id: string, pending: boolean) => void;
  setClusteringPaletteColour: (id: string, index: number, hex: string) => void;
  setClusteringColourFilter: (id: string, hex: string | undefined) => void;
  requestPaletteRegeneration: (id: string) => void;
  applyRegeneratedPalette: (id: string, palette: string[]) => void;

  openCanvasSettings: () => void;
  closeCanvasSettings: () => void;
  setCanvasSize: (width: number, height: number) => void;
  setCanvasBackground: (color: string) => void;

  setGridVisible: (visible: boolean) => void;
  setGridHorizontalLines: (count: number) => void;
  setGridVerticalLines: (count: number) => void;
  setSnapEnabled: (enabled: boolean) => void;

  requestExport: () => void;

  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  loadDocument: (document: CollageDocument, assets: Record<string, ImageAsset>) => void;
}

function pushHistory(past: CollageDocument[], current: CollageDocument): CollageDocument[] {
  const next = [...past, current];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

function withObjectUpdate(
  state: Pick<EditorState, 'document' | 'past'>,
  id: string,
  updater: (object: CollageDocument['objects'][number]) => CollageDocument['objects'][number],
): Pick<EditorState, 'document' | 'past' | 'future'> | null {
  const index = state.document.objects.findIndex((o) => o.id === id);
  if (index === -1) return null;
  const objects = [...state.document.objects];
  objects[index] = updater(objects[index]);
  return {
    document: { ...state.document, objects },
    past: pushHistory(state.past, state.document),
    future: [],
  };
}

function withCanvasUpdate(
  state: Pick<EditorState, 'document' | 'past'>,
  updater: (canvas: CollageDocument['canvas']) => CollageDocument['canvas'],
): Pick<EditorState, 'document' | 'past' | 'future'> {
  return {
    document: { ...state.document, canvas: updater(state.document.canvas) },
    past: pushHistory(state.past, state.document),
    future: [],
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.round(Math.max(min, Math.min(max, value)));
}

function clampZoom(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

// Bounding box union of a set of (unrotated) objects — align/distribute deliberately
// work in this simplified space rather than each object's rotated screen bounds, so
// results stay predictable when objects don't share a rotation.
function boundsOf(objects: CanvasObject[]) {
  const minX = Math.min(...objects.map((o) => o.x));
  const minY = Math.min(...objects.map((o) => o.y));
  const maxX = Math.max(...objects.map((o) => o.x + o.width));
  const maxY = Math.max(...objects.map((o) => o.y + o.height));
  return { minX, minY, maxX, maxY };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  document: initialDocument,
  assets: {},
  selectedIds: [],
  past: [],
  future: [],

  tool: 'select',
  brushColor: '#1d4ed8',
  brushSize: 6,

  cropTargetId: null,
  clusteringPending: {},
  paletteRegenerationRequest: null,
  mergeRequest: null,
  canvasSettingsOpen: false,
  grid: initialGrid,
  snapEnabled: true,
  exportRequest: 0,
  zoom: 1,

  addImageFile: async (file) => {
    const url = URL.createObjectURL(file);
    const { width: naturalWidth, height: naturalHeight } = await loadImageDimensions(url);

    const scale = Math.min(1, MAX_PLACED_DIMENSION / Math.max(naturalWidth, naturalHeight));
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;

    const asset: ImageAsset = { id: nanoid(), url, name: file.name, naturalWidth, naturalHeight };
    const { document } = get();
    const object: ImageObject = {
      id: nanoid(),
      type: 'image',
      name: file.name,
      assetId: asset.id,
      x: (document.canvas.width - width) / 2,
      y: (document.canvas.height - height) / 2,
      width,
      height,
      rotation: 0,
      opacity: 1,
      visible: true,
      flipX: false,
      flipY: false,
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    };

    set((state) => ({
      assets: { ...state.assets, [asset.id]: asset },
      document: { ...state.document, objects: [...state.document.objects, object] },
      selectedIds: [object.id],
      past: pushHistory(state.past, state.document),
      future: [],
    }));
  },

  addDrawing: (drawing) => {
    const object: DrawingObject = {
      ...drawing,
      id: nanoid(),
      name: 'Drawing',
      opacity: 1,
      visible: true,
      flipX: false,
      flipY: false,
    };
    set((state) => ({
      document: { ...state.document, objects: [...state.document.objects, object] },
      selectedIds: [object.id],
      past: pushHistory(state.past, state.document),
      future: [],
    }));
  },

  updateObject: (id, patch) => {
    set((state) => withObjectUpdate(state, id, (object) => ({ ...object, ...patch })) ?? state);
  },

  // Quiet, batched position update for a multi-object drag (see CanvasController's
  // ActiveSelection handling) — one history entry for the whole gesture.
  updateObjectsPositions: (patches) => {
    set((state) => {
      if (patches.length === 0) return state;
      const patchById = new Map(patches.map((p) => [p.id, p]));
      let touched = false;
      const objects = state.document.objects.map((o) => {
        const p = patchById.get(o.id);
        if (!p) return o;
        touched = true;
        return { ...o, x: p.x, y: p.y };
      });
      if (!touched) return state;
      return { document: { ...state.document, objects }, past: pushHistory(state.past, state.document), future: [] };
    });
  },

  updateImageFilters: (id, patch) => {
    set((state) => {
      const object = state.document.objects.find((o) => o.id === id);
      if (!object || object.type !== 'image') return state;
      return (
        withObjectUpdate(state, id, (o) => {
          const image = o as ImageObject;
          return { ...image, filters: { ...image.filters, ...patch } };
        }) ?? state
      );
    });
  },

  deleteObjects: (ids) => {
    set((state) => {
      const idSet = new Set(ids);
      if (!state.document.objects.some((o) => idSet.has(o.id))) return state;
      return {
        document: {
          ...state.document,
          objects: state.document.objects.filter((o) => !idSet.has(o.id)),
        },
        selectedIds: state.selectedIds.filter((id) => !idSet.has(id)),
        cropTargetId: state.cropTargetId && idSet.has(state.cropTargetId) ? null : state.cropTargetId,
        past: pushHistory(state.past, state.document),
        future: [],
      };
    });
  },

  deleteObject: (id) => get().deleteObjects([id]),

  deleteSelected: () => {
    const { selectedIds, deleteObjects } = get();
    if (selectedIds.length > 0) deleteObjects(selectedIds);
  },

  selectObject: (id) => set({ selectedIds: id ? [id] : [] }),
  selectObjects: (ids) => set({ selectedIds: [...new Set(ids)] }),
  toggleSelectObject: (id) => {
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((existing) => existing !== id)
        : [...state.selectedIds, id],
    }));
  },

  toggleVisibility: (id) => {
    set((state) => withObjectUpdate(state, id, (o) => ({ ...o, visible: !o.visible })) ?? state);
  },

  bringForward: (id) => {
    set((state) => {
      const objects = [...state.document.objects];
      const index = objects.findIndex((o) => o.id === id);
      if (index === -1 || index === objects.length - 1) return state;
      [objects[index], objects[index + 1]] = [objects[index + 1], objects[index]];
      return {
        document: { ...state.document, objects },
        past: pushHistory(state.past, state.document),
        future: [],
      };
    });
  },

  sendBackward: (id) => {
    set((state) => {
      const objects = [...state.document.objects];
      const index = objects.findIndex((o) => o.id === id);
      if (index <= 0) return state;
      [objects[index], objects[index - 1]] = [objects[index - 1], objects[index]];
      return {
        document: { ...state.document, objects },
        past: pushHistory(state.past, state.document),
        future: [],
      };
    });
  },

  undo: () => {
    set((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        document: previous,
        past: state.past.slice(0, -1),
        future: [state.document, ...state.future],
      };
    });
  },

  redo: () => {
    set((state) => {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        document: next,
        past: pushHistory(state.past, state.document),
        future: rest,
      };
    });
  },

  duplicateSelected: () => {
    set((state) => {
      const idSet = new Set(state.selectedIds);
      const originals = state.document.objects.filter((o) => idSet.has(o.id));
      if (originals.length === 0) return state;
      const clones = originals.map((o) => ({
        ...structuredClone(o),
        id: nanoid(),
        x: o.x + DUPLICATE_OFFSET,
        y: o.y + DUPLICATE_OFFSET,
      }));
      return {
        document: { ...state.document, objects: [...state.document.objects, ...clones] },
        selectedIds: clones.map((c) => c.id),
        past: pushHistory(state.past, state.document),
        future: [],
      };
    });
  },

  duplicateAndMove: (origin, movedId, movedPatch) => {
    set((state) => {
      const index = state.document.objects.findIndex((o) => o.id === movedId);
      if (index === -1) return state;
      const clone = { ...structuredClone(state.document.objects[index]), id: nanoid(), x: origin.x, y: origin.y };
      const objects = [...state.document.objects];
      objects[index] = { ...objects[index], ...movedPatch };
      objects.splice(index, 0, clone);
      return {
        document: { ...state.document, objects },
        past: pushHistory(state.past, state.document),
        future: [],
      };
    });
  },

  flipSelected: (axis) => {
    set((state) => {
      const idSet = new Set(state.selectedIds);
      if (idSet.size === 0) return state;
      const key = axis === 'horizontal' ? 'flipX' : 'flipY';
      const objects = state.document.objects.map((o) => (idSet.has(o.id) ? { ...o, [key]: !o[key] } : o));
      return { document: { ...state.document, objects }, past: pushHistory(state.past, state.document), future: [] };
    });
  },

  nudgeSelected: (dx, dy) => {
    set((state) => {
      const idSet = new Set(state.selectedIds);
      if (idSet.size === 0) return state;
      const objects = state.document.objects.map((o) => (idSet.has(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o));
      return { document: { ...state.document, objects }, past: pushHistory(state.past, state.document), future: [] };
    });
  },

  alignSelected: (mode) => {
    set((state) => {
      const idSet = new Set(state.selectedIds);
      const targets = state.document.objects.filter((o) => idSet.has(o.id));
      if (targets.length < 2) return state;
      const { minX, minY, maxX, maxY } = boundsOf(targets);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const objects = state.document.objects.map((o) => {
        if (!idSet.has(o.id)) return o;
        switch (mode) {
          case 'left':
            return { ...o, x: minX };
          case 'right':
            return { ...o, x: maxX - o.width };
          case 'centerH':
            return { ...o, x: centerX - o.width / 2 };
          case 'top':
            return { ...o, y: minY };
          case 'bottom':
            return { ...o, y: maxY - o.height };
          case 'centerV':
            return { ...o, y: centerY - o.height / 2 };
        }
      });
      return { document: { ...state.document, objects }, past: pushHistory(state.past, state.document), future: [] };
    });
  },

  distributeSelected: (axis) => {
    set((state) => {
      const idSet = new Set(state.selectedIds);
      const targets = state.document.objects.filter((o) => idSet.has(o.id));
      if (targets.length < 3) return state;

      const posKey = axis === 'horizontal' ? 'x' : 'y';
      const sizeKey = axis === 'horizontal' ? 'width' : 'height';
      const sorted = [...targets].sort((a, b) => a[posKey] - b[posKey]);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last[posKey] + last[sizeKey] - first[posKey];
      const totalSize = sorted.reduce((sum, o) => sum + o[sizeKey], 0);
      const gap = (totalSpan - totalSize) / (sorted.length - 1);

      const newPositions = new Map<string, number>();
      let cursor = first[posKey] + first[sizeKey] + gap;
      for (let i = 1; i < sorted.length - 1; i++) {
        newPositions.set(sorted[i].id, cursor);
        cursor += sorted[i][sizeKey] + gap;
      }

      const objects = state.document.objects.map((o) =>
        newPositions.has(o.id) ? { ...o, [posKey]: newPositions.get(o.id)! } : o,
      );
      return { document: { ...state.document, objects }, past: pushHistory(state.past, state.document), future: [] };
    });
  },

  requestMerge: (ids) => {
    if (ids.length < 2) return;
    set((state) => ({ mergeRequest: { ids, nonce: (state.mergeRequest?.nonce ?? 0) + 1 } }));
  },

  applyMerge: (ids, result) => {
    set((state) => {
      const assetId = nanoid();
      const asset: ImageAsset = {
        id: assetId,
        url: result.url,
        name: 'Merged layer',
        naturalWidth: result.width,
        naturalHeight: result.height,
      };
      const mergedObject: ImageObject = {
        id: nanoid(),
        type: 'image',
        name: 'Merged layer',
        assetId,
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
        rotation: 0,
        opacity: 1,
        visible: true,
        flipX: false,
        flipY: false,
        filters: { brightness: 0, contrast: 0, saturation: 0 },
      };
      const idSet = new Set(ids);
      const objects = [...state.document.objects.filter((o) => !idSet.has(o.id)), mergedObject];
      return {
        assets: { ...state.assets, [assetId]: asset },
        document: { ...state.document, objects },
        selectedIds: [mergedObject.id],
        past: pushHistory(state.past, state.document),
        future: [],
      };
    });
  },

  setTool: (tool) => set({ tool }),
  setBrushColor: (brushColor) => set({ brushColor }),
  setBrushSize: (brushSize) => set({ brushSize }),

  openCrop: (id) => set({ cropTargetId: id }),
  closeCrop: () => set({ cropTargetId: null }),

  applyCrop: (id, crop) => {
    set((state) => {
      const object = state.document.objects.find((o) => o.id === id);
      if (!object || object.type !== 'image') return state;
      const image = object as ImageObject;
      const previousCropWidth = image.crop?.width ?? state.assets[image.assetId]?.naturalWidth ?? image.width;
      const previousCropHeight = image.crop?.height ?? state.assets[image.assetId]?.naturalHeight ?? image.height;
      const scaleX = image.width / previousCropWidth;
      const scaleY = image.height / previousCropHeight;

      const updated = withObjectUpdate(state, id, (o) => ({
        ...o,
        width: crop.width * scaleX,
        height: crop.height * scaleY,
        crop,
      }));
      return updated ? { ...updated, cropTargetId: null } : state;
    });
  },

  setClusteringEnabled: (id, enabled) => {
    set((state) => {
      const object = state.document.objects.find((o) => o.id === id);
      if (!object || object.type !== 'image') return state;
      const current = object.colourClustering ?? { enabled: false, colours: DEFAULT_CLUSTER_COLOURS, palette: [] };
      return (
        withObjectUpdate(
          state,
          id,
          (o) => ({ ...o, colourClustering: { ...current, enabled } }) as ImageObject,
        ) ?? state
      );
    });
  },

  setClusteringColours: (id, colours) => {
    const clamped = Math.round(Math.max(MIN_CLUSTER_COLOURS, Math.min(MAX_CLUSTER_COLOURS, colours)));
    set((state) => {
      const object = state.document.objects.find((o) => o.id === id);
      if (!object || object.type !== 'image' || !object.colourClustering) return state;
      const clustering = object.colourClustering;
      return (
        withObjectUpdate(
          state,
          id,
          (o) => ({ ...o, colourClustering: { ...clustering, colours: clamped } }) as ImageObject,
        ) ?? state
      );
    });
  },

  // Quiet update: reflects a background worker computation finishing, not a direct
  // user edit, so it should not create an undo step.
  setClusteringPalette: (id, palette) => {
    set((state) => {
      const index = state.document.objects.findIndex((o) => o.id === id);
      if (index === -1) return state;
      const object = state.document.objects[index];
      if (object.type !== 'image' || !object.colourClustering) return state;
      const objects = [...state.document.objects];
      objects[index] = { ...object, colourClustering: { ...object.colourClustering, palette } };
      return { document: { ...state.document, objects } };
    });
  },

  setClusteringPending: (id, pending) => {
    set((state) => ({ clusteringPending: { ...state.clusteringPending, [id]: pending } }));
  },

  setClusteringPaletteColour: (id, index, hex) => {
    set((state) => {
      const object = state.document.objects.find((o) => o.id === id);
      if (!object || object.type !== 'image' || !object.colourClustering) return state;
      if (index < 0 || index >= object.colourClustering.palette.length) return state;
      const palette = [...object.colourClustering.palette];
      palette[index] = hex;
      const clustering = object.colourClustering;
      return (
        withObjectUpdate(state, id, (o) => ({ ...o, colourClustering: { ...clustering, palette } }) as ImageObject) ?? state
      );
    });
  },

  setClusteringColourFilter: (id, hex) => {
    set((state) => {
      const object = state.document.objects.find((o) => o.id === id);
      if (!object || object.type !== 'image' || !object.colourClustering) return state;
      const clustering = object.colourClustering;
      return (
        withObjectUpdate(
          state,
          id,
          (o) => ({ ...o, colourClustering: { ...clustering, colourFilter: hex } }) as ImageObject,
        ) ?? state
      );
    });
  },

  requestPaletteRegeneration: (id) => {
    set((state) => ({
      paletteRegenerationRequest: { id, nonce: (state.paletteRegenerationRequest?.nonce ?? 0) + 1 },
    }));
  },

  // Folds the current colour filter and brightness/contrast/saturation into a
  // freshly re-clustered palette, then resets those adjustments to neutral —
  // otherwise they'd be applied a second time on top of the now-baked result.
  applyRegeneratedPalette: (id, palette) => {
    set((state) => {
      const object = state.document.objects.find((o) => o.id === id);
      if (!object || object.type !== 'image' || !object.colourClustering) return state;
      const clustering = object.colourClustering;
      return (
        withObjectUpdate(
          state,
          id,
          (o) =>
            ({
              ...o,
              filters: { brightness: 0, contrast: 0, saturation: 0 },
              colourClustering: { ...clustering, palette, colourFilter: undefined },
            }) as ImageObject,
        ) ?? state
      );
    });
  },

  openCanvasSettings: () => set({ canvasSettingsOpen: true }),
  closeCanvasSettings: () => set({ canvasSettingsOpen: false }),

  setCanvasSize: (width, height) => {
    set((state) => {
      const canvas = state.document.canvas;
      const clampedWidth = clampNumber(width, MIN_CANVAS_DIMENSION, MAX_CANVAS_DIMENSION, canvas.width);
      const clampedHeight = clampNumber(height, MIN_CANVAS_DIMENSION, MAX_CANVAS_DIMENSION, canvas.height);
      return withCanvasUpdate(state, (c) => ({ ...c, width: clampedWidth, height: clampedHeight }));
    });
  },

  setCanvasBackground: (color) => {
    set((state) => withCanvasUpdate(state, (c) => ({ ...c, background: color })));
  },

  setGridVisible: (visible) => set((state) => ({ grid: { ...state.grid, visible } })),

  setGridHorizontalLines: (count) => {
    set((state) => ({
      grid: { ...state.grid, horizontalLines: clampNumber(count, 0, MAX_GRID_LINES, state.grid.horizontalLines) },
    }));
  },

  setGridVerticalLines: (count) => {
    set((state) => ({
      grid: { ...state.grid, verticalLines: clampNumber(count, 0, MAX_GRID_LINES, state.grid.verticalLines) },
    }));
  },

  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),

  requestExport: () => set((state) => ({ exportRequest: state.exportRequest + 1 })),

  setZoom: (zoom) => set((state) => ({ zoom: clampZoom(zoom, state.zoom) })),

  zoomIn: () => {
    set((state) => {
      const next = ZOOM_STEPS.find((z) => z > state.zoom + 1e-6);
      return { zoom: next ?? MAX_ZOOM };
    });
  },

  zoomOut: () => {
    set((state) => {
      const next = [...ZOOM_STEPS].reverse().find((z) => z < state.zoom - 1e-6);
      return { zoom: next ?? MIN_ZOOM };
    });
  },

  resetZoom: () => set({ zoom: 1 }),

  loadDocument: (document, assets) => {
    set({
      document,
      assets,
      selectedIds: [],
      past: [],
      future: [],
      cropTargetId: null,
    });
  },
}));

export { NUDGE_STEP, NUDGE_STEP_LARGE };
