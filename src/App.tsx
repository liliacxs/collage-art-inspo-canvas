import { useCallback, useEffect, useRef, useState } from 'react';

import { CanvasSettingsModal } from '@/components/CanvasSettingsModal/CanvasSettingsModal';
import { CropModal } from '@/components/CropModal/CropModal';
import { LayersPanel } from '@/components/LayersPanel/LayersPanel';
import { PropertiesPanel } from '@/components/PropertiesPanel/PropertiesPanel';
import { Toolbar } from '@/components/Toolbar/Toolbar';
import { EditorCanvas } from '@/editor/canvas/Canvas';
import { useKeyboardShortcuts } from '@/editor/hooks/useKeyboardShortcuts';
import { useEditorStore } from '@/editor/store/editorStore';
import { loadAutosave, saveAutosave } from '@/lib/persistence';

const AUTOSAVE_DEBOUNCE_MS = 800;

function App() {
  const addImageFile = useEditorStore((s) => s.addImageFile);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const documentState = useEditorStore((s) => s.document);
  const assets = useEditorStore((s) => s.assets);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  useKeyboardShortcuts();

  // Restore whatever was last autosaved, once, on first mount.
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const restored = loadAutosave();
    if (restored) loadDocument(restored.document, restored.assets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave: closing the tab shouldn't lose work. The size guard inside
  // saveAutosave silently skips (with a console warning) if the project has grown
  // too large for localStorage — "Save project" remains the reliable path for that.
  useEffect(() => {
    const timer = setTimeout(() => {
      void saveAutosave(documentState, assets);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [documentState, assets]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDraggingOver(false);
      Array.from(e.dataTransfer.files)
        .filter((file) => file.type.startsWith('image/'))
        .forEach((file) => void addImageFile(file));
    },
    [addImageFile],
  );

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <LayersPanel />
        <div
          className={`relative min-w-0 flex-1 ${isDraggingOver ? 'ring-2 ring-inset ring-blue-500' : ''}`}
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
        >
          <EditorCanvas />
        </div>
        <PropertiesPanel />
      </div>
      <CropModal />
      <CanvasSettingsModal />
    </div>
  );
}

export default App;
