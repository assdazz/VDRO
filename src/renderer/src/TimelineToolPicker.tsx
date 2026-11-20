import { useEffect } from 'react'
import type { ShortcutSettings } from '@shared/types'
import { shortcutLabel } from './shortcutLabels'

export type TimelineTool = 'select' | 'split'

const tools = [
  { id: 'select', key: 'selectTool', label: '选择', name: '选择工具', path: 'M5 3l14 10-7 1-3 6L5 3Z' },
  { id: 'split', key: 'splitTool', label: '分割', name: '分割工具', path: 'M3 6h18v12H3zM12 3v18' },
] as const

export function useTimelineToolShortcuts(active: boolean, shortcuts: ShortcutSettings, onChange: (tool: TimelineTool) => void) {
  useEffect(() => {
    if (!active) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing ||
        (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) ||
        document.querySelector('.settings-dialog')) return
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
      const tool = tools.find(item => shortcuts[item.key] === key)
      if (!tool) return
      event.preventDefault()
      onChange(tool.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, shortcuts, onChange])
}

export function TimelineToolPicker({ tool, shortcuts, onChange }: {
  tool: TimelineTool
  shortcuts: ShortcutSettings
  onChange: (tool: TimelineTool) => void
}) {
  return <div className="timeline-tool-picker" role="group" aria-label="时间线工具">
    {tools.map(item => <button key={item.id} type="button" className="btn btn-ghost btn-small"
      data-tool={item.id} title={item.name} aria-label={item.name} aria-keyshortcuts={shortcuts[item.key] || undefined}
      aria-pressed={tool === item.id} onClick={() => onChange(item.id)}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={item.path} /></svg>
      <span>{item.label}</span>
      {shortcuts[item.key] && <kbd translate="no">{shortcutLabel(shortcuts[item.key])}</kbd>}
    </button>)}
  </div>
}
