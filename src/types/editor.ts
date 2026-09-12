export interface CanvasObjectBase {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
}

export interface ImageFilters {
  brightness: number; // -1..1
  contrast: number; // -1..1
  saturation: number; // -1..1
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColourClustering {
  enabled: boolean;
  colours: number; // 4..32
  palette: string[]; // hex, dark -> light; populated once the worker resolves
  colourFilter?: string; // hex; multiplied against the palette at bake time, not baked into it
}

export interface ImageObject extends CanvasObjectBase {
  type: 'image';
  assetId: string;
  filters: ImageFilters;
  crop?: ImageCrop;
  colourClustering?: ColourClustering;
}

export interface DrawingObject extends CanvasObjectBase {
  type: 'drawing';
  path: string;
  stroke: string;
  strokeWidth: number;
}

// Will grow into `ImageObject | TextObject | DrawingObject` as text lands.
export type CanvasObject = ImageObject | DrawingObject;

export interface ImageAsset {
  id: string;
  url: string;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
}

export interface CollageDocument {
  version: 1;
  canvas: {
    width: number;
    height: number;
    background: string;
  };
  objects: CanvasObject[];
}
