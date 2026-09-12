import { useCallback, useState } from 'react';

import { CropModal } from '@/components/CropModal/CropModal';
import { LayersPanel } from '@/components/LayersPanel/LayersPanel';
import { PropertiesPanel } from '@/components/PropertiesPanel/PropertiesPanel';
import { Toolbar } from '@/components/Toolbar/Toolbar';
import { EditorCanvas } from '@/editor/canvas/Canvas';
import { useKeyboardShortcuts } from '@/editor/hooks/useKeyboardShortcuts';
import { useEditorStore } from '@/editor/store/editorStore';

function App() {
  const addImageFile = useEditorStore((s) => s.addImageFile);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  useKeyboardShortcuts();

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
    </div>
  );
}

export default App;
