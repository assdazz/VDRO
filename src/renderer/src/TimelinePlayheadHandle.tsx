import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export type PlayheadDrag = {
  move: (deltaX: number) => void
  finish: (resume: boolean) => void
}

export function TimelinePlayheadHandle({ label, time, duration, seek, startDrag }: {
  label: string
  time: number
  duration: number
  seek: (time: number) => void
  startDrag: () => PlayheadDrag | undefined
}) {
  const pointer = useRef<{ id: number; x: number; drag?: PlayheadDrag } | null>(null)

  useEffect(() => () => { pointer.current?.drag?.finish(false) }, [])

  function finish(event: ReactPointerEvent<HTMLSpanElement>) {
    const current = pointer.current
    if (current?.id !== event.pointerId) return
    pointer.current = null
    if (event.type === 'pointerup') current.drag?.move(event.clientX - current.x)
    current.drag?.finish(true)
  }

  return <span className="timeline-playhead-handle" part="playhead-handle" role="slider" tabIndex={0}
    title={label} aria-label={label} aria-valuemin={0} aria-valuemax={duration}
    aria-valuenow={Math.round(Math.max(0, Math.min(duration, time)) * 1000) / 1000}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || pointer.current) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      pointer.current = { id: event.pointerId, x: event.clientX }
    }}
    onPointerMove={event => {
      const current = pointer.current
      if (current?.id !== event.pointerId) return
      const deltaX = event.clientX - current.x
      if (!current.drag && Math.abs(deltaX) >= 2) current.drag = startDrag()
      current.drag?.move(deltaX)
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      const destinations: Record<string, number> = {
        Home: 0, End: duration, ArrowLeft: time - 1, ArrowRight: time + 1,
        ArrowDown: time - 1, ArrowUp: time + 1,
      }
      if (!Object.hasOwn(destinations, event.key)) return
      event.preventDefault()
      event.stopPropagation()
      seek(Math.max(0, Math.min(duration, destinations[event.key])))
    }} />
}
