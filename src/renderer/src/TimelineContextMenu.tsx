import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function TimelineContextMenu({ x, y, label, className = '', onDismiss, onEscape, children }: {
  x: number
  y: number
  label: string
  className?: string
  onDismiss: () => void
  onEscape?: () => void
  children: ReactNode
}) {
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = menu.current!
    element.showPopover()
    const bounds = element.getBoundingClientRect()
    element.style.left = `${Math.max(4, Math.min(x, innerWidth - bounds.width - 4))}px`
    element.style.top = `${Math.max(4, Math.min(y, innerHeight - bounds.height - 4))}px`
    const first = element.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? element
    first.focus({ preventScroll: true })

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

  return <div className={`timeline-context-menu ${className}`} ref={menu} popover="manual" role="menu" tabIndex={-1}
    aria-label={label} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
        onEscape?.()
        return
      }
      if (event.key === 'Tab') { onDismiss(); return }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      if (!buttons.length) return
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const step = event.key === 'ArrowUp' ? -1 : 1
      buttons[(index + step + buttons.length) % buttons.length]?.focus()
    }}>{children}</div>
}
