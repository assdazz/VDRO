import { useCallback, useRef, useState } from 'react'

const HISTORY_LIMIT = 50

type History<T> = {
  past: T[]
  present: T
  future: T[]
  group?: object
}

export function useEditHistory<T>(initial: T, equal: (left: T, right: T) => boolean = Object.is) {
  const [history, setHistory] = useState<History<T>>({ past: [], present: initial, future: [] })
  const latest = useRef(history)

  const update = useCallback((next: History<T>) => {
    latest.current = next
    setHistory(next)
    return next.present
  }, [])

  const commit = useCallback((present: T, group?: object) => {
    const previous = latest.current
    if (equal(previous.present, present)) return
    const merge = group !== undefined && group === previous.group
    const past = merge ? previous.past : [...previous.past.slice(1 - HISTORY_LIMIT), previous.present]
    update({ past, present, future: [], group })
  }, [equal, update])

  const undo = useCallback(() => {
    const { past, present, future } = latest.current
    if (!past.length) return
    return update({ past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future] })
  }, [update])

  const redo = useCallback(() => {
    const { past, present, future } = latest.current
    if (!future.length) return
    return update({ past: [...past, present], present: future[0], future: future.slice(1) })
  }, [update])

  const reset = useCallback((present: T) => update({ past: [], present, future: [] }), [update])

  return { ...history, commit, undo, redo, reset }
}
