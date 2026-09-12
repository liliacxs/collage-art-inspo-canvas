import { useEditorStore } from '@/editor/store/editorStore';
import type { ImageFilters } from '@/types/editor';

const NUMERIC_FIELDS = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'Width' },
  { key: 'height', label: 'Height' },
  { key: 'rotation', label: 'Rotation' },
] as const;

const FILTER_FIELDS: { key: keyof ImageFilters; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
];

export function PropertiesPanel() {
  const selectedId = useEditorStore((s) => s.selectedId);
  const object = useEditorStore((s) => s.document.objects.find((o) => o.id === s.selectedId));
  const updateObject = useEditorStore((s) => s.updateObject);
  const updateImageFilters = useEditorStore((s) => s.updateImageFilters);
  const openCrop = useEditorStore((s) => s.openCrop);
  const setClusteringEnabled = useEditorStore((s) => s.setClusteringEnabled);
  const setClusteringColours = useEditorStore((s) => s.setClusteringColours);
  const isClusteringPending = useEditorStore((s) => (selectedId ? (s.clusteringPending[selectedId] ?? false) : false));

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

      <div className="flex flex-col gap-1 border-t border-neutral-800 pt-3">
        <label className="flex items-center justify-between gap-2 text-neutral-300">
          <span className="text-neutral-500">Opacity</span>
          <span className="text-neutral-400">{Math.round(object.opacity * 100)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(object.opacity * 100)}
          onChange={(e) => updateObject(object.id, { opacity: Number(e.target.value) / 100 })}
        />
      </div>

      {object.type === 'image' && (
        <>
          <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
            <span className="text-neutral-500">Filters</span>
            {FILTER_FIELDS.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="flex items-center justify-between gap-2 text-neutral-300">
                  <span>{label}</span>
                  <span className="text-neutral-400">{Math.round(object.filters[key] * 100)}</span>
                </label>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={Math.round(object.filters[key] * 100)}
                  onChange={(e) => updateImageFilters(object.id, { [key]: Number(e.target.value) / 100 })}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
            <label className="flex items-center justify-between gap-2 text-neutral-300">
              <span className="text-neutral-500">Colour clustering</span>
              <input
                type="checkbox"
                checked={object.colourClustering?.enabled ?? false}
                onChange={(e) => setClusteringEnabled(object.id, e.target.checked)}
              />
            </label>

            {object.colourClustering?.enabled && (
              <>
                <label className="flex items-center justify-between gap-2 text-neutral-300">
                  <span className="text-neutral-500">Colours</span>
                  <span className="text-neutral-400">
                    {object.colourClustering.colours}
                    {isClusteringPending && <span className="ml-1 text-neutral-600">…</span>}
                  </span>
                </label>
                <input
                  type="range"
                  min={4}
                  max={32}
                  value={object.colourClustering.colours}
                  onChange={(e) => setClusteringColours(object.id, Number(e.target.value))}
                />
                {object.colourClustering.palette.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {object.colourClustering.palette.map((hex, index) => (
                      <div
                        key={`${hex}-${index}`}
                        className="h-5 w-5 rounded border border-neutral-700"
                        style={{ backgroundColor: hex }}
                        title={hex}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border-t border-neutral-800 pt-3">
            <button
              type="button"
              className="w-full rounded bg-neutral-800 px-3 py-1.5 text-neutral-200 hover:bg-neutral-700"
              onClick={() => openCrop(object.id)}
            >
              {object.crop ? 'Edit crop' : 'Crop'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
