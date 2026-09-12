import { useEffect, useRef } from 'react';

import { useEditorStore } from '@/editor/store/editorStore';

import { CanvasController } from './CanvasController';

export function EditorCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<CanvasController | null>(null);

  const document = useEditorStore((s) => s.document);
  const assets = useEditorStore((s) => s.assets);
  const selectedId = useEditorStore((s) => s.selectedId);
  const tool = useEditorStore((s) => s.tool);
  const brushColor = useEditorStore((s) => s.brushColor);
  const brushSize = useEditorStore((s) => s.brushSize);
  const updateObject = useEditorStore((s) => s.updateObject);
  const selectObject = useEditorStore((s) => s.selectObject);
  const addDrawing = useEditorStore((s) => s.addDrawing);
  const deleteObject = useEditorStore((s) => s.deleteObject);

  useEffect(() => {
    if (!canvasElRef.current) return;
    const controller = new CanvasController(canvasElRef.current, {
      onObjectTransformed: (id, patch) => updateObject(id, patch),
      onSelectionChanged: (id) => selectObject(id),
      onDrawingCreated: (drawing) => addDrawing({ ...drawing, type: 'drawing' }),
      onEraseObject: (id) => deleteObject(id),
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [updateObject, selectObject, addDrawing, deleteObject]);

  useEffect(() => {
    controllerRef.current?.sync(document, assets);
  }, [document, assets]);

  useEffect(() => {
    controllerRef.current?.setSelection(selectedId);
  }, [selectedId]);

  useEffect(() => {
    controllerRef.current?.setTool(tool, { color: brushColor, size: brushSize });
  }, [tool, brushColor, brushSize]);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-neutral-900 p-8">
      <canvas ref={canvasElRef} className="shadow-2xl" />
    </div>
  );
}
