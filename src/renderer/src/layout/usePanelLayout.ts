import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { AppSettings } from '@shared/types'
import { MIN_VIDEO_PREVIEW_HEIGHT, MIN_VIDEO_AREA_HEIGHT, PANEL_RESIZER_HEIGHT, FIXED_AUDIO_HEIGHT, AUDIO_COLLAPSED_HEIGHT, AUDIO_EXPAND_DELTA, PREVIEW_COLLAPSED_HEIGHT, MIN_EDITOR_TOP_HEIGHT, LAYOUT_STORAGE_KEY, DEFAULT_LAYOUT, loadLayout, containedPanelHeight, clamp, editorMinimum } from './panelLayout'
import type { LayoutSettings } from './panelLayout'

export function usePanelLayout(settings: AppSettings, settingsLoaded: boolean, jobStatus?: string) {
  const mainColumnRef = useRef<HTMLDivElement>(null)
  const editorTopRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const timelinePanelRef = useRef<HTMLElement>(null)
  const extractedPanelRef = useRef<HTMLElement>(null)
  const [layout, setLayout] = useState<LayoutSettings>(DEFAULT_LAYOUT)
  const skipNextSave = useRef(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const [audioEditorHeight, setAudioEditorHeight] = useState<number | null>(null)
  const [audioToggling, setAudioToggling] = useState(false)
  const audioToggleTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (audioToggleTimerRef.current !== null) {
        window.clearTimeout(audioToggleTimerRef.current)
      }
    }
  }, [])



  const timelinePanelHeight = layout.timelineCollapsed
    ? AUDIO_COLLAPSED_HEIGHT
    : FIXED_AUDIO_HEIGHT
  const expandedPanelCount =
    Number(!layout.previewCollapsed) +
    Number(!layout.timelineCollapsed) +
    Number(!layout.extractedCollapsed)
  const soloPanel: 'preview' | 'timeline' | 'extracted' | null =
    expandedPanelCount !== 1
      ? null
      : !layout.previewCollapsed
        ? 'preview'
        : !layout.timelineCollapsed
          ? 'timeline'
          : 'extracted'
  const isPreviewSolo = soloPanel === 'preview'
  const isSoloSized =
    soloPanel !== null && soloPanel !== 'preview' && layout.soloHeight !== null
  const effectiveTimelineHeight = timelinePanelHeight
  // A collapsed video bar still occupies 60px. Never let the flex parent
  // shrink below its children when the extracted panel is dragged upward.
  const minimumEditorHeight = editorMinimum(layout.previewCollapsed, layout.timelineCollapsed)
  const togglePanel = useCallback(
    (panel: 'previewCollapsed' | 'timelineCollapsed' | 'extractedCollapsed'): void => {
      if (panel === 'timelineCollapsed') {
        if (layout.previewCollapsed) {
          // Video is a collapsed 60px bar. The audio panel is the only
          // expanding row, so the editor should be exactly their sum.
          setAudioEditorHeight(editorMinimum(true, !layout.timelineCollapsed))
        } else {
          const currentHeight =
            editorTopRef.current?.getBoundingClientRect().height ??
            (layout.timelineCollapsed
              ? MIN_VIDEO_AREA_HEIGHT +
                AUDIO_COLLAPSED_HEIGHT +
                PANEL_RESIZER_HEIGHT
              : MIN_EDITOR_TOP_HEIGHT)
          const delta = layout.timelineCollapsed
            ? AUDIO_EXPAND_DELTA
            : -AUDIO_EXPAND_DELTA
          const minHeight = editorMinimum(false, !layout.timelineCollapsed)
          const mainHeight =
            mainColumnRef.current?.getBoundingClientRect().height ?? 720
          const extractedFloor = layout.extractedCollapsed
            ? AUDIO_COLLAPSED_HEIGHT
            : 120
          const maxHeight = Math.max(
            minHeight,
            mainHeight - extractedFloor - PANEL_RESIZER_HEIGHT,
          )
          // Grow/shrink editor-top by the same delta as the audio panel so the
          // audio top edge stays fixed and the panel expands downward. Clamp
          // it so a video-only layout that already fills the window cannot be
          // pushed past the extracted panel.
          setAudioEditorHeight(
            Math.min(maxHeight, Math.max(minHeight, currentHeight + delta)),
          )
        }

        setAudioToggling(true)
        if (audioToggleTimerRef.current !== null) {
          window.clearTimeout(audioToggleTimerRef.current)
        }
        audioToggleTimerRef.current = window.setTimeout(() => {
          setAudioToggling(false)
          audioToggleTimerRef.current = null
        }, 220)
      } else if (panel === 'previewCollapsed') {
        if (layout.previewCollapsed) {
          // Expanding video from the all-collapsed state.
          setAudioEditorHeight(editorMinimum(false, layout.timelineCollapsed))
        } else {
          // Collapsing video: drop the editor to the two collapsed bars so
          // there is no empty space above the extracted-audio panel.
          setAudioEditorHeight(editorMinimum(true, layout.timelineCollapsed))
        }
      }

      setLayout((current) => ({
        ...current,
        [panel]: !current[panel],
        extractedRatio:
          panel === 'extractedCollapsed' && current.extractedCollapsed
            ? Math.max(current.extractedRatio, 0.18)
            : current.extractedRatio,
        soloHeight: null,
      }))
    },
    [layout.previewCollapsed, layout.timelineCollapsed],
  )

  const dragCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => dragCleanup.current?.(), [])
  const trackDrag = useCallback((onMove: (event: PointerEvent) => void, onUp: () => void): void => {
    dragCleanup.current?.()
    const finish = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      dragCleanup.current = null
      onUp()
    }
    dragCleanup.current = finish
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
    window.addEventListener('blur', finish, { once: true })
  }, [])

  const beginInspectorResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = layout.inspectorWidth
      const maxWidth = Math.max(240, Math.min(560, window.innerWidth - 650))
      const previousSelect = document.body.style.userSelect
      document.body.style.userSelect = 'none'

      const onMove = (moveEvent: PointerEvent): void => {
        setLayout((current) => ({
          ...current,
          inspectorWidth: clamp(startWidth + startX - moveEvent.clientX, 240, maxWidth),
        }))
      }
      const onUp = (): void => {
        document.body.style.userSelect = previousSelect
      }

      trackDrag(onMove, onUp)
    },
    [layout.inspectorWidth],
  )

  const beginTimelineResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight =
        editorTopRef.current?.getBoundingClientRect().height ?? 448
      const mainHeight =
        mainColumnRef.current?.getBoundingClientRect().height ?? 720
      const minEditorHeight = editorMinimum(false, layout.timelineCollapsed)
      const extractedFloor = layout.extractedCollapsed
        ? AUDIO_COLLAPSED_HEIGHT
        : 120
      const maxEditorHeight = Math.max(
        minEditorHeight,
        mainHeight - extractedFloor - PANEL_RESIZER_HEIGHT,
      )
      const previousSelect = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      document.body.classList.add('is-resizing-layout')

      const onMove = (moveEvent: PointerEvent): void => {
        setAudioEditorHeight(
          clamp(
            startHeight + (moveEvent.clientY - startY),
            minEditorHeight,
            maxEditorHeight,
          ),
        )
      }
      const onUp = (): void => {
        document.body.style.userSelect = previousSelect
        document.body.classList.remove('is-resizing-layout')
      }

      trackDrag(onMove, onUp)
    },
    [
      layout.timelineCollapsed,
      layout.extractedCollapsed,
    ],
  )

  const beginExtractedResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault()
      const startY = event.clientY
      const mainHeight =
        mainColumnRef.current?.getBoundingClientRect().height ?? 720
      const startExtractedHeight =
        extractedPanelRef.current?.getBoundingClientRect().height ??
        mainHeight * layout.extractedRatio
      // Capture the real displayed height. layout.extractedRatio can be stale
      // after the video slider freezes editor-top.
      const startRatio = clamp(startExtractedHeight / mainHeight, 0.18, 0.55)
      const maxRatio = Math.min(0.55, Math.max(0.18,
        (mainHeight - minimumEditorHeight - PANEL_RESIZER_HEIGHT) /
          Math.max(1, mainHeight - PANEL_RESIZER_HEIGHT),
      ))
      const soloMode = soloPanel === 'extracted'
      const startSolo = startExtractedHeight || 220
      const previousSelect = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      document.body.classList.add('is-resizing-layout')
      let moved = false

      const onMove = (moveEvent: PointerEvent): void => {
        if (soloMode) {
          const next = clamp(
            startSolo - (moveEvent.clientY - startY),
            120,
            extractedPanelRef.current && mainColumnRef.current
              ? containedPanelHeight(extractedPanelRef.current, mainColumnRef.current)
              : Math.max(120, mainHeight - 120),
          )
          setLayout((current) => ({ ...current, soloHeight: next }))
          return
        }

        // Do not touch layout until a real drag. A click on the handle must not
        // switch editor-top back to flex sizing with an old ratio.
        if (!moved) {
          moved = true
          setAudioEditorHeight(null)
        }
        const up = startY - moveEvent.clientY
        const nextRatio = clamp(startRatio + up / mainHeight, 0.18, maxRatio)
        setLayout((current) => ({
          ...current,
          extractedRatio: nextRatio,
        }))
      }
      const onUp = (): void => {
        document.body.style.userSelect = previousSelect
        document.body.classList.remove('is-resizing-layout')
      }

      trackDrag(onMove, onUp)
    },
    [layout.extractedRatio, soloPanel, minimumEditorHeight],
  )

  const beginSoloResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!soloPanel) return
      event.preventDefault()
      const startY = event.clientY
      const startHeight =
        soloPanel === 'preview'
          ? (workspaceRef.current?.getBoundingClientRect().height ?? 200)
          : soloPanel === 'timeline'
            ? (timelinePanelRef.current?.getBoundingClientRect().height ?? 220)
            : (extractedPanelRef.current?.getBoundingClientRect().height ?? 220)
      const mainHeight =
        mainColumnRef.current?.getBoundingClientRect().height ?? 720
      const previousSelect = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      document.body.classList.add('is-resizing-layout')

      const onMove = (moveEvent: PointerEvent): void => {
        const minHeight =
          soloPanel === 'preview' ? MIN_VIDEO_PREVIEW_HEIGHT : 120
        const next = clamp(
          startHeight + (moveEvent.clientY - startY),
          minHeight,
          soloPanel === 'extracted' && extractedPanelRef.current && mainColumnRef.current
            ? containedPanelHeight(extractedPanelRef.current, mainColumnRef.current)
            : Math.max(minHeight, mainHeight - 120),
        )
        setLayout((current) => ({ ...current, soloHeight: next }))
      }
      const onUp = (): void => {
        document.body.style.userSelect = previousSelect
        document.body.classList.remove('is-resizing-layout')
      }

      trackDrag(onMove, onUp)
    },
    [soloPanel],
  )

  useLayoutEffect(() => {
    if (soloPanel !== 'extracted') return
    const panel = extractedPanelRef.current
    const main = mainColumnRef.current
    if (!panel || !main) return
    const constrain = (): void => {
      const limit = containedPanelHeight(panel, main)
      setLayout((current) => current.soloHeight !== null && current.soloHeight > limit
        ? { ...current, soloHeight: limit }
        : current)
    }
    constrain()
    const observer = new ResizeObserver(constrain)
    observer.observe(main)
    window.addEventListener('resize', constrain)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', constrain)
    }
  }, [soloPanel, settings.uiScale, jobStatus])

  useEffect(() => {
    if (!settingsLoaded) return
    skipNextSave.current = true
    setLayout(settings.restoreLayout ? loadLayout() : DEFAULT_LAYOUT)
    setAudioEditorHeight(null)
    setLayoutReady(true)
  }, [settingsLoaded, settings.restoreLayout])

  useEffect(() => {
    try {
      if (skipNextSave.current) { skipNextSave.current = false; return }
      if (!settingsLoaded || !layoutReady || !settings.restoreLayout) return
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // Layout persistence is non-critical.
    }
  }, [layout, layoutReady, settingsLoaded, settings.restoreLayout])




  return { layout, setLayout, audioEditorHeight, setAudioEditorHeight, audioToggling, mainColumnRef, editorTopRef, workspaceRef, timelinePanelRef, extractedPanelRef, effectiveTimelineHeight, minimumEditorHeight, soloPanel, isPreviewSolo, isSoloSized, togglePanel, beginInspectorResize, beginTimelineResize, beginExtractedResize, beginSoloResize }
}
