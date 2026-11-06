import { z } from 'zod';

import type { CollageDocument, ImageAsset } from '@/types/editor';

const AUTOSAVE_KEY = 'art-editor:autosave:v1';
// Leaves headroom under the ~5MB-per-origin quota most browsers enforce for
// localStorage; base64 image data is what eats this budget, not the document JSON.
const AUTOSAVE_SIZE_LIMIT = 4.5 * 1024 * 1024;

const objectBaseSchema = {
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  opacity: z.number(),
  visible: z.boolean(),
  flipX: z.boolean(),
  flipY: z.boolean(),
};

const imageObjectSchema = z.object({
  ...objectBaseSchema,
  type: z.literal('image'),
  assetId: z.string(),
  filters: z.object({ brightness: z.number(), contrast: z.number(), saturation: z.number() }),
  crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  colourClustering: z
    .object({
      enabled: z.boolean(),
      colours: z.number(),
      palette: z.array(z.string()),
      colourFilter: z.string().optional(),
    })
    .optional(),
});

const drawingObjectSchema = z.object({
  ...objectBaseSchema,
  type: z.literal('drawing'),
  path: z.string(),
  stroke: z.string(),
  strokeWidth: z.number(),
});

// Project files embed each used asset as a base64 data URL so the file is fully
// self-contained (portable, shareable, independent of the blob: URLs that only
// exist for this tab's lifetime).
const projectFileSchema = z.object({
  version: z.literal(1),
  canvas: z.object({ width: z.number(), height: z.number(), background: z.string() }),
  objects: z.array(z.discriminatedUnion('type', [imageObjectSchema, drawingObjectSchema])),
  assets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      naturalWidth: z.number(),
      naturalHeight: z.number(),
      dataUrl: z.string(),
    }),
  ),
});

export interface LoadedProject {
  document: CollageDocument;
  assets: Record<string, ImageAsset>;
}

function blobUrlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return Promise.resolve(url);
  return fetch(url)
    .then((res) => res.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }),
    );
}

// Only serialises assets actually referenced by an object — orphaned assets (e.g.
// from a deleted layer) shouldn't bloat the saved file.
export async function serializeProject(document: CollageDocument, assets: Record<string, ImageAsset>): Promise<string> {
  const usedAssetIds = new Set(document.objects.filter((o) => o.type === 'image').map((o) => o.assetId));
  const assetEntries = await Promise.all(
    Object.values(assets)
      .filter((asset) => usedAssetIds.has(asset.id))
      .map(async (asset) => ({
        id: asset.id,
        name: asset.name,
        naturalWidth: asset.naturalWidth,
        naturalHeight: asset.naturalHeight,
        dataUrl: await blobUrlToDataUrl(asset.url),
      })),
  );
  return JSON.stringify({ ...document, assets: assetEntries });
}

export function deserializeProject(json: string): LoadedProject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const result = projectFileSchema.safeParse(parsed);
  if (!result.success) return null;

  const assets: Record<string, ImageAsset> = {};
  for (const asset of result.data.assets) {
    assets[asset.id] = {
      id: asset.id,
      name: asset.name,
      naturalWidth: asset.naturalWidth,
      naturalHeight: asset.naturalHeight,
      url: asset.dataUrl,
    };
  }

  return {
    document: { version: 1, canvas: result.data.canvas, objects: result.data.objects },
    assets,
  };
}

export async function saveAutosave(document: CollageDocument, assets: Record<string, ImageAsset>): Promise<void> {
  try {
    const json = await serializeProject(document, assets);
    if (json.length > AUTOSAVE_SIZE_LIMIT) {
      console.warn('Art editor: skipping autosave — project is too large for localStorage. Use "Save project" instead.');
      return;
    }
    localStorage.setItem(AUTOSAVE_KEY, json);
  } catch (err) {
    console.warn('Art editor: autosave failed', err);
  }
}

export function loadAutosave(): LoadedProject | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    return json ? deserializeProject(json) : null;
  } catch (err) {
    console.warn('Art editor: could not read autosave', err);
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Storage inaccessible (e.g. blocked in private browsing) — nothing to clear.
  }
}
