import { useEditorStore } from '@/editor/store/editorStore';

export function LayersPanel() {
  const objects = useEditorStore((s) => s.document.objects);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectObject = useEditorStore((s) => s.selectObject);
  const toggleSelectObject = useEditorStore((s) => s.toggleSelectObject);
  const bringForward = useEditorStore((s) => s.bringForward);
  const sendBackward = useEditorStore((s) => s.sendBackward);
  const toggleVisibility = useEditorStore((s) => s.toggleVisibility);
  const requestMerge = useEditorStore((s) => s.requestMerge);

  const topFirst = [...objects].reverse();

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 text-sm text-neutral-200">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="font-medium text-neutral-400">Layers</span>
        {selectedIds.length >= 2 && (
          <button
            type="button"
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
            title="Flatten the selected layers into a single image"
            onClick={() => requestMerge(selectedIds)}
          >
            Merge
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {topFirst.length === 0 && (
          <p className="p-3 text-neutral-500">No layers yet. Add an image to get started.</p>
        )}
        {topFirst.map((object) => (
          <div
            key={object.id}
            onClick={(e) => {
              if (e.shiftKey || e.metaKey || e.ctrlKey) toggleSelectObject(object.id);
              else selectObject(object.id);
            }}
            className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${
              selectedIds.includes(object.id) ? 'bg-neutral-800' : 'hover:bg-neutral-800/60'
            }`}
          >
            <button
              type="button"
              className="shrink-0 text-neutral-400 hover:text-neutral-100"
              title={object.visible ? 'Hide layer' : 'Show layer'}
              onClick={(e) => {
                e.stopPropagation();
                toggleVisibility(object.id);
              }}
            >
              {object.visible ? '●' : '○'}
            </button>
            <span className={`min-w-0 flex-1 truncate ${object.visible ? '' : 'text-neutral-500'}`}>{object.name}</span>
            <div className="flex gap-1">
              <button
                type="button"
                className="px-1 text-neutral-400 hover:text-neutral-100"
                title="Bring forward"
                onClick={(e) => {
                  e.stopPropagation();
                  bringForward(object.id);
                }}
              >
                ▲
              </button>
              <button
                type="button"
                className="px-1 text-neutral-400 hover:text-neutral-100"
                title="Send backward"
                onClick={(e) => {
                  e.stopPropagation();
                  sendBackward(object.id);
                }}
              >
                ▼
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
