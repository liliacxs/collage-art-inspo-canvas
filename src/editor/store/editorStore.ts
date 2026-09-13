import { nanoid } from 'nanoid';
import { create } from 'zustand';

import { loadImageDimensions } from '@/lib/image';
import type {
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

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

const initialDocument: CollageDocument = {
  version: 1,
  canvas: { width: 1200, height: 800, background: '#ffffff' },
  objects: [],
};

export type Tool = 'select' | 'draw' | 'erase';

export interface GridSettings {
  visible: boolean;
  horizontalLines: number;
  verticalLines: number;
}

const initialGrid: GridSettings = { visible: false, horizontalLines: 0, verticalLines: 0 };

type TransformPatch = Partial<Pick<CanvasObjectBase, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity' | 'visible' | 'name'>>;

interface EditorState {
  document: CollageDocument;
  assets: Record<string, ImageAsset>;
  selectedId: string | null;
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

  canvasSettingsOpen: boolean;

  // Ephemeral: purely an editing aid, never part of the exported image, so it's
  // not part of `document` and never pushed to undo history.
  grid: GridSettings;

  // Ephemeral: a one-shot signal for CanvasController to export the canvas. A
  // plain nonce (no id needed — export always applies to the whole canvas).
  exportRequest: number;

  // Ephemeral: purely a view setting (CSS-only canvas scaling), never part of
  // the document and never pushed to undo history. 1 = 100%.
  zoom: number;

  addImageFile: (file: File) => Promise<void>;
  addDrawing: (drawing: Omit<DrawingObject, 'id' | 'name' | 'opacity' | 'visible'>) => void;
  updateObject: (id: string, patch: TransformPatch) => void;
  updateImageFilters: (id: string, patch: Partial<ImageFilters>) => void;
  deleteObject: (id: string) => void;
  deleteSelected: () => void;
  selectObject: (id: string | null) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  undo: () => void;
  redo: () => void;

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

  requestExport: () => void;

  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
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

export const useEditorStore = create<EditorState>((set, get) => ({
  document: initialDocument,
  assets: {},
  selectedId: null,
  past: [],
  future: [],

  tool: 'select',
  brushColor: '#1d4ed8',
  brushSize: 6,

  cropTargetId: null,
  clusteringPending: {},
  paletteRegenerationRequest: null,
  canvasSettingsOpen: false,
  grid: initialGrid,
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
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    };

    set((state) => ({
      assets: { ...state.assets, [asset.id]: asset },
      document: { ...state.document, objects: [...state.document.objects, object] },
      selectedId: object.id,
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
    };
    set((state) => ({
      document: { ...state.document, objects: [...state.document.objects, object] },
      selectedId: object.id,
      past: pushHistory(state.past, state.document),
      future: [],
    }));
  },

  updateObject: (id, patch) => {
    set((state) => withObjectUpdate(state, id, (object) => ({ ...object, ...patch })) ?? state);
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

  deleteObject: (id) => {
    set((state) => ({
      document: {
        ...state.document,
        objects: state.document.objects.filter((o) => o.id !== id),
      },
      selectedId: state.selectedId === id ? null : state.selectedId,
      cropTargetId: state.cropTargetId === id ? null : state.cropTargetId,
      past: pushHistory(state.past, state.document),
      future: [],
    }));
  },

  deleteSelected: () => {
    const { selectedId, deleteObject } = get();
    if (selectedId) deleteObject(selectedId);
  },

  selectObject: (id) => set({ selectedId: id }),

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
}));
