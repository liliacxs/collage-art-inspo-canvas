import { Canvas, FabricImage, Rect } from 'fabric';

import type { ImageCrop } from '@/types/editor';

const MAX_DISPLAY_SIZE = 560;
const MIN_CROP_SIZE = 20;

export interface CropStageOptions {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  initialCrop: ImageCrop;
}

export class CropStage {
  private canvas: Canvas;
  private cropRect: Rect;
  private scale: number;
  private stageWidth: number;
  private stageHeight: number;

  constructor(el: HTMLCanvasElement, options: CropStageOptions) {
    this.scale = Math.min(1, MAX_DISPLAY_SIZE / Math.max(options.naturalWidth, options.naturalHeight));
    this.stageWidth = options.naturalWidth * this.scale;
    this.stageHeight = options.naturalHeight * this.scale;

    this.canvas = new Canvas(el, { width: this.stageWidth, height: this.stageHeight, selection: false });

    void FabricImage.fromURL(options.imageUrl).then((image) => {
      image.set({
        left: 0,
        top: 0,
        originX: 'left',
        originY: 'top',
        scaleX: this.scale,
        scaleY: this.scale,
        selectable: false,
        evented: false,
      });
      this.canvas.add(image);
      this.canvas.moveObjectTo(image, 0);
      this.canvas.requestRenderAll();
    });

    this.cropRect = new Rect({
      left: options.initialCrop.x * this.scale,
      top: options.initialCrop.y * this.scale,
      width: options.initialCrop.width * this.scale,
      height: options.initialCrop.height * this.scale,
      originX: 'left',
      originY: 'top',
      fill: 'rgba(59, 130, 246, 0.15)',
      stroke: '#3b82f6',
      strokeWidth: 1,
      cornerColor: '#3b82f6',
      cornerStyle: 'circle',
      transparentCorners: false,
      lockRotation: true,
    });
    this.cropRect.setControlsVisibility({ mtr: false });

    this.canvas.add(this.cropRect);
    this.canvas.setActiveObject(this.cropRect);

    this.canvas.on('object:moving', () => this.clamp());
    this.canvas.on('object:scaling', () => this.clamp());
  }

  getCrop(): ImageCrop {
    const width = this.cropRect.getScaledWidth();
    const height = this.cropRect.getScaledHeight();
    return {
      x: Math.round((this.cropRect.left ?? 0) / this.scale),
      y: Math.round((this.cropRect.top ?? 0) / this.scale),
      width: Math.round(width / this.scale),
      height: Math.round(height / this.scale),
    };
  }

  dispose() {
    this.canvas.dispose();
  }

  private clamp() {
    const rect = this.cropRect;
    const width = Math.min(Math.max(rect.getScaledWidth(), MIN_CROP_SIZE), this.stageWidth);
    const height = Math.min(Math.max(rect.getScaledHeight(), MIN_CROP_SIZE), this.stageHeight);
    const left = Math.min(Math.max(rect.left ?? 0, 0), this.stageWidth - width);
    const top = Math.min(Math.max(rect.top ?? 0, 0), this.stageHeight - height);

    rect.set({
      left,
      top,
      scaleX: width / (rect.width || 1),
      scaleY: height / (rect.height || 1),
    });
    rect.setCoords();
    this.canvas.requestRenderAll();
  }
}
