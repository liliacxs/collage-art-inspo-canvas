import { useEffect, useRef } from 'react';

import { useEditorStore } from '@/editor/store/editorStore';

import { CanvasController } from './CanvasController';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

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
  const setClusteringPalette = useEditorStore((s) => s.setClusteringPalette);
  const setClusteringPending = useEditorStore((s) => s.setClusteringPending);
  const applyRegeneratedPalette = useEditorStore((s) => s.applyRegeneratedPalette);
  const paletteRegenerationRequest = useEditorStore((s) => s.paletteRegenerationRequest);
  const handledRegenerationNonce = useRef(0);
  const exportRequest = useEditorStore((s) => s.exportRequest);
  const handledExportNonce = useRef(0);
  const grid = useEditorStore((s) => s.grid);
  const zoom = useEditorStore((s) => s.zoom);

  useEffect(() => {
    if (!canvasElRef.current) return;
    const controller = new CanvasController(canvasElRef.current, {
      onObjectTransformed: (id, patch) => updateObject(id, patch),
      onSelectionChanged: (id) => selectObject(id),
      onDrawingCreated: (drawing) => addDrawing({ ...drawing, type: 'drawing' }),
      onEraseObject: (id) => deleteObject(id),
      onClusteringPaletteComputed: (id, palette) => setClusteringPalette(id, palette),
      onClusteringPendingChanged: (id, pending) => setClusteringPending(id, pending),
      onPaletteRegenerated: (id, palette) => applyRegeneratedPalette(id, palette),
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [
    updateObject,
    selectObject,
    addDrawing,
    deleteObject,
    setClusteringPalette,
    setClusteringPending,
    applyRegeneratedPalette,
  ]);

  useEffect(() => {
    controllerRef.current?.sync(document, assets);
  }, [document, assets]);

  useEffect(() => {
    if (!paletteRegenerationRequest || paletteRegenerationRequest.nonce === handledRegenerationNonce.current) return;
    handledRegenerationNonce.current = paletteRegenerationRequest.nonce;
    controllerRef.current?.regeneratePalette(paletteRegenerationRequest.id);
  }, [paletteRegenerationRequest]);

  useEffect(() => {
    if (exportRequest === 0 || exportRequest === handledExportNonce.current) return;
    handledExportNonce.current = exportRequest;
    void controllerRef.current?.exportPng().then((blob) => {
      if (blob) downloadBlob(blob, `collage-${Date.now()}.png`);
    });
  }, [exportRequest]);

  useEffect(() => {
    controllerRef.current?.setSelection(selectedId);
  }, [selectedId]);

  useEffect(() => {
    controllerRef.current?.setTool(tool, { color: brushColor, size: brushSize });
  }, [tool, brushColor, brushSize]);

  useEffect(() => {
    controllerRef.current?.setZoom(zoom);
  }, [zoom]);

  const { width: canvasWidth, height: canvasHeight } = document.canvas;
  const zoomedWidth = canvasWidth * zoom;
  const zoomedHeight = canvasHeight * zoom;

  return (
    <div className="flex h-full w-full overflow-auto bg-neutral-900 p-8">
      <div
        className="relative m-auto shrink-0 shadow-2xl outline outline-2 outline-white/80"
        style={{ width: zoomedWidth, height: zoomedHeight }}
      >
        <canvas ref={canvasElRef} className="absolute inset-0" />
        {grid.visible && (grid.horizontalLines > 0 || grid.verticalLines > 0) && (
          <svg
            className="pointer-events-none absolute inset-0"
            width={zoomedWidth}
            height={zoomedHeight}
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
          >
            {Array.from({ length: grid.verticalLines }, (_, i) => {
              const x = (canvasWidth * (i + 1)) / (grid.verticalLines + 1);
              return <line key={`v${i}`} x1={x} y1={0} x2={x} y2={canvasHeight} stroke="rgba(59,130,246,0.7)" strokeWidth={1} />;
            })}
            {Array.from({ length: grid.horizontalLines }, (_, i) => {
              const y = (canvasHeight * (i + 1)) / (grid.horizontalLines + 1);
              return <line key={`h${i}`} x1={0} y1={y} x2={canvasWidth} y2={y} stroke="rgba(59,130,246,0.7)" strokeWidth={1} />;
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
