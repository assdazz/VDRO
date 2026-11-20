import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { AppSettings } from '@shared/types'
import {
  clamp, DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, loadLayout, MIN_CLIP_TIME_HEIGHT,
  MIN_RESULTS_HEIGHT, MIN_TIMELINE_HEIGHT, MIN_VIDEO_PREVIEW_HEIGHT, PANEL_RESIZER_HEIGHT,
} from './panelLayout'
import type { LayoutSettings } from './panelLayout'

export function usePanelLayout(settings: AppSettings, settingsLoaded: boolean) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const mainColumnRef = useRef<HTMLElement>(null)
  const timelinePanelRef = useRef<HTMLElement>(null)
  const dockRef = useRef<HTMLElement>(null)
  const clipTimeRef = useRef<HTMLElement>(null)
  const [layout, setLayout] = useState<LayoutSettings>(DEFAULT_LAYOUT)
  const [layoutReady, setLayoutReady] = useState(false)
  const skipNextSave = useRef(false)
  const dragCleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => dragCleanup.current?.(), [])

  useEffect(() => {
    if (!settingsLoaded) return
    skipNextSave.current = true
    setLayout(settings.restoreLayout ? loadLayout() : DEFAULT_LAYOUT)
    setLayoutReady(true)
  }, [settingsLoaded, settings.restoreLayout])

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    if (!settingsLoaded || !layoutReady || !settings.restoreLayout) return
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // The layout remains usable when storage is unavailable.
    }
  }, [layout, layoutReady, settingsLoaded, settings.restoreLayout])

  function togglePanel(panel: 'previewCollapsed' | 'timelineCollapsed' | 'extractedCollapsed') {
    setLayout(current => ({ ...current, [panel]: !current[panel] }))
  }

  function startResize(
    event: ReactPointerEvent<HTMLDivElement>,
    panel: 'inspectorWidth' | 'timelineHeight' | 'clipTimeHeight',
    startSize: number,
    min: number,
    max: number,
    axis: 'x' | 'y',
    direction: 1 | -1,
  ) {
    if (event.button !== 0) return
    event.preventDefault()
    dragCleanup.current?.()
    const pointer = event.pointerId
    const start = axis === 'x' ? event.clientX : event.clientY
    const previousSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return
      const coordinate = axis === 'x' ? next.clientX : next.clientY
      const size = Math.round(clamp(startSize + (coordinate - start) * direction, min, max))
      setLayout(current => ({ ...current, [panel]: size }))
    }
    const finish = (next?: Event) => {
      if (next instanceof PointerEvent && next.pointerId !== pointer) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      document.body.style.userSelect = previousSelect
      dragCleanup.current = null
    }
    dragCleanup.current = finish
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
  }

  function beginInspectorResize(event: ReactPointerEvent<HTMLDivElement>) {
    const body = bodyRef.current
    const dock = dockRef.current
    if (!body || !dock) return
    startResize(event, 'inspectorWidth', dock.offsetWidth, 220, Math.min(560, body.clientWidth * .36), 'x', -1)
  }

  function beginTimelineResize(event: ReactPointerEvent<HTMLDivElement>) {
    const main = mainColumnRef.current
    const timeline = timelinePanelRef.current
    if (!main || !timeline) return
    const maximum = Math.min(660, main.clientHeight - MIN_VIDEO_PREVIEW_HEIGHT - PANEL_RESIZER_HEIGHT)
    startResize(event, 'timelineHeight', timeline.offsetHeight, MIN_TIMELINE_HEIGHT, maximum, 'y', -1)
  }

  function beginExtractedResize(event: ReactPointerEvent<HTMLDivElement>) {
    const dock = dockRef.current
    const clipTime = clipTimeRef.current
    if (!dock || !clipTime) return
    const maximum = Math.min(600, dock.clientHeight - MIN_RESULTS_HEIGHT - PANEL_RESIZER_HEIGHT)
    startResize(event, 'clipTimeHeight', clipTime.offsetHeight, MIN_CLIP_TIME_HEIGHT, maximum, 'y', 1)
  }

  return {
    layout, setLayout, bodyRef, mainColumnRef, timelinePanelRef, dockRef, clipTimeRef,
    togglePanel, beginInspectorResize, beginTimelineResize, beginExtractedResize,
  }
}
