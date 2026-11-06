import { useEffect } from 'react';

import { NUDGE_STEP, NUDGE_STEP_LARGE, useEditorStore } from '@/editor/store/editorStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function useKeyboardShortcuts() {
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const nudgeSelected = useEditorStore((s) => s.nudgeSelected);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;

      const isModifier = e.metaKey || e.ctrlKey;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !isModifier) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      if (isModifier && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (isModifier && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      const delta = ARROW_DELTAS[e.key];
      if (delta && !isModifier) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
        nudgeSelected(delta[0] * step, delta[1] * step);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, undo, redo, duplicateSelected, nudgeSelected]);
}
