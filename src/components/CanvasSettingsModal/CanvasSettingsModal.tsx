import { useEffect, useState } from 'react';

import { useEditorStore, type GridSettings } from '@/editor/store/editorStore';

export function CanvasSettingsModal() {
  const isOpen = useEditorStore((s) => s.canvasSettingsOpen);
  const closeCanvasSettings = useEditorStore((s) => s.closeCanvasSettings);
  const canvasWidth = useEditorStore((s) => s.document.canvas.width);
  const canvasHeight = useEditorStore((s) => s.document.canvas.height);
  const background = useEditorStore((s) => s.document.canvas.background);
  const setCanvasSize = useEditorStore((s) => s.setCanvasSize);
  const setCanvasBackground = useEditorStore((s) => s.setCanvasBackground);

  const grid = useEditorStore((s) => s.grid);
  const setGridVisible = useEditorStore((s) => s.setGridVisible);
  const setGridHorizontalLines = useEditorStore((s) => s.setGridHorizontalLines);
  const setGridVerticalLines = useEditorStore((s) => s.setGridVerticalLines);

  // Edits are staged here and only committed to the store on "Done" — the actual
  // canvas must not resize/recolour while the user is still typing.
  const [draftWidth, setDraftWidth] = useState(canvasWidth);
  const [draftHeight, setDraftHeight] = useState(canvasHeight);
  const [draftBackground, setDraftBackground] = useState(background);
  const [draftGrid, setDraftGrid] = useState<GridSettings>(grid);

  useEffect(() => {
    if (!isOpen) return;
    setDraftWidth(canvasWidth);
    setDraftHeight(canvasHeight);
    setDraftBackground(background);
    setDraftGrid(grid);
    // Re-seed the draft only when the modal opens, not on every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDone = () => {
    setCanvasSize(draftWidth, draftHeight);
    setCanvasBackground(draftBackground);
    setGridVisible(draftGrid.visible);
    setGridHorizontalLines(draftGrid.horizontalLines);
    setGridVerticalLines(draftGrid.verticalLines);
    closeCanvasSettings();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={closeCanvasSettings}>
      <div
        className="flex w-72 flex-col gap-4 rounded-lg bg-neutral-900 p-4 text-sm text-neutral-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-medium text-neutral-200">Canvas settings</div>

        <div className="flex flex-col gap-2">
          <span className="text-neutral-500">Size</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="w-full min-w-0 rounded bg-neutral-800 px-2 py-1 text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
              value={draftWidth}
              onChange={(e) => setDraftWidth(Number(e.target.value))}
            />
            <span className="text-neutral-500">×</span>
            <input
              type="number"
              className="w-full min-w-0 rounded bg-neutral-800 px-2 py-1 text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
              value={draftHeight}
              onChange={(e) => setDraftHeight(Number(e.target.value))}
            />
          </div>
        </div>

        <label className="flex items-center justify-between gap-2">
          <span className="text-neutral-500">Background</span>
          <input
            type="color"
            value={draftBackground}
            onChange={(e) => setDraftBackground(e.target.value)}
            className="h-7 w-9 cursor-pointer rounded border border-neutral-700 bg-transparent p-0"
          />
        </label>

        <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
          <label className="flex items-center justify-between gap-2">
            <span className="text-neutral-500">Show grid</span>
            <input
              type="checkbox"
              checked={draftGrid.visible}
              onChange={(e) => setDraftGrid((g) => ({ ...g, visible: e.target.checked }))}
            />
          </label>
          {draftGrid.visible && (
            <>
              <label className="flex items-center justify-between gap-2">
                <span className="text-neutral-500">Horizontal lines</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  className="w-16 rounded bg-neutral-800 px-2 py-1 text-right text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
                  value={draftGrid.horizontalLines}
                  onChange={(e) => setDraftGrid((g) => ({ ...g, horizontalLines: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-neutral-500">Vertical lines</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  className="w-16 rounded bg-neutral-800 px-2 py-1 text-right text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
                  value={draftGrid.verticalLines}
                  onChange={(e) => setDraftGrid((g) => ({ ...g, verticalLines: Number(e.target.value) }))}
                />
              </label>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
            onClick={closeCanvasSettings}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-500"
            onClick={handleDone}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
