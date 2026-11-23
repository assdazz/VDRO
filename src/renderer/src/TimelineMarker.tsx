import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Language } from '@shared/types'
import { TimelineContextMenu } from './TimelineContextMenu'
import { TimelineEditIcon } from './TimelineEditControls'
import { DEFAULT_MARKER_COLOR, markerName, type MarkerLabel, type MarkerLabelEdit } from './timelineMarkers'

export type MarkerMenuAnchor = { x: number; y: number; trigger: HTMLButtonElement }

export function TimelineMarkerPin({ label, language, selected, className, position, onSelect, onMenu }: {
  label: MarkerLabel
  language: Language
  selected: boolean
  className: string
  position: string
  onSelect: () => void
  onMenu: (anchor: MarkerMenuAnchor) => void
}) {
  const name = markerName(label, language)
  return <button type="button" className={`timeline-marker-pin ${className}`}
    translate="no" title={name} aria-label={name} aria-pressed={selected} aria-haspopup="menu"
    style={{ '--marker-position': position, '--marker-color': label.color ?? DEFAULT_MARKER_COLOR } as CSSProperties}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation()
      onSelect()
    }}
    onContextMenu={event => {
      event.preventDefault()
      event.stopPropagation()
      const trigger = event.currentTarget
      const bounds = trigger.getBoundingClientRect()
      onMenu({ trigger, x: event.clientX || bounds.left, y: event.clientY || bounds.bottom })
    }}
    onKeyDown={event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
      event.preventDefault()
      event.stopPropagation()
      const trigger = event.currentTarget
      const bounds = trigger.getBoundingClientRect()
      onMenu({ trigger, x: bounds.left, y: bounds.bottom })
    }}/>
}

export function TimelineMarkerActions({ anchor, label, language, disabled, onDismiss, onDelete, onSave }: {
  anchor: MarkerMenuAnchor
  label: MarkerLabel
  language: Language
  disabled: boolean
  onDismiss: () => void
  onDelete: () => void
  onSave: (edit: MarkerLabelEdit) => void
}) {
  const [editing, setEditing] = useState(false)
  const focusMarker = () => anchor.trigger.focus({ preventScroll: true })

  if (editing) return <MarkerEditDialog label={label} language={language} disabled={disabled}
    onDismiss={onDismiss} onSave={onSave} restoreFocus={focusMarker}/>

  return <TimelineContextMenu x={anchor.x} y={anchor.y} label="标记操作" className="timeline-marker-menu"
    onDismiss={onDismiss} onEscape={focusMarker}>
    <button type="button" role="menuitem" disabled={disabled} onClick={() => { onDelete(); onDismiss() }}>
      <TimelineEditIcon action="delete" /><span>删除标记</span>
    </button>
    <button type="button" role="menuitem" disabled={disabled} onClick={() => setEditing(true)}>
      <TimelineEditIcon action="edit" /><span>编辑标记</span>
    </button>
  </TimelineContextMenu>
}

function MarkerEditDialog({ label, language, disabled, onDismiss, onSave, restoreFocus }: {
  label: MarkerLabel
  language: Language
  disabled: boolean
  onDismiss: () => void
  onSave: (edit: MarkerLabelEdit) => void
  restoreFocus: () => void
}) {
  const [name, setName] = useState(label.name ?? '')
  const [color, setColor] = useState(label.color ?? DEFAULT_MARKER_COLOR)
  const title = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    nameInput.current?.select()
    return () => { element.close() }
  }, [])

  function close() {
    dialog.current?.close()
    onDismiss()
    restoreFocus()
  }

  return <dialog className="timeline-marker-dialog" ref={dialog} aria-labelledby={title}
    onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (disabled) return
      onSave({ name: name.trim() || undefined, color: color === DEFAULT_MARKER_COLOR ? undefined : color })
      close()
    }}>
      <h2 id={title}>编辑标记</h2>
      <label>标记名称<input ref={nameInput} autoFocus type="text" maxLength={80} value={name} translate="no"
        placeholder={markerName({ number: label.number }, language)} onChange={event => setName(event.currentTarget.value)}/></label>
      <label className="timeline-marker-color-label">标记颜色<input type="color" value={color}
        onChange={event => setColor(event.currentTarget.value)}/></label>
      <div className="timeline-marker-dialog-actions">
        <button className="btn btn-ghost" type="button" onClick={close}>取消</button>
        <button className="btn btn-primary" type="submit" disabled={disabled}>保存</button>
      </div>
    </form>
  </dialog>
}
