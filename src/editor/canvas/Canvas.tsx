import { useEffect, useRef } from 'react';

import { useEditorStore } from '@/editor/store/editorStore';
import { downloadBlob } from '@/lib/download';

import { CanvasController } from './CanvasController';

export function EditorCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<CanvasController | null>(null);

  const document = useEditorStore((s) => s.document);
  const assets = useEditorStore((s) => s.assets);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.tool);
  const brushColor = useEditorStore((s) => s.brushColor);
  const brushSize = useEditorStore((s) => s.brushSize);
  const updateObject = useEditorStore((s) => s.updateObject);
  const updateObjectsPositions = useEditorStore((s) => s.updateObjectsPositions);
  const selectObjects = useEditorStore((s) => s.selectObjects);
  const addDrawing = useEditorStore((s) => s.addDrawing);
  const deleteObject = useEditorStore((s) => s.deleteObject);
  const duplicateAndMove = useEditorStore((s) => s.duplicateAndMove);
  const setClusteringPalette = useEditorStore((s) => s.setClusteringPalette);
  const setClusteringPending = useEditorStore((s) => s.setClusteringPending);
  const applyRegeneratedPalette = useEditorStore((s) => s.applyRegeneratedPalette);
  const paletteRegenerationRequest = useEditorStore((s) => s.paletteRegenerationRequest);
  const handledRegenerationNonce = useRef(0);
  const exportRequest = useEditorStore((s) => s.exportRequest);
  const handledExportNonce = useRef(0);
  const mergeRequest = useEditorStore((s) => s.mergeRequest);
  const handledMergeNonce = useRef(0);
  const applyMerge = useEditorStore((s) => s.applyMerge);
  const grid = useEditorStore((s) => s.grid);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const zoom = useEditorStore((s) => s.zoom);

  useEffect(() => {
    if (!canvasElRef.current) return;
    const controller = new CanvasController(canvasElRef.current, {
      onObjectTransformed: (id, patch) => updateObject(id, patch),
      onObjectsTransformed: (patches) => updateObjectsPositions(patches),
      onSelectionChanged: (ids) => selectObjects(ids),
      onDrawingCreated: (drawing) => addDrawing({ ...drawing, type: 'drawing' }),
      onEraseObject: (id) => deleteObject(id),
      onAltDragDuplicate: (origin, movedId, movedPatch) => duplicateAndMove(origin, movedId, movedPatch),
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
    updateObjectsPositions,
    selectObjects,
    addDrawing,
    deleteObject,
    duplicateAndMove,
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
    if (!mergeRequest || mergeRequest.nonce === handledMergeNonce.current) return;
    handledMergeNonce.current = mergeRequest.nonce;
    void controllerRef.current?.mergeObjects(mergeRequest.ids).then((result) => {
      if (!result) return;
      const url = URL.createObjectURL(result.blob);
      applyMerge(mergeRequest.ids, { url, x: result.x, y: result.y, width: result.width, height: result.height });
    });
  }, [mergeRequest, applyMerge]);

  useEffect(() => {
    controllerRef.current?.setSelection(selectedIds);
  }, [selectedIds]);

  useEffect(() => {
    controllerRef.current?.setTool(tool, { color: brushColor, size: brushSize });
  }, [tool, brushColor, brushSize]);

  useEffect(() => {
    controllerRef.current?.setZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    controllerRef.current?.setGrid(grid);
  }, [grid]);

  useEffect(() => {
    controllerRef.current?.setSnapEnabled(snapEnabled);
  }, [snapEnabled]);

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
