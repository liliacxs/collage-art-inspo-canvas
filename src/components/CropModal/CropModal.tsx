import { useEffect, useRef } from 'react';

import { CropStage } from '@/editor/canvas/CropStage';
import { useEditorStore } from '@/editor/store/editorStore';

export function CropModal() {
  const cropTargetId = useEditorStore((s) => s.cropTargetId);
  const closeCrop = useEditorStore((s) => s.closeCrop);
  const applyCrop = useEditorStore((s) => s.applyCrop);
  const object = useEditorStore((s) => s.document.objects.find((o) => o.id === s.cropTargetId));
  const asset = useEditorStore((s) => (object?.type === 'image' ? s.assets[object.assetId] : undefined));

  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<CropStage | null>(null);

  useEffect(() => {
    if (!object || object.type !== 'image' || !asset || !canvasElRef.current) return;

    const initialCrop = object.crop ?? { x: 0, y: 0, width: asset.naturalWidth, height: asset.naturalHeight };
    const stage = new CropStage(canvasElRef.current, {
      imageUrl: asset.url,
      naturalWidth: asset.naturalWidth,
      naturalHeight: asset.naturalHeight,
      initialCrop,
    });
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
    // Re-run only when the target changes, not on every unrelated document/asset update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropTargetId]);

  useEffect(() => {
    if (!cropTargetId) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeCrop();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cropTargetId, closeCrop]);

  if (!object || object.type !== 'image' || !asset) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex flex-col gap-3 rounded-lg bg-neutral-900 p-4">
        <div className="text-sm font-medium text-neutral-200">Crop &ldquo;{object.name}&rdquo;</div>
        <canvas ref={canvasElRef} className="rounded border border-neutral-700" />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            onClick={closeCrop}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
            onClick={() => {
              const crop = stageRef.current?.getCrop();
              if (crop) applyCrop(object.id, crop);
            }}
          >
            Apply crop
          </button>
        </div>
      </div>
    </div>
  );
}
