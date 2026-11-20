import type { DragEventHandler, JSX, PointerEventHandler, ReactNode, Ref } from 'react'
import type { ImportedMedia } from '@shared/types'

export function MediaLibrary({ items, collapsed, children, listRef, dragging, importDisabled, onImport, onToggle }: {
  items: ImportedMedia[]
  collapsed: boolean
  children: ReactNode
  listRef?: Ref<HTMLDivElement>
  dragging?: boolean
  importDisabled?: boolean
  onImport: () => void
  onToggle: () => void
}) {
  const bytes = items.reduce((total, item) => total + (Number.isFinite(item.info.size) ? item.info.size : 0), 0)
  const toggleLabel = collapsed ? '展开素材栏' : '收缩素材栏'
  return <aside className={`library-panel${collapsed ? ' is-collapsed' : ''}`}>
    <div className="library-head">
      {!collapsed && <div className="library-title">
        <strong>素材列表 <span className="clip-count">{items.length}</span></strong>
        <span className="library-size">{formatLibrarySize(bytes)}</span>
      </div>}
      <button className="library-toggle" type="button" title={toggleLabel} aria-label={toggleLabel} aria-expanded={!collapsed} onClick={onToggle}>
        <IconChevron collapsed={collapsed}/>
      </button>
    </div>
    {!collapsed && <button className="library-add" type="button" disabled={importDisabled} onClick={onImport}>
      <IconPlus/>添加素材
    </button>}
    <div ref={listRef} className={`library-list${dragging ? ' is-dragging' : ''}`}>
      {children}
      {!collapsed && items.length === 0 && <div className="library-empty">
        <IconLibrary/>
        <span>素材会出现在这里</span>
        <small>拖入音频或视频，或点击上方导入</small>
      </div>}
      {collapsed && <button className="library-rail-add" type="button" title="导入素材" aria-label="导入素材" disabled={importDisabled} onClick={onImport}>
        <IconPlus/>
      </button>}
    </div>
    {collapsed && <span className="library-rail-label">素材</span>}
  </aside>
}

export function MediaLibraryItem({ item, selected, collapsed, onSelect, onRemove, onPointerDown, removalDisabled, onDragStart, onDragEnd }: {
  item: ImportedMedia
  selected: boolean
  collapsed: boolean
  onSelect: () => void
  onRemove: () => void
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  removalDisabled?: boolean
  onDragStart?: DragEventHandler<HTMLButtonElement>
  onDragEnd?: DragEventHandler<HTMLButtonElement>
}) {
  return <div data-library-id={item.id} className={`library-item${selected ? ' is-active' : ''}`} title={item.fileName}
    onPointerDown={onPointerDown}>
    <button className="library-main" type="button" onClick={onSelect}
      draggable={onDragStart ? true : undefined} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <span className="library-thumb">{item.info.videoStreams.length > 0 ? <IconFileVideo/> : <IconFileAudio/>}</span>
      {!collapsed && <span className="library-meta">
        <strong translate="no">{item.fileName}</strong>
        <span>{formatTime(item.info.duration, false)} · {summary(item)}</span>
      </span>}
    </button>
    {!collapsed && <button className="library-remove" type="button" title="从素材栏移除"
      aria-label={`从素材栏移除 ${item.fileName}`} disabled={removalDisabled} onClick={onRemove}>
      <IconTrash/>
    </button>}
  </div>
}

export function formatTime(seconds: number, milliseconds = true): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const totalMs = Math.round(safe * 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const s = totalSeconds % 60
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return milliseconds ? `${base}.${String(ms).padStart(3, '0')}` : base
}

export function formatLibrarySize(bytes: number): string {
  const MB = 1024 * 1024
  const GB = 1024 * MB
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.00MB'
  if (bytes < MB) return `${(bytes / MB).toFixed(2)}MB`
  if (bytes < GB) return `${Math.round(bytes / MB)}MB`
  return `${(bytes / GB).toFixed(2)}GB`
}

export function summary(media: ImportedMedia): string {
  const video = media.info.videoStreams[0]
  const audio = media.info.audioStreams[0]
  return [video?.codec, audio?.codec]
    .filter(Boolean)
    .map((value) => value!.toUpperCase())
    .join(' · ')
}

function IconChevron({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={collapsed ? 'is-collapsed' : undefined}
    >
      <path
        d="M14 6l-6 6 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  )
}

export function IconPlus(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor" />
    </svg>
  )
}

function IconTrash(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7h14M10 4h4l1 3H9zm-2 3l1 13h6l1-13M10 11v6m4-6v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  )
}

export function IconLibrary(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7h5l2 2h9v10H4zm0-3h6l2 2h8v2H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="miter"
      />
    </svg>
  )
}

export function IconFileAudio(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 3h8l4 4v14H6zM14 3v5h4M9 13v5m3-7v7m3-4v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  )
}

export function IconFileVideo(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 6h16v12H4zM10 9l5 3-5 3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />
    </svg>
  )
}
