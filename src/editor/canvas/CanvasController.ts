import { Canvas, FabricImage, filters, Path, PencilBrush, util } from 'fabric';
import type { FabricObject, TSimplePathData } from 'fabric';

import type { CanvasObject, CollageDocument, DrawingObject, ImageAsset, ImageObject } from '@/types/editor';

const EPSILON = 0.01;

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
}

function imageSourceRect(object: ImageObject, asset: ImageAsset | undefined) {
  if (object.crop) return { x: object.crop.x, y: object.crop.y, width: object.crop.width, height: object.crop.height };
  return { x: 0, y: 0, width: asset?.naturalWidth ?? object.width, height: asset?.naturalHeight ?? object.height };
}

function filtersSignature(object: ImageObject) {
  return `${object.filters.brightness}|${object.filters.contrast}|${object.filters.saturation}`;
}

export class CanvasController {
  private canvas: Canvas;
  private listeners: CanvasControllerListeners;
  private objectsById = new Map<string, FabricObject>();
  private idByObject = new WeakMap<FabricObject, string>();
  private pendingIds = new Set<string>();
  private assets: Record<string, ImageAsset> = {};
  private appliedFilterSignatures = new WeakMap<FabricObject, string>();
  private applyingSelection = false;
  private tool: CanvasTool = 'select';
  private disposed = false;

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
      }
    }

    for (const object of document.objects) {
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

    const source = imageSourceRect(object, asset);
    image.set({
      left: object.x,
      top: object.y,
      angle: object.rotation,
      opacity: object.opacity,
      originX: 'left',
      originY: 'top',
      visible: object.visible,
      cropX: source.x,
      cropY: source.y,
      width: source.width,
      height: source.height,
      scaleX: object.width / source.width,
      scaleY: object.height / source.height,
    });
    this.applyImageFilters(image, object);
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
    const scaleX = object.width / (path.width || 1);
    const scaleY = object.height / (path.height || 1);
    path.set({ scaleX, scaleY });
    return path;
  }

  private applyPatch(fabricObject: FabricObject, object: CanvasObject) {
    if (object.type === 'image') {
      this.applyImagePatch(fabricObject as FabricImage, object);
    } else {
      applyDrawingPatch(fabricObject, object);
    }
  }

  private applyImagePatch(image: FabricImage, object: ImageObject) {
    const asset = this.assets[object.assetId];
    const source = imageSourceRect(object, asset);
    const scaleX = object.width / source.width;
    const scaleY = object.height / source.height;

    const changed =
      Math.abs((image.left ?? 0) - object.x) > EPSILON ||
      Math.abs((image.top ?? 0) - object.y) > EPSILON ||
      Math.abs((image.angle ?? 0) - object.rotation) > EPSILON ||
      Math.abs((image.opacity ?? 1) - object.opacity) > EPSILON ||
      Math.abs((image.scaleX ?? 1) - scaleX) > EPSILON ||
      Math.abs((image.scaleY ?? 1) - scaleY) > EPSILON ||
      Math.abs((image.cropX ?? 0) - source.x) > EPSILON ||
      Math.abs((image.cropY ?? 0) - source.y) > EPSILON ||
      image.visible !== object.visible;

    if (changed) {
      image.set({
        left: object.x,
        top: object.y,
        angle: object.rotation,
        opacity: object.opacity,
        visible: object.visible,
        cropX: source.x,
        cropY: source.y,
        width: source.width,
        height: source.height,
        scaleX,
        scaleY,
      });
      image.setCoords();
    }

    this.applyImageFilters(image, object);
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

  private applyOrder(objects: CanvasObject[]) {
    objects.forEach((object, index) => {
      const fabricObject = this.objectsById.get(object.id);
      if (fabricObject) this.canvas.moveObjectTo(fabricObject, index);
    });
  }
}

function applyDrawingPatch(fabricObject: FabricObject, object: DrawingObject) {
  const targetScaleX = object.width / (fabricObject.width || 1);
  const targetScaleY = object.height / (fabricObject.height || 1);

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
