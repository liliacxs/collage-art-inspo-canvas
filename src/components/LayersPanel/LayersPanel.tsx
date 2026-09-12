import { useEditorStore } from '@/editor/store/editorStore';

export function LayersPanel() {
  const objects = useEditorStore((s) => s.document.objects);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectObject = useEditorStore((s) => s.selectObject);
  const bringForward = useEditorStore((s) => s.bringForward);
  const sendBackward = useEditorStore((s) => s.sendBackward);

  const topFirst = [...objects].reverse();

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 text-sm text-neutral-200">
      <div className="border-b border-neutral-800 px-3 py-2 font-medium text-neutral-400">Layers</div>
      <div className="flex-1 overflow-y-auto">
        {topFirst.length === 0 && (
          <p className="p-3 text-neutral-500">No layers yet. Add an image to get started.</p>
        )}
        {topFirst.map((object) => (
          <div
            key={object.id}
            onClick={() => selectObject(object.id)}
            className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${
              object.id === selectedId ? 'bg-neutral-800' : 'hover:bg-neutral-800/60'
            }`}
          >
            <span className="truncate">{object.name}</span>
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
