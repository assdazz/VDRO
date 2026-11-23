import type { ReactNode } from 'react'

const editIcons = {
  undo: { label: '撤销', path: 'M9 5l-5 5 5 5m-5-5h10a5 5 0 0 1 0 10h-3' },
  redo: { label: '重做', path: 'M15 5l5 5-5 5m5-5H10a5 5 0 0 0 0 10h3' },
  split: { label: '在播放头处分割', path: 'M4 4h5v16H4M20 4h-5v16h5' },
  edit: { label: '编辑标记', path: 'm5 16-1 4 4-1L20 7l-3-3L5 16Zm10-10 3 3' },
  delete: { label: '删除', path: 'M4 6h16M7 6v14h10V6M10 6V4h4v2' },
  marker: { label: '添加标记', path: 'M8 5h8v14H8z' },
  reverse: { label: '倒放', path: 'M16 5l-9 7 9 7V5ZM4 5v14' },
  copy: { label: '复制', path: 'M8 8h12v12H8zM16 8V4H4v12h4' },
  cut: { label: '剪切', path: 'M14 10l6-6M8 8l12 12m-7-7-5 3m0-8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm0 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z' },
} as const

type EditAction = keyof typeof editIcons

export function TimelineEditIcon({ action }: { action: EditAction }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"><path d={editIcons[action].path} /></svg>
}

export function TimelineEditButton({ action, label = editIcons[action].label, disabled, pressed, onClick }: {
  action: EditAction
  label?: string
  disabled?: boolean
  pressed?: boolean
  onClick: () => void
}) {
  return <button className={`timeline-icon-btn waveform-${action}`} type="button" title={label} aria-label={label}
    aria-keyshortcuts={action === 'undo' ? 'Control+z Meta+z' : action === 'redo' ? 'Control+y Control+Shift+z Meta+Shift+z' : undefined}
    disabled={disabled} aria-pressed={pressed} onClick={onClick}>
    <TimelineEditIcon action={action} />
  </button>
}

export function TimelineEditControls({ canUndo, canRedo, canSplit, canDelete, canAddMarker, deleteLabel, onUndo, onRedo, onSplit, onDelete, onAddMarker, children }: {
  canUndo: boolean
  canRedo: boolean
  canSplit?: boolean
  canDelete: boolean
  canAddMarker: boolean
  deleteLabel: string
  onUndo: () => void
  onRedo: () => void
  onSplit?: () => void
  onDelete: () => void
  onAddMarker: () => void
  children?: ReactNode
}) {
  return <div className="timeline-edit-controls" role="group" aria-label="编辑工具">
    <TimelineEditButton action="undo" disabled={!canUndo} onClick={onUndo} />
    <TimelineEditButton action="redo" disabled={!canRedo} onClick={onRedo} />
    {onSplit && <TimelineEditButton action="split" disabled={!canSplit} onClick={onSplit} />}
    <TimelineEditButton action="delete" label={deleteLabel} disabled={!canDelete} onClick={onDelete} />
    <TimelineEditButton action="marker" disabled={!canAddMarker} onClick={onAddMarker} />
    {children}
  </div>
}
