import { renderPaletteToBlob } from '@/editor/effects/paletteImage';
import { useEditorStore, type AlignMode } from '@/editor/store/editorStore';
import { downloadBlob } from '@/lib/download';
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

const ALIGN_BUTTONS: { mode: AlignMode; label: string; title: string }[] = [
  { mode: 'left', label: 'Left', title: 'Align left edges' },
  { mode: 'centerH', label: 'Center', title: 'Align horizontal centers' },
  { mode: 'right', label: 'Right', title: 'Align right edges' },
  { mode: 'top', label: 'Top', title: 'Align top edges' },
  { mode: 'centerV', label: 'Middle', title: 'Align vertical centers' },
  { mode: 'bottom', label: 'Bottom', title: 'Align bottom edges' },
];

export function PropertiesPanel() {
  const selectedIds = useEditorStore((s) => s.selectedIds);

  if (selectedIds.length === 0) {
    return (
      <div className="w-64 shrink-0 border-l border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-500">
        Select an object to see its properties.
      </div>
    );
  }

  if (selectedIds.length > 1) return <MultiSelectPanel />;
  return <SingleSelectPanel id={selectedIds[0]} />;
}

function MultiSelectPanel() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const alignSelected = useEditorStore((s) => s.alignSelected);
  const distributeSelected = useEditorStore((s) => s.distributeSelected);
  const flipSelected = useEditorStore((s) => s.flipSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const requestMerge = useEditorStore((s) => s.requestMerge);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);

  const count = selectedIds.length;

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 border-l border-neutral-800 bg-neutral-900 p-3 text-sm">
      <div className="font-medium text-neutral-400">Properties</div>
      <div className="text-neutral-200">{count} objects selected</div>

      <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
        <span className="text-neutral-500">Align</span>
        <div className="grid grid-cols-3 gap-1">
          {ALIGN_BUTTONS.map(({ mode, label, title }) => (
            <button
              key={mode}
              type="button"
              title={title}
              className="rounded bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
              onClick={() => alignSelected(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
        <span className="text-neutral-500">Distribute</span>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            className="rounded bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={count < 3}
            title={count < 3 ? 'Needs at least 3 objects' : 'Distribute spacing horizontally'}
            onClick={() => distributeSelected('horizontal')}
          >
            Horizontal
          </button>
          <button
            type="button"
            className="rounded bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={count < 3}
            title={count < 3 ? 'Needs at least 3 objects' : 'Distribute spacing vertically'}
            onClick={() => distributeSelected('vertical')}
          >
            Vertical
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
        <span className="text-neutral-500">Actions</span>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            className="rounded bg-neutral-800 px-2 py-1.5 text-neutral-200 hover:bg-neutral-700"
            onClick={() => flipSelected('horizontal')}
          >
            Flip H
          </button>
          <button
            type="button"
            className="rounded bg-neutral-800 px-2 py-1.5 text-neutral-200 hover:bg-neutral-700"
            onClick={() => flipSelected('vertical')}
          >
            Flip V
          </button>
          <button
            type="button"
            className="rounded bg-neutral-800 px-2 py-1.5 text-neutral-200 hover:bg-neutral-700"
            onClick={duplicateSelected}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="rounded bg-neutral-800 px-2 py-1.5 text-neutral-200 hover:bg-neutral-700"
            title="Flatten the selected layers into a single image"
            onClick={() => requestMerge(selectedIds)}
          >
            Merge
          </button>
        </div>
        <button
          type="button"
          className="rounded bg-neutral-800 px-2 py-1.5 text-red-300 hover:bg-neutral-700"
          onClick={deleteSelected}
        >
          Delete all
        </button>
      </div>
    </div>
  );
}

function SingleSelectPanel({ id }: { id: string }) {
  const object = useEditorStore((s) => s.document.objects.find((o) => o.id === id));
  const updateObject = useEditorStore((s) => s.updateObject);
  const updateImageFilters = useEditorStore((s) => s.updateImageFilters);
  const openCrop = useEditorStore((s) => s.openCrop);
  const flipSelected = useEditorStore((s) => s.flipSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const setClusteringEnabled = useEditorStore((s) => s.setClusteringEnabled);
  const setClusteringColours = useEditorStore((s) => s.setClusteringColours);
  const setClusteringPaletteColour = useEditorStore((s) => s.setClusteringPaletteColour);
  const setClusteringColourFilter = useEditorStore((s) => s.setClusteringColourFilter);
  const requestPaletteRegeneration = useEditorStore((s) => s.requestPaletteRegeneration);
  const isClusteringPending = useEditorStore((s) => s.clusteringPending[id] ?? false);

  if (!object) return null;

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 border-l border-neutral-800 bg-neutral-900 p-3 text-sm">
      <div className="font-medium text-neutral-400">Properties</div>
      <div className="truncate text-neutral-200">{object.name}</div>

      <div className="flex gap-1">
        <button
          type="button"
          className="flex-1 rounded bg-neutral-800 px-2 py-1.5 text-neutral-200 hover:bg-neutral-700"
          onClick={() => flipSelected('horizontal')}
        >
          Flip H
        </button>
        <button
          type="button"
          className="flex-1 rounded bg-neutral-800 px-2 py-1.5 text-neutral-200 hover:bg-neutral-700"
          onClick={() => flipSelected('vertical')}
        >
          Flip V
        </button>
        <button
          type="button"
          className="flex-1 rounded bg-neutral-800 px-2 py-1.5 text-neutral-200 hover:bg-neutral-700"
          title="Duplicate (Cmd/Ctrl+D)"
          onClick={duplicateSelected}
        >
          Duplicate
        </button>
      </div>

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

            {object.colourClustering?.enabled &&
              (() => {
                // Captured once so closures below (onClick handlers) don't each
                // need their own possibly-undefined narrowing of the field.
                const clustering = object.colourClustering!;
                const hasAdjustmentsToBake =
                  clustering.palette.length > 0 &&
                  (Boolean(clustering.colourFilter) ||
                    object.filters.brightness !== 0 ||
                    object.filters.contrast !== 0 ||
                    object.filters.saturation !== 0);

                return (
                  <>
                    <label className="flex items-center justify-between gap-2 text-neutral-300">
                      <span className="text-neutral-500">Colours</span>
                      <span className="text-neutral-400">
                        {clustering.colours}
                        {isClusteringPending && <span className="ml-1 text-neutral-600">…</span>}
                      </span>
                    </label>
                    <input
                      type="range"
                      min={4}
                      max={32}
                      value={clustering.colours}
                      onChange={(e) => setClusteringColours(object.id, Number(e.target.value))}
                    />
                    {clustering.palette.length > 0 && (
                      <>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {clustering.palette.map((hex, index) => (
                            <input
                              key={index}
                              type="color"
                              value={hex}
                              title={`${hex} — click to edit`}
                              className="h-5 w-5 cursor-pointer rounded border border-neutral-700 bg-transparent p-0"
                              onChange={(e) => setClusteringPaletteColour(object.id, index, e.target.value)}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          className="rounded bg-neutral-800 px-2 py-1.5 text-neutral-200 hover:bg-neutral-700"
                          onClick={async () => {
                            const blob = await renderPaletteToBlob(clustering.palette);
                            if (blob) downloadBlob(blob, `${object.name.replace(/\.[^./]+$/, '')}-palette.png`);
                          }}
                        >
                          Save colour scheme
                        </button>
                      </>
                    )}

                    {clustering.palette.length > 0 && (
                      <div className="flex flex-col gap-1 pt-1 text-neutral-300">
                        <span className="text-neutral-500">Colour filter</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={clustering.colourFilter ?? '#ffffff'}
                            title="Multiply the palette by this colour"
                            className="h-7 w-9 cursor-pointer rounded border border-neutral-700 bg-transparent p-0"
                            onChange={(e) => setClusteringColourFilter(object.id, e.target.value)}
                          />
                          {clustering.colourFilter && (
                            <button
                              type="button"
                              className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                              onClick={() => setClusteringColourFilter(object.id, undefined)}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      className="mt-1 rounded bg-neutral-800 px-2 py-1.5 text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!hasAdjustmentsToBake}
                      title="Freeze the current colour filter and brightness/contrast/saturation into the palette, then reset those adjustments"
                      onClick={() => requestPaletteRegeneration(object.id)}
                    >
                      Regenerate palette
                    </button>
                  </>
                );
              })()}
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
