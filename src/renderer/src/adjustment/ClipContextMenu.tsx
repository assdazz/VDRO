import { useLayoutEffect, useRef } from 'react'
import { TimelineEditIcon } from '../TimelineEditControls'

const items = [
  { action: 'copy', label: '复制', shortcut: 'Ctrl+C' },
  { action: 'cut', label: '剪切', shortcut: 'Ctrl+X' },
  { action: 'reverse', label: '倒放', shortcut: '' },
  { action: 'delete', label: '删除', shortcut: 'Delete' },
] as const

export type ClipMenuAction = (typeof items)[number]['action']

export function ClipContextMenu({ x, y, locked, reversed, onAction, onDismiss }: {
  x: number
  y: number
  locked: boolean
  reversed: boolean
  onAction: (action: ClipMenuAction) => void
  onDismiss: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = menu.current!
    element.showPopover()
    const bounds = element.getBoundingClientRect()
    element.style.left = `${Math.max(4, Math.min(x, innerWidth - bounds.width - 4))}px`
    element.style.top = `${Math.max(4, Math.min(y, innerHeight - bounds.height - 4))}px`
    element.querySelector('button')?.focus({ preventScroll: true })
    function outside(event: PointerEvent) {
      if (!event.composedPath().includes(element)) onDismiss()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', onDismiss)
    window.addEventListener('resize', onDismiss)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', onDismiss)
      window.removeEventListener('resize', onDismiss)
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [x, y, onDismiss])

  return <div className="mix-clip-menu" ref={menu} popover="manual" role="menu" aria-label="片段操作"
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { onDismiss(); return }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.key === 'ArrowUp' ? buttons.length - 1 : 1)) % buttons.length]?.focus()
    }}>
    {items.map(({ action, label, shortcut }) => <button key={action} type="button" data-action={action}
      role={action === 'reverse' ? 'menuitemcheckbox' : 'menuitem'} aria-checked={action === 'reverse' ? reversed : undefined}
      disabled={locked && action !== 'copy'} aria-keyshortcuts={shortcut || undefined} onClick={() => onAction(action)}>
      <TimelineEditIcon action={action} />
      <span>{label}</span>
      {shortcut && <kbd translate="no">{shortcut}</kbd>}
    </button>)}
  </div>
}
