import { useEditorStore } from '@/editor/store/editorStore';

const NUMERIC_FIELDS = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'Width' },
  { key: 'height', label: 'Height' },
  { key: 'rotation', label: 'Rotation' },
] as const;

export function PropertiesPanel() {
  const selectedId = useEditorStore((s) => s.selectedId);
  const object = useEditorStore((s) => s.document.objects.find((o) => o.id === s.selectedId));
  const updateObject = useEditorStore((s) => s.updateObject);

  if (!selectedId || !object) {
    return (
      <div className="w-64 shrink-0 border-l border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-500">
        Select an object to see its properties.
      </div>
    );
  }

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 border-l border-neutral-800 bg-neutral-900 p-3 text-sm">
      <div className="font-medium text-neutral-400">Properties</div>
      <div className="truncate text-neutral-200">{object.name}</div>
      <div className="flex flex-col gap-2">
        {NUMERIC_FIELDS.map(({ key, label }) => (
          <label key={key} className="flex items-center justify-between gap-2 text-neutral-300">
            <span className="text-neutral-500">{label}</span>
            <input
              type="number"
              className="w-24 rounded bg-neutral-800 px-2 py-1 text-right text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
              value={Math.round(object[key])}
              onChange={(e) => updateObject(object.id, { [key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
