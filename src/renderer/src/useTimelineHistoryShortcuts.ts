import { useEffect } from 'react'

export function useTimelineHistoryShortcuts(active: boolean, undo: () => void, redo: () => void) {
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) ||
        document.querySelector('.settings-dialog, dialog[open]') ||
        (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]'))) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (key === 'y' || event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, undo, redo])
}
