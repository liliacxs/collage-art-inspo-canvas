import { useRef } from 'react';

import { useEditorStore, type Tool } from '@/editor/store/editorStore';
import { downloadBlob } from '@/lib/download';
import { deserializeProject, serializeProject } from '@/lib/persistence';

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'select', label: 'Select' },
  { tool: 'draw', label: 'Draw' },
  { tool: 'erase', label: 'Erase' },
];

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);

  const addImageFile = useEditorStore((s) => s.addImageFile);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const flipSelected = useEditorStore((s) => s.flipSelected);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const brushColor = useEditorStore((s) => s.brushColor);
  const setBrushColor = useEditorStore((s) => s.setBrushColor);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const openCanvasSettings = useEditorStore((s) => s.openCanvasSettings);
  const requestExport = useEditorStore((s) => s.requestExport);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomIn = useEditorStore((s) => s.zoomIn);
  const zoomOut = useEditorStore((s) => s.zoomOut);
  const resetZoom = useEditorStore((s) => s.resetZoom);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);

  const documentState = useEditorStore((s) => s.document);
  const assetsState = useEditorStore((s) => s.assets);
  const loadDocument = useEditorStore((s) => s.loadDocument);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .forEach((file) => void addImageFile(file));
  };

  const handleSaveProject = async () => {
    const json = await serializeProject(documentState, assetsState);
    downloadBlob(new Blob([json], { type: 'application/json' }), `collage-${Date.now()}.json`);
  };

  const handleOpenProjectFile = async (file: File) => {
    const text = await file.text();
    const loaded = deserializeProject(text);
    if (!loaded) {
      window.alert('This file is not a valid art-editor project.');
      return;
    }
    loadDocument(loaded.document, loaded.assets);
  };

  return (
    <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-200">
      <span className="font-semibold text-neutral-100">Art Editor</span>
      <div className="mx-2 h-5 w-px bg-neutral-700" />

      <button
        type="button"
        className="rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700"
        onClick={() => fileInputRef.current?.click()}
      >
        Add image
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <button
        type="button"
        className="rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700"
        onClick={() => void handleSaveProject()}
        title="Download the whole project as a .json file"
      >
        Save project
      </button>
      <button
        type="button"
        className="rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700"
        onClick={() => projectFileInputRef.current?.click()}
        title="Load a project from a .json file"
      >
        Open project
      </button>
      <input
        ref={projectFileInputRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleOpenProjectFile(file);
          e.target.value = '';
        }}
      />

      <div className="mx-2 h-5 w-px bg-neutral-700" />

      <div className="flex overflow-hidden rounded border border-neutral-700">
        {TOOLS.map(({ tool: t, label }) => (
          <button
            key={t}
            type="button"
            className={`px-3 py-1.5 ${t === tool ? 'bg-blue-600 text-white' : 'hover:bg-neutral-800'}`}
            onClick={() => setTool(t)}
          >
            {label}
          </button>
        ))}
      </div>

      {tool === 'draw' && (
        <div className="flex items-center gap-2 pl-2">
          <input
            type="color"
            value={brushColor}
            onChange={(e) => setBrushColor(e.target.value)}
            className="h-7 w-7 cursor-pointer rounded border border-neutral-700 bg-transparent"
            title="Brush colour"
          />
          <input
            type="range"
            min={1}
            max={40}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-24"
            title="Brush size"
          />
          <span className="w-6 text-right text-neutral-400">{brushSize}</span>
        </div>
      )}

      <div className="mx-2 h-5 w-px bg-neutral-700" />

      <button
        type="button"
        className="rounded px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-40"
        onClick={undo}
        disabled={!canUndo}
      >
        Undo
      </button>
      <button
        type="button"
        className="rounded px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-40"
        onClick={redo}
        disabled={!canRedo}
      >
        Redo
      </button>

      <button
        type="button"
        className="rounded px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-40"
        onClick={duplicateSelected}
        disabled={selectedIds.length === 0}
        title="Duplicate (Cmd/Ctrl+D)"
      >
        Duplicate
      </button>
      <button
        type="button"
        className="rounded px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-40"
        onClick={() => flipSelected('horizontal')}
        disabled={selectedIds.length === 0}
        title="Flip horizontal"
      >
        Flip H
      </button>
      <button
        type="button"
        className="rounded px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-40"
        onClick={() => flipSelected('vertical')}
        disabled={selectedIds.length === 0}
        title="Flip vertical"
      >
        Flip V
      </button>

      <button
        type="button"
        className="rounded px-3 py-1.5 text-red-300 hover:bg-neutral-800 disabled:opacity-40"
        onClick={deleteSelected}
        disabled={selectedIds.length === 0}
      >
        Delete
      </button>

      <div className="mx-2 h-5 w-px bg-neutral-700" />

      <label className="flex items-center gap-1.5 px-1 text-neutral-300" title="Snap dragged objects to the grid, canvas edges/center, and other objects">
        <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
        Snap
      </label>

      <div className="mx-2 h-5 w-px bg-neutral-700" />

      <div className="flex items-center overflow-hidden rounded border border-neutral-700">
        <button type="button" className="px-2 py-1.5 hover:bg-neutral-800" onClick={zoomOut} title="Zoom out">
          −
        </button>
        <button
          type="button"
          className="w-14 py-1.5 text-center hover:bg-neutral-800"
          onClick={resetZoom}
          title="Reset zoom to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="px-2 py-1.5 hover:bg-neutral-800" onClick={zoomIn} title="Zoom in">
          +
        </button>
      </div>

      <div className="mx-2 h-5 w-px bg-neutral-700" />

      <button type="button" className="rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700" onClick={openCanvasSettings}>
        Canvas
      </button>

      <button
        type="button"
        className="ml-auto rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-500"
        onClick={requestExport}
      >
        Export PNG
      </button>
    </div>
  );
}
