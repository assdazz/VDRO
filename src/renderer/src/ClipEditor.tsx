import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, DragEvent, JSX, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import type {
  AppInfo,
  AppSettings,
  ExportFormat,
  ExtractedClip,
  ImportedMedia,
  OutputQualitySetting,
  PeaksResult,
  PreviewFpsSetting,
  PreviewResolutionSetting,
  RegionRange,
  ShortcutSettings,
} from '@shared/types'
import { sanitizeSettings } from '@shared/settings'
import { DEFAULT_APP_SETTINGS } from '@shared/defaults'
import { translateUiText } from './i18n'
import './clip-editor.css'
import { formatLibrarySize, formatTime, summary, IconFileAudio, IconFileVideo, MediaLibrary, MediaLibraryItem } from './MediaLibrary'
import type { AppPage } from './PageTabs'
import { VolumeIcon } from './VolumeIcon'
import { TimelineToolPicker, useTimelineToolShortcuts, type TimelineTool } from './TimelineToolPicker'
import { TimelineEditControls } from './TimelineEditControls'
import { TimelinePlayheadHandle, type PlayheadDrag } from './TimelinePlayheadHandle'
import { WaveformZoomControls } from './WaveformZoomControls'
import { MissingMediaList } from './MissingMediaList'
import { readDraft, saveDraft, reportProjectState } from './projectDraft'
import { useTimelineHistoryShortcuts } from './useTimelineHistoryShortcuts'
import { useEditHistory } from './useEditHistory'
import { useMediaPreview } from './playback/useMediaPreview'
import { usePanelLayout } from './layout/usePanelLayout'
import { DEFAULT_LAYOUT, MIN_CLIP_TIME_HEIGHT, MIN_RESULTS_HEIGHT, MIN_TIMELINE_HEIGHT, MIN_VIDEO_PREVIEW_HEIGHT, PANEL_RESIZER_HEIGHT } from './layout/panelLayout'
import { findClipSource, bindClipSource } from './mediaSources'
const SettingsDialog = lazy(() => import('./SettingsDialog').then((module) => ({
  default: module.SettingsDialog,
})))

interface RegionLike {
  start: number
  end: number
  setOptions: (options: { start?: number; end?: number }) => void
}

interface JobState {
  id: string
  progress: number
  status: 'exporting' | 'done' | 'error' | 'cancelled'
  outputPath?: string
  message?: string
}

interface LibraryDragState {
  itemId: string
  x: number
  y: number
  width: number
  height: number
  targetIndex: number | null
}

const FORMATS: Array<{ value: ExportFormat; label: string; detail: string }> = [
  { value: 'mp3', label: 'MP3', detail: '兼容 / 分享' },
  { value: 'wav', label: 'WAV', detail: '无损 / 精确' },
  { value: 'm4a', label: 'M4A', detail: 'AAC / 通用' },
  { value: 'flac', label: 'FLAC', detail: '无损压缩' },
]

const QUALITY_OPTIONS = [96, 128, 192, 256, 320]

const PREVIEW_RESOLUTIONS = [
  { label: '360P', height: 360 },
  { label: '480P', height: 480 },
  { label: '720P', height: 720 },
  { label: '1080P', height: 1080 },
  { label: '2K', height: 1440 },
  { label: '4K', height: 2160 },
]

const PREVIEW_FPS = [30, 60, 120, 144]
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const sameRange = (left: RegionRange, right: RegionRange) => left.start === right.start && left.end === right.end

type ClipProject = { paths: string[]; current?: string; timelines: Record<string, ClipTimeline> }
type ClipTimeline = { range: RegionRange; cuts: number[]; markers: number[] }
const sameClipTimeline = (left: ClipTimeline, right: ClipTimeline) =>
  left.cuts === right.cuts && left.markers === right.markers && sameRange(left.range, right.range)

function rangeAtCut(time: number, cuts: number[], duration: number): RegionRange {
  const next = cuts.findIndex(cut => cut > time)
  return next < 0 ? { start: cuts.at(-1) ?? 0, end: duration }
    : { start: cuts[next - 1] ?? 0, end: cuts[next] }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 渲染层波形缓存的条目上限：大文件波形很大，超过条数就淘汰最早 unused 的旧条目，
// 否则连续浏览多个大文件后内存会持续上涨。
const MAX_CACHED_PEAKS = 6

// LRU 式写入：先删后插刷新顺序，超上限时淘汰最早的旧条目。
function rememberPeaks(
  cache: Map<string, PeaksResult>,
  mediaId: string,
  result: PeaksResult,
): void {
  cache.delete(mediaId)
  cache.set(mediaId, result)
  while (cache.size > MAX_CACHED_PEAKS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

interface ClipEditorProps {
  projectId?: string
  active: boolean
  onNavigate: (page: AppPage) => void
  onAdjustClip: (clip: ExtractedClip) => void
  requestedMedia: { media: ImportedMedia } | null
  onLibraryChange: (library: ImportedMedia[]) => void
  onTitleChange: (value: { media: ImportedMedia | null; duration: number }) => void
  settingsRequest: number
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  onSettingsRead: (settings: AppSettings) => void
  settingsLoaded: boolean
  setSettingsLoaded: (loaded: boolean) => void
}

export default function ClipEditor({
  projectId,
  active,
  onNavigate,
  onAdjustClip,
  requestedMedia,
  onLibraryChange,
  onTitleChange,
  settingsRequest,
  settings,
  setSettings,
  onSettingsRead,
  settingsLoaded,
  setSettingsLoaded,
}: ClipEditorProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  const dragBoxRef = useRef<HTMLDivElement>(null)
  const splitGuideRef = useRef<HTMLSpanElement>(null)
  const timelineToolRef = useRef<TimelineTool>('select')
  const [timelineTool, setTimelineTool] = useState<TimelineTool>('select')
  const waveSurferRef = useRef<WaveSurfer | null>(null)
  const [waveCursor, setWaveCursor] = useState<HTMLDivElement | null>(null)
  const regionRef = useRef<RegionLike | null>(null)
  const regionRangeRef = useRef<RegionRange>({ start: 0, end: 0 })
  const peaksCacheRef = useRef(new Map<string, PeaksResult>())
  const extractedAudioRef = useRef<HTMLAudioElement>(null)
  const extractedPlaybackRef = useRef(false)
  const extractedSyncFrameRef = useRef<number | null>(null)
  const outputControlsRef = useRef<HTMLDivElement>(null)
  const libraryListRef = useRef<HTMLDivElement>(null)
  const libraryDragRef = useRef<LibraryDragState | null>(null)
  const libraryPreviousPositionsRef = useRef<Map<string, number>>(new Map())
  const libraryPressRef = useRef<{
    itemId: string
    startX: number
    startY: number
    pointerId: number
    timer: number | null
    cleanup: (() => void) | null
  } | null>(null)
  const suppressLibraryClickRef = useRef(false)
  const zoomFactorRef = useRef(1)
  const zoomTrackRef = useRef<HTMLDivElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const [nativePreview, setNativePreview] = useState(true)
  const previewSettingsRef = useRef<HTMLDivElement>(null)
  const previewMenuRef = useRef<HTMLDivElement>(null)
  const appRootRef = useRef<HTMLDivElement>(null)
  const [media, setMedia] = useState<ImportedMedia | null>(null)
  const [library, setLibrary] = useState<ImportedMedia[]>([])
  const libraryRef = useRef(library)
  libraryRef.current = library
  useEffect(() => () => {
    for (const item of libraryRef.current) void window.vdro.releaseMedia(item.id).catch(() => undefined)
  }, [])
  const handledHomeMedia = useRef<typeof requestedMedia>(null)
  useEffect(() => onLibraryChange(library), [library, onLibraryChange])
  const [libraryCollapsed, setLibraryCollapsed] = useState(false)
  const [libraryDrag, setLibraryDrag] = useState<LibraryDragState | null>(null)
  const [extractedClips, setExtractedClips] = useState<ExtractedClip[]>([])
  const [activeExtractedClip, setActiveExtractedClip] = useState<ExtractedClip | null>(null)
  const [playingExtractedId, setPlayingExtractedId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [savingClipId, setSavingClipId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)


  const [openOutputMenu, setOpenOutputMenu] = useState<'format' | 'quality' | null>(null)
  const [previewResolution, setPreviewResolution] = useState(1080)
  const [previewFps, setPreviewFps] = useState(30)
  const [openPreviewSettings, setOpenPreviewSettings] = useState(false)
  const [previewMenuStyle, setPreviewMenuStyle] = useState<CSSProperties>({})
  const [peaks, setPeaks] = useState<PeaksResult | null>(null)
  const [audioStreamIndex, setAudioStreamIndex] = useState<number | null>(null)
  const [duration, setDuration] = useState(0)
  useEffect(() => onTitleChange({ media, duration }), [media, duration, onTitleChange])
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [loop, setLoop] = useState(false)
  const [region, setRegion] = useState<RegionRange>({ start: 0, end: 0 })
  const { present: clipTimeline, past: pastRanges, future: futureRanges, commit: recordTimeline, reset: resetTimeline,
    undo: undoRange, redo: redoRange } = useEditHistory<ClipTimeline>({ range: { start: 0, end: 0 }, cuts: [], markers: [] }, sameClipTimeline)
  const clipTimelineRef = useRef(clipTimeline)
  clipTimelineRef.current = clipTimeline
  const [format, setFormat] = useState<ExportFormat>(DEFAULT_APP_SETTINGS.outputFormat)
  const [sampleRate, setSampleRate] = useState(48000)
  const [channels, setChannels] = useState<1 | 2>(2)
  const [bitrate, setBitrate] = useState(192)
  const [useNativeQuality, setUseNativeQuality] = useState(false)
  const [job, setJob] = useState<JobState | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomFactor, setZoomFactor] = useState(1)
  const [zoomPxPerSec, setZoomPxPerSec] = useState(0)
  const [zoomScroll, setZoomScroll] = useState(0)
  const [zoomViewportWidth, setZoomViewportWidth] = useState(0)
  const [zoomMaxScroll, setZoomMaxScroll] = useState(0)
  const [zoomTrackWidth, setZoomTrackWidth] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => { if (settingsRequest > 0) setSettingsOpen(true) }, [settingsRequest])
  const {
    layout, setLayout, bodyRef, mainColumnRef, timelinePanelRef, dockRef, clipTimeRef,
    togglePanel, beginInspectorResize, beginTimelineResize, beginExtractedResize,
  } = usePanelLayout(settings, settingsLoaded)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  const changeTimelineTool = useCallback((tool: TimelineTool) => {
    timelineToolRef.current = tool
    setTimelineTool(tool)
    if (splitGuideRef.current) splitGuideRef.current.hidden = true
  }, [])
  useTimelineToolShortcuts(active && !layout.timelineCollapsed, settings.shortcuts, changeTimelineTool)

  const hasVideo = Boolean(media && media.info.videoStreams.length > 0)
  const sourceVideo = media?.info.videoStreams[0]
  const sourceAudio = media?.info.audioStreams.find((stream) => stream.index === audioStreamIndex)
  const clipDuration = Math.max(0, region.end - region.start)
  const visibleDuration =
    zoomPxPerSec > 0 && zoomViewportWidth > 0
      ? zoomViewportWidth / zoomPxPerSec
      : duration
  const visibleStartTime = zoomPxPerSec > 0 ? zoomScroll / zoomPxPerSec : 0
  const visibleEndTime = visibleStartTime + visibleDuration
  const zoomThumbWidth =
    zoomMaxScroll > 0 && zoomTrackWidth > 0
      ? Math.max(
          36,
          zoomTrackWidth * (zoomViewportWidth / (zoomViewportWidth + zoomMaxScroll)),
        )
      : 0
  const zoomThumbMaxLeft = Math.max(0, zoomTrackWidth - zoomThumbWidth)
  const zoomThumbLeft =
    zoomMaxScroll > 0 && zoomThumbMaxLeft > 0
      ? (zoomScroll / zoomMaxScroll) * zoomThumbMaxLeft
      : 0
  const extractedOverlay =
    activeExtractedClip &&
    media &&
    activeExtractedClip.sourceMediaId === media.id &&
    duration > 0 &&
    visibleDuration > 0
      ? (() => {
          const start = Math.max(activeExtractedClip.start, visibleStartTime)
          const end = Math.min(activeExtractedClip.end, visibleEndTime)
          if (end <= start) return null
          return {
            left: `${((start - visibleStartTime) / visibleDuration) * 100}%`,
            width: `${((end - start) / visibleDuration) * 100}%`,
          }
        })()
      : null
  const canExport =
    Boolean(media) &&
    Boolean(peaks) &&
    clipDuration >= 0.02 &&
    job?.status !== 'exporting' &&
    !loading
  const canExtract = canExport && !extracting
  const canExtractFull =
    Boolean(media) && Boolean(peaks) && audioStreamIndex !== null && !extracting
  const canEditTimeline = !!peaks && !loading && !extracting
  const isPreviewPlaying = playing || playingExtractedId !== null
  const clampedCurrentTime = Math.min(Math.max(currentTime, 0), duration || 0)
  const displayCurrentTime =
    duration > 0 && duration - clampedCurrentTime <= 0.03
      ? duration
      : clampedCurrentTime
  const previewProgressPercent =
    duration > 0 ? clamp((displayCurrentTime / duration) * 100, 0, 100) : 0
  const isMaterialTheme = settings.theme === 'acrylic'
  const isTranslucent = isMaterialTheme && settings.translucent
  const effectiveSkipSeconds =
    settings.skipSeconds === 'custom' ? settings.customSkipSeconds : settings.skipSeconds
  const losslessFormat = format === 'wav' || format === 'flac'
  const formatLabel = FORMATS.find((item) => item.value === format)?.label ?? format.toUpperCase()
  const nativeBitrateKbps =
    sourceAudio?.bitRate && sourceAudio.bitRate > 0
      ? Math.round(sourceAudio.bitRate / 1000)
      : null
  const effectiveBitrate =
    useNativeQuality && nativeBitrateKbps ? nativeBitrateKbps : bitrate
  const qualityLabel = losslessFormat
    ? '无损'
    : useNativeQuality
      ? `原生（${nativeBitrateKbps ?? '—'}-kbps）`
      : `${bitrate} kbps`
  const previewResolutionLabel =
    PREVIEW_RESOLUTIONS.find((item) => item.height === previewResolution)?.label ?? `${previewResolution}P`
  const sourceFps = sourceVideo?.frameRate ?? 0
  const sourceFpsLabel = sourceVideo
    ? Number.isInteger(sourceFps)
      ? String(sourceFps)
      : sourceFps.toFixed(2)
    : '—'

  useEffect(() => {
    if (!sourceVideo) return
    const nearestResolution = PREVIEW_RESOLUTIONS.reduce((best, item) =>
      Math.abs(item.height - sourceVideo.height) < Math.abs(best.height - sourceVideo.height)
        ? item
        : best,
    )
    setPreviewResolution(
      settings.previewResolution === 'follow'
        ? nearestResolution.height
        : settings.previewResolution,
    )

    const rawRate = sourceVideo.frameRate ?? 30
    const sourceRate = Number.isFinite(rawRate) ? rawRate : 30
    const nearestFps = PREVIEW_FPS.reduce((best, fps) =>
      Math.abs(fps - sourceRate) < Math.abs(best - sourceRate) ? fps : best,
    )
    setPreviewFps(settings.previewFps === 'follow' ? nearestFps : settings.previewFps)
    setNativePreview(settings.previewResolution === 'follow' && settings.previewFps === 'follow')
  }, [media?.id, settings.previewResolution, settings.previewFps])

  const syncRegion = useCallback((next: RegionRange): void => {
    regionRangeRef.current = next
    setRegion(next)
  }, [])

  const applyRegion = useCallback((next: RegionRange) => {
    const current = regionRef.current
    if (!current) return
    setActiveExtractedClip(null)
    current.setOptions(next)
    const range = { start: current.start, end: current.end }
    syncRegion(range)
    return range
  }, [syncRegion])

  const recordRange = useCallback((range: RegionRange) => recordTimeline({ ...clipTimelineRef.current, range }), [recordTimeline])

  const editRegion = useCallback((next: RegionRange) => {
    const range = applyRegion(next)
    if (range) recordRange(range)
  }, [applyRegion, recordRange])

  const [unavailablePaths, setUnavailablePaths] = useState<string[]>([])
  const projectCurrent = useRef<string | undefined>(undefined)
  const projectTimelines = useRef<Record<string, ClipTimeline>>({})
  const timelineOwner = useRef('')
  const [workspaceReady, setWorkspaceReady] = useState(false)
  useEffect(() => {
    if (!projectId || !workspaceReady) return
    if (media && timelineOwner.current === media.filePath) projectTimelines.current[media.filePath] = clipTimeline
    try {
      saveDraft(projectId, 'clip', { paths: [...library.map(item => item.filePath), ...unavailablePaths], current: media?.filePath ?? projectCurrent.current, timelines: projectTimelines.current })
    } catch { setError('无法保存项目，请重试。') }
  }, [workspaceReady, projectId, media, library, clipTimeline, unavailablePaths])

  useEffect(() => {
    const guard = (event: Event) => { if (extracting || savingClipId) event.preventDefault() }
    window.addEventListener('vdro:before-project-change', guard)
    return () => window.removeEventListener('vdro:before-project-change', guard)
  }, [extracting, savingClipId])

  async function relinkClipAsset(path: string, choose: boolean) {
    if (loading || extracting) return
    setLoading(true)
    let imported: ImportedMedia | null = null
    try {
      imported = choose ? await window.vdro.openFile(settings.mediaDirectory) : await window.vdro.importPath(path)
      if (!imported) return
      const stream = imported.info.audioStreams.find(item => item.isDefault) ?? imported.info.audioStreams[0]
      if (!stream) throw new Error('该文件没有音轨')
      const saved = projectTimelines.current[path]
      if (saved && Math.max(saved.range.end, ...saved.cuts, ...saved.markers) > imported.info.duration + .001) {
        throw new Error('替换素材时长不足，无法恢复原片段。')
      }
      const waveform = await window.vdro.getPeaks(imported.id, stream.index)
      rememberPeaks(peaksCacheRef.current, imported.id, waveform)
      if (saved) projectTimelines.current[imported.filePath] = saved
      if (path !== imported.filePath) delete projectTimelines.current[path]
      const recovered = imported
      setLibrary(previous => [...previous.filter(item => item.filePath !== path), recovered])
      setUnavailablePaths(previous => previous.filter(item => item !== path))
      if (projectCurrent.current === path || !media) {
        projectCurrent.current = recovered.filePath
        await adoptMedia(recovered)
      }
      imported = null
      setError(null)
    } catch (cause) { setError(errorMessage(cause)) }
    finally {
      if (imported) void window.vdro.releaseMedia(imported.id).catch(() => undefined)
      setLoading(false)
    }
  }

  const mediaRequest = useRef(0)
  useEffect(() => () => { mediaRequest.current++ }, [])
  const adoptMedia = useCallback(
    async (next: ImportedMedia): Promise<boolean> => {
      timelineOwner.current = ''
      const request = ++mediaRequest.current
      setLoading(true)
      setError(null)
      setPeaks(null)
      setJob(null)
      setPreviewing(false)
      setActiveExtractedClip(null)
      setPlayingExtractedId(null)
      extractedPlaybackRef.current = false
      if (extractedSyncFrameRef.current !== null) {
        cancelAnimationFrame(extractedSyncFrameRef.current)
        extractedSyncFrameRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.muted = settings.previewMuted
        videoRef.current.volume = settings.previewVolume / 100
      }
      extractedAudioRef.current?.pause()

      try {
        if (next.info.audioStreams.length === 0) {
          throw new Error('该文件没有音频轨道，无法提取音频')
        }

        const audio =
          next.info.audioStreams.find((stream) => stream.isDefault) ??
          next.info.audioStreams[0]

        projectCurrent.current = next.filePath
        setMedia(next)
        setLibrary((previous) =>
          previous.some((item) => item.id === next.id) ? previous : [...previous, next],
        )
        setAudioStreamIndex(audio.index)
        setDuration(next.info.duration)
        setRegion({ start: 0, end: 0 })
        regionRangeRef.current = { start: 0, end: 0 }
        setCurrentTime(0)

        let nextPeaks = peaksCacheRef.current.get(next.id)
        if (!nextPeaks) {
          nextPeaks = await window.vdro.getPeaks(next.id, audio.index)
        }
        if (request !== mediaRequest.current) return false
        rememberPeaks(peaksCacheRef.current, next.id, nextPeaks)
        setPeaks(nextPeaks)
        setDuration(nextPeaks.duration)
        return true
      } catch (cause) {
        if (request !== mediaRequest.current) return false
        setMedia(null)
        setPeaks(null)
        setAudioStreamIndex(null)
        setError(errorMessage(cause))
        return false
      } finally {
        if (request === mediaRequest.current) setLoading(false)
      }
    },
    [settings.previewMuted, settings.previewVolume],
  )

  useEffect(() => {
    if (!requestedMedia || handledHomeMedia.current === requestedMedia) return
    handledHomeMedia.current = requestedMedia
    void adoptMedia(requestedMedia.media)
  }, [requestedMedia, adoptMedia])

  const handleOpen = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const imported = await window.vdro.openFile(settings.mediaDirectory)
      if (imported) await adoptMedia(imported)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [adoptMedia, settings.mediaDirectory])

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>): Promise<void> => {
      event.preventDefault()
      setDragging(false)
      const files = Array.from(event.dataTransfer.files ?? [])
      if (files.length === 0) return

      const importedItems: ImportedMedia[] = []
      const failures: string[] = []

      for (const file of files) {
        const filePath = window.vdro.getPathForFile(file)
        if (!filePath) {
          failures.push(`${file.name}: 无法读取路径`)
          continue
        }
        try {
          importedItems.push(await window.vdro.importPath(filePath))
        } catch (cause) {
          failures.push(`${file.name}: ${errorMessage(cause)}`)
        }
      }

      if (importedItems.length > 0) {
        setLibrary((previous) => {
          const existing = new Set(previous.map((item) => item.id))
          return [...previous, ...importedItems.filter((item) => !existing.has(item.id))]
        })
        await adoptMedia(importedItems[0])
      }

      if (failures.length > 0) {
        setError(failures.join('\n'))
      }
    },
    [adoptMedia],
  )

  useMediaPreview({ media, hasVideo, videoRef, previewCanvasRef, extractedAudioRef, extractedPlaybackRef, nativePreview, previewResolution, previewFps, setDuration, setCurrentTime, setPlaying, setPreviewing, setPlayingExtractedId })

  useEffect(() => {
    const video = videoRef.current
    const container = waveRef.current
    if (!media || !peaks || !video || !container) return

    zoomFactorRef.current = 1
    setZoomFactor(1)
    setZoomPxPerSec(0)
    setZoomScroll(0)
    setZoomMaxScroll(0)

    const waveSurfer = WaveSurfer.create({
      container,
      media: video,
      peaks: [peaks.peaks],
      duration: peaks.duration,
      height: 'auto',
      waveColor: '#585858',
      progressColor: '#a0a0a0',
      cursorColor: 'var(--vd-playhead)',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 0,
      normalize: true,
      interact: true,
      dragToSeek: false,
      autoScroll: false,
      autoCenter: false,
      hideScrollbar: true,
    })

    const regions = waveSurfer.registerPlugin(RegionsPlugin.create())
    // 不用 enableDragSelection：选区元素自己会 preventDefault 掉 pointermove，
    // 在已有选区内部按下就拖不出新范围。框选走下面的自定义手势。

    const handleRegion = (next: RegionLike): void => {
      regionRef.current = next
      syncRegion({ start: next.start, end: next.end })
    }

    // 两端手柄自己就是 resize，别让它冒泡到外层触发"拖出新选区"，否则一次拖动两头打架。
    const bindRegionHandles = (next: RegionLike): void => {
      const element = (next as unknown as { element?: HTMLElement | null }).element
      if (!element) return
      for (const handle of element.querySelectorAll<HTMLElement>('[part*="region-handle"]')) {
        if (handle.dataset.vdroHandleBound === '1') continue
        handle.dataset.vdroHandleBound = '1'
        handle.addEventListener('pointerdown', (event) => event.stopPropagation())
      }
    }

    // 拖动过程中实时更新起止时间读数，一帧一次，避免每个 pointermove 都 setState。
    let pendingFrame = 0
    regions.on('region-update', (next) => {
      if (pendingFrame) return
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0
        syncRegion({ start: next.start, end: next.end })
      })
    })

    regions.on('region-created', (next) => {
      for (const other of regions.getRegions()) {
        if (other.id !== next.id) {
          setTimeout(() => other.remove(), 0)
        }
      }
      bindRegionHandles(next)
      handleRegion(next)
    })
    regions.on('region-updated', (next) => {
      if (pendingFrame) cancelAnimationFrame(pendingFrame)
      pendingFrame = 0
      setActiveExtractedClip(null)
      bindRegionHandles(next)
      handleRegion(next)
      recordRange(regionRangeRef.current)
    })

    // 框选手势：在波形任意位置按住拖动就重画选区，选区内部同样有效。
    // 拖动过程只画一层预览框，松手才真正建选区——不逐帧改插件实例，避免
    // 选区对象被替换后 setOptions 静默失效。
    const wrapper = waveSurfer.getWrapper()
    setWaveCursor(wrapper.querySelector<HTMLDivElement>('[part="cursor"]'))
    const dragBox = dragBoxRef.current
    const splitGuide = splitGuideRef.current
    const pxPerSecond = (): number => {
      const total = waveSurfer.getDuration()
      if (total <= 0) return 0
      return wrapper.getBoundingClientRect().width / total
    }
    const timeAtX = (clientX: number): number => {
      const rect = wrapper.getBoundingClientRect()
      const pxPerSec = pxPerSecond()
      if (pxPerSec <= 0) return 0
      return Math.min(Math.max((clientX - rect.left) / pxPerSec, 0), waveSurfer.getDuration())
    }
    const isRegionHandleEvent = (event: MouseEvent): boolean =>
      event.composedPath().some((node) => {
        if (!(node instanceof Element)) return false
        return (node.getAttribute('part') ?? '').includes('region-handle')
      })
    const isPlayheadEvent = (event: MouseEvent): boolean =>
      event.composedPath().some(node => node instanceof Element && node.getAttribute('part') === 'playhead-handle')

    let dragOriginX: number | null = null
    let dragOriginTime = 0
    let dragPxPerSec = 0
    let dragRectLeft = 0
    let dragActive = false
    let dragScrollAnchor = 0
    let suppressClickUntil = 0
    let selectionPointerId: number | null = null
    let previousRange: RegionRange | null = null

    const resetSelection = (): void => {
      const pointerId = selectionPointerId
      selectionPointerId = null
      if (pointerId !== null && container.hasPointerCapture(pointerId)) {
        container.releasePointerCapture(pointerId)
      }
      if (dragBox) dragBox.hidden = true
      container.classList.remove('is-selecting')
      dragOriginX = null
      dragActive = false
      previousRange = null
    }

    const rangeFrom = (clientX: number): { start: number; end: number } => {
      const offset = dragPxPerSec > 0 ? (clientX - dragOriginX!) / dragPxPerSec : 0
      const total = waveSurfer.getDuration()
      const current = Math.min(Math.max(dragOriginTime + offset, 0), total)
      return { start: Math.min(dragOriginTime, current), end: Math.max(dragOriginTime, current) }
    }

    const onSelectPointerDown = (event: PointerEvent): void => {
      if (timelineToolRef.current === 'split' || event.button !== 0 || !event.isPrimary ||
        selectionPointerId !== null || isRegionHandleEvent(event) || isPlayheadEvent(event)) return
      selectionPointerId = event.pointerId
      previousRange = { ...regionRangeRef.current }
      dragOriginX = event.clientX
      dragOriginTime = timeAtX(event.clientX)
      dragPxPerSec = pxPerSecond()
      dragRectLeft = container.getBoundingClientRect().left
      dragScrollAnchor = waveSurfer.getScroll()
      dragActive = false
      if (dragBox) dragBox.hidden = true
    }
    const onSelectPointerMove = (event: PointerEvent): void => {
      if (dragOriginX === null || event.pointerId !== selectionPointerId) return
      const deltaX = event.clientX - dragOriginX
      if (!dragActive && Math.abs(deltaX) < 4) return
      // Capture only once dragging starts so a simple click still seeks normally.
      if (!dragActive) container.setPointerCapture(event.pointerId)
      dragActive = true
      event.preventDefault()
      event.stopPropagation()
      container.classList.add('is-selecting')
      const { start, end } = rangeFrom(event.clientX)
      if (dragBox) {
        dragBox.hidden = false
        const originX = wrapper.getBoundingClientRect().left
        dragBox.style.left = `${originX + start * dragPxPerSec - dragRectLeft}px`
        dragBox.style.width = `${(end - start) * dragPxPerSec}px`
      }
      if (end - start >= 0.02) syncRegion({ start, end })
      // 拖动只画选区，视图不许跟着滚，否则波形看着像被"拖小"了。
      if (waveSurfer.getScroll() !== dragScrollAnchor) {
        try {
          waveSurfer.setScroll(dragScrollAnchor)
        } catch {
          // 滚动锁定失败不影响框选本身。
        }
      }
    }
    const onSelectPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== selectionPointerId) return
      if (dragActive && dragOriginX !== null) {
        event.preventDefault()
        event.stopPropagation()
        // 拖完那一下不要顺手把播放头 seek 到松手位置。
        suppressClickUntil = Date.now() + 400
        setActiveExtractedClip(null)
        const range = rangeFrom(event.clientX)
        if (range.end - range.start >= 0.02) {
          const created = regions.addRegion({
            start: range.start,
            end: range.end,
            color: 'rgba(250,255,105,0.10)',
            drag: false,
            resize: true,
          })
          recordRange({ start: created.start, end: created.end })
        } else if (previousRange) {
          syncRegion(previousRange)
        }
      }
      resetSelection()
    }
    const onSelectCancel = (event?: PointerEvent): void => {
      if (selectionPointerId === null || (event && event.pointerId !== selectionPointerId)) return
      if (dragActive) {
        suppressClickUntil = Date.now() + 400
        if (previousRange) syncRegion(previousRange)
      }
      resetSelection()
    }
    const onSelectBlur = (): void => onSelectCancel()
    const hideSplitGuide = (): void => { if (splitGuide) splitGuide.hidden = true }
    const splitAtX = (clientX: number) => {
      if (!regionRef.current) return
      const time = +timeAtX(clientX).toFixed(6)
      const part = rangeAtCut(time, clipTimelineRef.current.cuts, waveSurfer.getDuration())
      if (time - part.start < .02 || part.end - time < .02) return
      return { time, part }
    }
    const onSplitHover = (event: PointerEvent): void => {
      if (!splitGuide || timelineToolRef.current !== 'split') return
      if (isPlayheadEvent(event)) { hideSplitGuide(); return }
      const split = splitAtX(event.clientX)
      splitGuide.hidden = !split
      if (split) splitGuide.style.left = `${wrapper.getBoundingClientRect().left + split.time * pxPerSecond() - container.getBoundingClientRect().left}px`
    }
    const onSelectClickCapture = (event: MouseEvent): void => {
      if (isPlayheadEvent(event)) {
        event.stopPropagation()
        event.preventDefault()
      } else if (timelineToolRef.current === 'split') {
        event.stopPropagation()
        event.preventDefault()
        const split = splitAtX(event.clientX)
        if (!split) return
        const { time, part } = split
        const range = applyRegion({ start: part.start, end: time })
        if (!range) return
        const timeline = clipTimelineRef.current
        const cuts = [...timeline.cuts, time].sort((a, b) => a - b)
        recordTimeline({ ...timeline, range, cuts })
        hideSplitGuide()
        waveSurfer.setTime(time)
      } else if (Date.now() <= suppressClickUntil) {
        event.stopPropagation()
        event.preventDefault()
      } else if (clipTimelineRef.current.cuts.length && !isRegionHandleEvent(event)) {
        const range = rangeAtCut(timeAtX(event.clientX), clipTimelineRef.current.cuts, waveSurfer.getDuration())
        editRegion(range)
      }
    }

    container.addEventListener('pointerdown', onSelectPointerDown, true)
    window.addEventListener('pointermove', onSelectPointerMove, true)
    window.addEventListener('pointerup', onSelectPointerUp, true)
    window.addEventListener('pointercancel', onSelectCancel, true)
    container.addEventListener('lostpointercapture', onSelectCancel)
    window.addEventListener('blur', onSelectBlur)
    container.addEventListener('click', onSelectClickCapture, true)
    container.addEventListener('pointermove', onSplitHover, true)
    container.addEventListener('pointerleave', hideSplitGuide)

    waveSurfer.on('ready', () => {
      const saved = projectTimelines.current[media.filePath]
      if (regions.getRegions().length === 0) {
        const end = Math.min(10, Math.max(1, peaks.duration))
        const initial = regions.addRegion({
          start: saved?.range.start ?? 0,
          end: saved?.range.end ?? end,
          color: 'rgba(250,255,105,0.10)',
          drag: false,
          resize: true,
        })
        bindRegionHandles(initial)
        handleRegion(initial)
      }
      timelineOwner.current = media.filePath
      resetTimeline(saved ?? { range: regionRangeRef.current, cuts: [], markers: [] })

      const width = waveSurfer.getWidth()
      const fitPxPerSec = peaks.duration > 0 ? width / peaks.duration : 0
      zoomFactorRef.current = 1
      setZoomFactor(1)
      setZoomPxPerSec(fitPxPerSec)
      setZoomViewportWidth(width)
      setZoomScroll(0)
      setZoomMaxScroll(0)
    })

    const handleScroll = (
      _visibleStart: number,
      _visibleEnd: number,
      scrollLeft: number,
    ): void => {
      hideSplitGuide()
      setZoomScroll(scrollLeft)
    }
    waveSurfer.on('scroll', handleScroll)

    waveSurfer.on('error', (cause) => setError(errorMessage(cause)))

    const resizeObserver = new ResizeObserver(() => {
      const height = Math.max(60, Math.floor(container.clientHeight))
      waveSurfer.setOptions({ height })

      const width = container.clientWidth
      setZoomViewportWidth(width)
      if (zoomFactorRef.current <= 1.01 && peaks.duration > 0) {
        const fitPxPerSec = width / peaks.duration
        waveSurfer.zoom(fitPxPerSec)
        waveSurfer.setScroll(0)
        setZoomPxPerSec(fitPxPerSec)
        setZoomScroll(0)
        setZoomMaxScroll(0)
      }
    })
    resizeObserver.observe(container)

    waveSurferRef.current = waveSurfer
    return () => {
      if (pendingFrame) cancelAnimationFrame(pendingFrame)
      container.removeEventListener('pointerdown', onSelectPointerDown, true)
      window.removeEventListener('pointermove', onSelectPointerMove, true)
      window.removeEventListener('pointerup', onSelectPointerUp, true)
      window.removeEventListener('pointercancel', onSelectCancel, true)
      container.removeEventListener('lostpointercapture', onSelectCancel)
      window.removeEventListener('blur', onSelectBlur)
      resetSelection()
      container.removeEventListener('click', onSelectClickCapture, true)
      container.removeEventListener('pointermove', onSplitHover, true)
      container.removeEventListener('pointerleave', hideSplitGuide)
      hideSplitGuide()
      resizeObserver.disconnect()
      waveSurfer.destroy()
      setWaveCursor(null)
      waveSurferRef.current = null
      regionRef.current = null
    }
  }, [media, peaks, syncRegion, applyRegion, editRegion, recordRange, recordTimeline, resetTimeline])

  useEffect(() => {
    if (!previewing) return
    const video = videoRef.current
    if (!video) return

    let frame = 0
    const tick = (): void => {
      const current = regionRangeRef.current
      if (video.currentTime >= current.end - 0.012) {
        if (loop) {
          video.currentTime = current.start
          void video.play().catch(() => setPreviewing(false))
        } else {
          video.pause()
          setPreviewing(false)
          return
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [previewing, loop])

  useEffect(() => {
    if (!window.vdro) return

    const unsubscribeProgress = window.vdro.onExportProgress((payload) => {
      setJob((previous) =>
        previous && previous.id === payload.jobId
          ? {
              ...previous,
              progress: payload.progress,
              outputPath: payload.outputPath,
            }
          : previous,
      )
    })
    const unsubscribeDone = window.vdro.onExportDone((payload) => {
      setJob((previous) =>
        previous && previous.id === payload.jobId
          ? {
              ...previous,
              progress: 100,
              status: 'done',
              outputPath: payload.outputPath,
            }
          : previous,
      )
    })
    const unsubscribeError = window.vdro.onExportError((payload) => {
      setJob((previous) =>
        previous && previous.id === payload.jobId
          ? { ...previous, status: 'error', message: payload.message }
          : previous,
      )
    })
    const unsubscribeCancelled = window.vdro.onExportCancelled((payload) => {
      setJob((previous) =>
        previous && previous.id === payload.jobId
          ? { ...previous, status: 'cancelled' }
          : previous,
      )
    })

    return () => {
      unsubscribeProgress()
      unsubscribeDone()
      unsubscribeError()
      unsubscribeCancelled()
    }
  }, [])

  useEffect(() => {
    if (!window.vdro?.onOpenMedia) return
    return window.vdro.onOpenMedia((next) => {
      onNavigate('clip')
      void adoptMedia(next)
    })
  }, [adoptMedia, onNavigate])

  const applyZoom = useCallback(
    (nextFactor: number): void => {
      const wave = waveSurferRef.current
      if (!wave || !peaks) return

      const duration = wave.getDuration() || peaks.duration
      const width = wave.getWidth()
      if (duration <= 0 || width <= 0) return

      const fitPxPerSec = width / duration
      const factor = clamp(nextFactor, 1, 32)
      const nextPxPerSec = fitPxPerSec * factor
      const currentPxPerSec = zoomPxPerSec > 0 ? zoomPxPerSec : fitPxPerSec
      const centerTime = (wave.getScroll() + width / 2) / currentPxPerSec

      wave.zoom(nextPxPerSec)
      const maxScroll = Math.max(0, duration * nextPxPerSec - width)
      const nextScroll = clamp(centerTime * nextPxPerSec - width / 2, 0, maxScroll)

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          wave.setScroll(nextScroll)
          setZoomScroll(nextScroll)
        })
      })

      zoomFactorRef.current = factor
      setZoomFactor(factor)
      setZoomPxPerSec(nextPxPerSec)
      setZoomViewportWidth(width)
      setZoomMaxScroll(maxScroll)
    },
    [peaks, zoomPxPerSec],
  )

  const resetZoom = useCallback((): void => {
    const wave = waveSurferRef.current
    if (!wave || !peaks) return

    const duration = wave.getDuration() || peaks.duration
    const width = wave.getWidth()
    if (duration <= 0 || width <= 0) return

    const fitPxPerSec = width / duration
    wave.zoom(fitPxPerSec)
    wave.setScroll(0)
    zoomFactorRef.current = 1
    setZoomFactor(1)
    setZoomPxPerSec(fitPxPerSec)
    setZoomViewportWidth(width)
    setZoomScroll(0)
    setZoomMaxScroll(0)
  }, [peaks])

  const handleZoomScroll = useCallback((value: number): void => {
    const wave = waveSurferRef.current
    if (!wave) return
    wave.setScroll(value)
    setZoomScroll(value)
  }, [])

  const beginZoomPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault()
      if (zoomMaxScroll <= 0) return

      const trackWidth = zoomTrackRef.current?.clientWidth ?? zoomTrackWidth
      const thumbWidth = Math.max(
        36,
        trackWidth * (zoomViewportWidth / (zoomViewportWidth + zoomMaxScroll)),
      )
      const maxLeft = Math.max(0, trackWidth - thumbWidth)
      if (maxLeft <= 0) return

      const startX = event.clientX
      const startLeft = (zoomScroll / zoomMaxScroll) * maxLeft
      const previousSelect = document.body.style.userSelect
      document.body.style.userSelect = 'none'

      const onMove = (moveEvent: PointerEvent): void => {
        const left = clamp(startLeft + moveEvent.clientX - startX, 0, maxLeft)
        handleZoomScroll((left / maxLeft) * zoomMaxScroll)
      }
      const onUp = (): void => {
        document.body.style.userSelect = previousSelect
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
    },
    [zoomMaxScroll, zoomScroll, zoomTrackWidth, zoomViewportWidth, handleZoomScroll],
  )

  const stopExtractedPlayback = useCallback((): void => {
    if (!extractedPlaybackRef.current) return

    extractedPlaybackRef.current = false
    if (extractedSyncFrameRef.current !== null) {
      cancelAnimationFrame(extractedSyncFrameRef.current)
      extractedSyncFrameRef.current = null
    }

    extractedAudioRef.current?.pause()
    const video = videoRef.current
    if (video) {
      video.pause()
      video.muted = settings.previewMuted
    }
    setPlayingExtractedId(null)
  }, [settings.previewMuted])

  useEffect(() => {
    return () => {
      if (extractedSyncFrameRef.current !== null) {
        cancelAnimationFrame(extractedSyncFrameRef.current)
      }
      extractedPlaybackRef.current = false
    }
  }, [])

  const togglePlay = useCallback((): void => {
    const video = videoRef.current
    if (!video) return
    if (extractedPlaybackRef.current) {
      stopExtractedPlayback()
      return
    }
    if (video.paused) {
      void video.play().catch((cause) => setError(errorMessage(cause)))
    } else {
      video.pause()
    }
  }, [stopExtractedPlayback])

  const seekTo = useCallback((seconds: number): void => {
    const video = videoRef.current
    if (!video) return
    stopExtractedPlayback()
    video.currentTime = clamp(seconds, 0, Number.isFinite(video.duration) ? video.duration : duration)
    setCurrentTime(video.currentTime)
  }, [duration, stopExtractedPlayback])

  function startPlayheadDrag(): PlayheadDrag | undefined {
    const wave = waveSurferRef.current
    const video = videoRef.current
    if (!wave || !video) return
    const fullDuration = wave.getDuration()
    const width = wave.getWrapper().getBoundingClientRect().width
    if (!fullDuration || !width) return
    const secondsPerPixel = fullDuration / width
    const first = wave.getScroll() * secondsPerPixel
    const last = Math.min(fullDuration, first + wave.getWidth() * secondsPerPixel)
    const origin = video.currentTime
    const resume = !video.paused && !extractedPlaybackRef.current
    stopExtractedPlayback()
    video.pause()
    setPreviewing(false)
    setActiveExtractedClip(null)
    return {
      move: deltaX => {
        if (waveSurferRef.current !== wave) return
        const next = clamp(origin + deltaX * secondsPerPixel, first, last)
        wave.setTime(next)
        setCurrentTime(next)
      },
      finish: canResume => {
        if (!canResume || !resume || waveSurferRef.current !== wave || !wave.getWrapper().getClientRects().length) return
        const time = video.currentTime
        const range = regionRangeRef.current
        if (time >= fullDuration || (previewing && (time < range.start || time >= range.end))) return
        setPreviewing(previewing)
        void video.play().catch(cause => setError(errorMessage(cause)))
      },
    }
  }

  const seekBy = useCallback(
    (seconds: number): void => {
      const video = videoRef.current
      if (!video) return
      seekTo(video.currentTime + seconds)
    },
    [seekTo],
  )

  const setInPoint = useCallback((): void => {
    const video = videoRef.current
    const current = regionRef.current
    if (!video || !current) return
    const start = clamp(video.currentTime, 0, Math.max(0, current.end - 0.02))
    editRegion({ start, end: current.end })
  }, [editRegion])

  const setOutPoint = useCallback((): void => {
    const video = videoRef.current
    const current = regionRef.current
    if (!video || !current) return
    const end = clamp(video.currentTime, current.start + 0.02, duration || video.duration)
    editRegion({ start: current.start, end })
  }, [duration, editRegion])

  useTimelineHistoryShortcuts(active && !loading && !extracting && !settingsOpen, () => restoreRegion(undoRange), () => restoreRegion(redoRange))

  function restoreRegion(restore: () => ClipTimeline | undefined) {
    if (!regionRef.current || loading || extracting) return
    const snapshot = restore()
    if (!snapshot) return
    stopExtractedPlayback()
    applyRegion(snapshot.range)
    if (splitGuideRef.current) splitGuideRef.current.hidden = true
  }

  function clearSelectedRange() {
    stopExtractedPlayback()
    if (previewing) videoRef.current?.pause()
    setPreviewing(false)
    editRegion({ start: 0, end: 0 })
  }

  function addTimelineMarker() {
    if (!peaks || loading || extracting || !regionRef.current) return
    const position = extractedPlaybackRef.current ? currentTime : (videoRef.current?.currentTime ?? currentTime)
    const time = clamp(+position.toFixed(3), 0, peaks.duration)
    if (clipTimeline.markers.some(marker => Math.abs(time - marker) < .001)) return
    const markers = [...clipTimeline.markers, time].sort((left, right) => left - right)
    recordTimeline({ ...clipTimeline, markers })
  }

  const handlePreviewStageClick = useCallback((): void => {
    if (activeExtractedClip || extractedPlaybackRef.current) {
      setActiveExtractedClip(null)
      stopExtractedPlayback()
      return
    }
    togglePlay()
  }, [activeExtractedClip, stopExtractedPlayback, togglePlay])

  const previewRegion = useCallback((): void => {
    const video = videoRef.current
    const current = regionRangeRef.current
    if (!video || current.end - current.start < 0.02) return
    stopExtractedPlayback()
    setActiveExtractedClip(null)
    video.muted = settings.previewMuted
    video.volume = settings.previewVolume / 100
    video.currentTime = current.start
    setPreviewing(true)
    void video.play().catch((cause) => {
      setPreviewing(false)
      setError(errorMessage(cause))
    })
  }, [stopExtractedPlayback, settings.previewMuted, settings.previewVolume])

  const handleExport = useCallback(async (): Promise<void> => {
    if (!media || audioStreamIndex === null || clipDuration < 0.02) return

    setError(null)
    try {
      const result = await window.vdro.exportAudio({
        mediaId: media.id,
        start: region.start,
        end: region.end,
        format,
        sampleRate,
        channels,
        bitrate: effectiveBitrate,
        audioStreamIndex,
      })
      if (result.canceled || !result.jobId) return
      setJob({
        id: result.jobId,
        progress: 0,
        status: 'exporting',
        outputPath: result.outputPath,
      })
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [
    media,
    audioStreamIndex,
    clipDuration,
    region,
    format,
    sampleRate,
    channels,
    effectiveBitrate,
  ])

  const extractRange = useCallback(
    async (start: number, end: number): Promise<void> => {
      if (!media || audioStreamIndex === null || end - start < 0.02 || extracting) return

      setExtracting(true)
      setError(null)
      try {
        const clip = await window.vdro.extractAudio({
          mediaId: media.id,
          start,
          end,
          format,
          sampleRate,
          channels,
          bitrate: effectiveBitrate,
          audioStreamIndex,
        })
        setExtractedClips((previous) => [clip, ...previous])
        if (settings.autoSelectExtracted) setActiveExtractedClip(clip)
        setNotice(`已提取 ${formatTime(clip.duration)} 音频`)
        const video = videoRef.current
        if (video) {
          video.pause()
          video.currentTime = clip.start
          setCurrentTime(clip.start)
        }
      } catch (cause) {
        setError(errorMessage(cause))
      } finally {
        setExtracting(false)
      }
    },
    [
      media,
      audioStreamIndex,
      extracting,
      format,
      sampleRate,
      channels,
      effectiveBitrate,
      settings.autoSelectExtracted,
    ],
  )

  const handleExtract = useCallback((): void => {
    void extractRange(region.start, region.end)
  }, [extractRange, region])

  const handleExtractFull = useCallback((): void => {
    if (!media || !peaks || audioStreamIndex === null || extracting) return
    const fullEnd = peaks.duration || duration || media.info.duration
    if (fullEnd < 0.02) return

    editRegion({ start: 0, end: fullEnd })
    void extractRange(0, fullEnd)
  }, [
    media,
    peaks,
    audioStreamIndex,
    extracting,
    duration,
    extractRange,
    editRegion,
  ])

  const resolveExtractedSource = useCallback(
    async (clip: ExtractedClip): Promise<ExtractedClip | null> => {
      if (media && clip.sourceMediaId === media.id) return clip

      const source = findClipSource(clip, library)
      if (!source) {
        setError('源素材不存在或同名素材无法区分，请重新导入原文件')
        return null
      }

      await adoptMedia(source)
      const resolved = bindClipSource(clip, source)
      setExtractedClips((previous) =>
        previous.map((item) => (item.id === clip.id ? resolved : item)),
      )
      return resolved
    },
    [media, library, adoptMedia],
  )

  const selectExtractedClip = useCallback(
    async (clip: ExtractedClip): Promise<void> => {
      const target = await resolveExtractedSource(clip)
      if (!target) return

      if (activeExtractedClip?.id === target.id) {
        stopExtractedPlayback()
        setActiveExtractedClip(null)
        return
      }

      stopExtractedPlayback()
      setActiveExtractedClip(target)

      const video = videoRef.current
      if (video) {
        try {
          video.muted = settings.previewMuted
          video.volume = settings.previewVolume / 100
          video.pause()
          if (video.readyState >= 1) {
            video.currentTime = target.start
            setCurrentTime(target.start)
          } else {
            video.addEventListener(
              'loadedmetadata',
              () => {
                video.currentTime = target.start
                setCurrentTime(target.start)
              },
              { once: true },
            )
          }
        } catch {
          // Selecting the clip should still succeed if the seek is not ready yet.
        }
      }
    },
    [
      resolveExtractedSource,
      stopExtractedPlayback,
      activeExtractedClip?.id,
      settings.previewMuted,
      settings.previewVolume,
    ],
  )

  const toggleExtractedPlayback = useCallback(
    async (clip: ExtractedClip): Promise<void> => {
      const audio = extractedAudioRef.current
      if (!audio) return

      const target = await resolveExtractedSource(clip)
      if (!target) return

      if (playingExtractedId === target.id) {
        stopExtractedPlayback()
        return
      }

      stopExtractedPlayback()
      setActiveExtractedClip(target)

      const video = videoRef.current
      const syncVideo = Boolean(video && hasVideo && settings.syncExtractedVideo)
      if (video) {
        video.pause()
        video.muted = settings.previewMuted || syncVideo
        video.volume = settings.previewVolume / 100
        if (syncVideo) {
          video.currentTime = target.start
          setCurrentTime(target.start)
        }
      }

      audio.src = target.url
      audio.volume = settings.previewVolume / 100
      audio.muted = settings.previewMuted
      audio.load()
      try {
        audio.currentTime = 0
      } catch {
        // Some Chromium versions reject seeking before metadata is available.
      }
      extractedPlaybackRef.current = true

      void audio
        .play()
        .then(() => {
          setPlayingExtractedId(target.id)
          if (video && syncVideo) {
            void video.play().catch((cause) => {
              setError(errorMessage(cause))
            })
          }

          let lastProgressUpdate = 0
          const tick = (frameTime = 0): void => {
            if (!extractedPlaybackRef.current) return
            const currentAudio = extractedAudioRef.current
            if (!currentAudio) return

            if (
              currentAudio.ended ||
              currentAudio.currentTime >= target.duration - 0.03
            ) {
              setCurrentTime(target.end)
              stopExtractedPlayback()
              return
            }

            if (frameTime - lastProgressUpdate > 80) {
              lastProgressUpdate = frameTime
              setCurrentTime(target.start + currentAudio.currentTime)
            }

            const currentVideo = videoRef.current
            if (currentVideo && syncVideo && !currentVideo.seeking) {
              const expected = target.start + currentAudio.currentTime
              if (Math.abs(currentVideo.currentTime - expected) > 0.2) {
                currentVideo.currentTime = expected
              }
            }

            extractedSyncFrameRef.current = requestAnimationFrame(tick)
          }

          extractedSyncFrameRef.current = requestAnimationFrame(tick)
        })
        .catch((cause) => {
          extractedPlaybackRef.current = false
          setPlayingExtractedId(null)
          if (video) video.muted = settings.previewMuted
          setError(errorMessage(cause))
        })
    },
    [
      playingExtractedId,
      hasVideo,
      stopExtractedPlayback,
      settings.syncExtractedVideo,
      settings.previewMuted,
      settings.previewVolume,
      resolveExtractedSource,
    ],
  )

  const handleExtractedAudioPause = useCallback((): void => {
    if (extractedPlaybackRef.current && extractedAudioRef.current?.paused) {
      stopExtractedPlayback()
      return
    }
    setPlayingExtractedId(null)
  }, [stopExtractedPlayback])

  const handleSaveExtracted = useCallback(async (clip: ExtractedClip): Promise<void> => {
    setSavingClipId(clip.id)
    setError(null)
    try {
      const result = await window.vdro.saveExtracted(clip.filePath, clip.fileName)
      if (!result.canceled && result.filePath) {
        setNotice(`已保存：${result.filePath}`)
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSavingClipId(null)
    }
  }, [])

  const handleDeleteExtracted = useCallback(
    async (clip: ExtractedClip): Promise<void> => {
      if (
        settings.confirmDelete &&
        !window.confirm(
          translateUiText(
            `确定删除已提取音频“${clip.fileName}”吗？`,
            settings.language,
          ),
        )
      ) {
        return
      }
      if (playingExtractedId === clip.id) {
        stopExtractedPlayback()
      }
      try {
        await window.vdro.deleteExtracted(clip.id, clip.filePath)
        setExtractedClips((previous) => previous.filter((item) => item.id !== clip.id))
        setActiveExtractedClip((previous) => (previous?.id === clip.id ? null : previous))
        setNotice('已删除提取片段')
      } catch (cause) {
        setError(errorMessage(cause))
      }
    },
    [playingExtractedId, stopExtractedPlayback, settings.confirmDelete, settings.language],
  )

  const updateSettings = useCallback((patch: Partial<AppSettings>): void => {
    setSettings((current) => {
      const next = sanitizeSettings({ ...current, ...patch })
      return next
    })
  }, [setSettings])

  const resetAllSettings = useCallback((): void => {
    setSettings(DEFAULT_APP_SETTINGS)
    setLayout(DEFAULT_LAYOUT)
    setLoop(DEFAULT_APP_SETTINGS.previewLoop)
    setLibraryCollapsed(DEFAULT_APP_SETTINGS.sidebarCollapsed)
    setNotice('已恢复全部默认设置')
  }, [setSettings, setLayout])

  const resetLayoutSettings = useCallback((): void => {
    setLayout(DEFAULT_LAYOUT)
    setNotice('已重置界面布局')
  }, [])

  const clearTemporaryFiles = useCallback(async (): Promise<void> => {
    if (
      settings.confirmDelete &&
      !window.confirm(
        translateUiText(
          '确定清理全部临时提取文件吗？这不会删除已经另存的文件。',
          settings.language,
        ),
      )
    ) {
      return
    }
    if (extracting || savingClipId || !window.dispatchEvent(new Event('vdro:before-clear-temp', { cancelable: true }))) {
      setNotice('请在当前音频任务完成后清理临时文件。')
      return
    }
    stopExtractedPlayback()
    await window.vdro.clearTempFiles()
    window.dispatchEvent(new Event('vdro:temp-cleared'))
    setExtractedClips([])
    setActiveExtractedClip(null)
    setNotice('已清理所有临时提取文件')
  }, [stopExtractedPlayback, settings.confirmDelete, settings.language, extracting, savingClipId])

  const clearWaveformCache = useCallback(async (): Promise<void> => {
    if (
      settings.confirmDelete &&
      !window.confirm(
        translateUiText(
          '确定清理全部波形缓存吗？下次打开素材会重新生成。',
          settings.language,
        ),
      )
    ) {
      return
    }
    await window.vdro.clearPeaksCache()
    peaksCacheRef.current.clear()
    setNotice('已清理波形缓存')
  }, [settings.confirmDelete, settings.language])

  const chooseSaveDirectory = useCallback((): Promise<string | null> => {
    return window.vdro.chooseDirectory(settings.saveDirectory)
  }, [settings.saveDirectory])

  const openDataFolder = useCallback(async (): Promise<void> => {
    try {
      await window.vdro.openDataFolder()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [])

  const removeLibraryItem = useCallback(
    (item: ImportedMedia): void => {
      if (
        settings.confirmDelete &&
        !window.confirm(
          translateUiText(
            `确定从素材栏移除“${item.fileName}”吗？源文件不会被删除。`,
            settings.language,
          ),
        )
      ) {
        return
      }
      setLibrary((previous) => previous.filter((entry) => entry.id !== item.id))
      setNotice(`已从素材栏移除：${item.fileName}`)
      // 释放主进程侧的 URL 映射和内存波形缓存，避免句柄与内存随会话增长。
      void window.vdro.releaseMedia(item.id).catch(() => undefined)
      peaksCacheRef.current.delete(item.id)

      if (media?.id !== item.id) return
      mediaRequest.current++
      setLoading(false)

      stopExtractedPlayback()
      setActiveExtractedClip(null)
      setMedia(null)
      setPeaks(null)
      setAudioStreamIndex(null)
      setDuration(0)
      setCurrentTime(0)
      setRegion({ start: 0, end: 0 })
      regionRangeRef.current = { start: 0, end: 0 }
    },
    [media, stopExtractedPlayback, settings.confirmDelete, settings.language],
  )

  const getLibraryTargetIndex = useCallback((clientY: number): number => {
    const list = libraryListRef.current
    if (!list) return 0
    const nodes = Array.from(list.querySelectorAll<HTMLElement>('[data-library-id]'))
    let targetIndex = nodes.length
    for (let index = 0; index < nodes.length; index += 1) {
      const rect = nodes[index].getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) {
        targetIndex = index
        break
      }
    }
    return targetIndex
  }, [])

  const dropLibraryItem = useCallback((itemId: string, targetIndex: number): void => {
    setLibrary((previous) => {
      const from = previous.findIndex((item) => item.id === itemId)
      if (from < 0) return previous
      const without = previous.filter((item) => item.id !== itemId)
      const to = Math.max(0, Math.min(targetIndex, without.length))
      const next = [...without]
      next.splice(to, 0, previous[from])
      return next
    })
  }, [])

  const beginLibraryPress = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, item: ImportedMedia): void => {
      if (event.button !== 0 || libraryCollapsed) return
      const target = event.target as HTMLElement | null
      if (target?.closest('.library-remove')) return

      libraryPressRef.current?.cleanup?.()

      const itemElement = event.currentTarget
      const startX = event.clientX
      const startY = event.clientY
      let active = false
      let timer: number | null = null
      let finished = false

      const cleanup = (): void => {
        if (finished) return
        finished = true
        if (timer !== null) window.clearTimeout(timer)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        document.body.classList.remove('is-library-dragging')
        libraryDragRef.current = null
        setLibraryDrag(null)
        if (libraryPressRef.current?.cleanup === cleanup) {
          libraryPressRef.current = null
        }
      }

      const finishDrag = (): void => {
        if (!active) {
          cleanup()
          return
        }
        const drag = libraryDragRef.current
        if (drag?.targetIndex !== null && drag?.targetIndex !== undefined) {
          dropLibraryItem(item.id, drag.targetIndex)
        }
        suppressLibraryClickRef.current = true
        cleanup()
        window.setTimeout(() => {
          suppressLibraryClickRef.current = false
        }, 350)
      }

      const onMove = (moveEvent: PointerEvent): void => {
        if (!active) {
          if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 7) {
            cleanup()
          }
          return
        }
        moveEvent.preventDefault()
        const list = libraryListRef.current
        if (list) {
          const rect = list.getBoundingClientRect()
          if (moveEvent.clientY < rect.top + 28) list.scrollTop -= 12
          else if (moveEvent.clientY > rect.bottom - 28) list.scrollTop += 12
        }
        const targetIndex = getLibraryTargetIndex(moveEvent.clientY)
        setLibraryDrag((current) => {
          if (!current) return current
          const next = {
            ...current,
            x: moveEvent.clientX,
            y: moveEvent.clientY,
            targetIndex,
          }
          libraryDragRef.current = next
          return next
        })
      }

      const onUp = (): void => finishDrag()

      timer = window.setTimeout(() => {
        active = true
        const rect = itemElement.getBoundingClientRect()
        const drag = {
          itemId: item.id,
          x: startX,
          y: startY,
          width: rect.width,
          height: rect.height,
          targetIndex: null,
        }
        libraryDragRef.current = drag
        setLibraryDrag(drag)
        document.body.classList.add('is-library-dragging')
      }, 100)

      libraryPressRef.current = {
        itemId: item.id,
        startX,
        startY,
        pointerId: event.pointerId,
        timer,
        cleanup,
      }

      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [libraryCollapsed, getLibraryTargetIndex, dropLibraryItem],
  )

  useLayoutEffect(() => {
    const list = libraryListRef.current
    if (!list) return
    const nodes = Array.from(list.querySelectorAll<HTMLElement>('[data-library-id]'))
    const nextPositions = new Map<string, number>()
    for (const node of nodes) {
      const id = node.dataset.libraryId
      if (id) nextPositions.set(id, node.offsetTop)
    }

    const previousPositions = libraryPreviousPositionsRef.current
    if (previousPositions.size > 0) {
      for (const node of nodes) {
        const id = node.dataset.libraryId
        if (!id) continue
        const previousTop = previousPositions.get(id)
        if (previousTop === undefined) continue
        const delta = previousTop - (nextPositions.get(id) ?? previousTop)
        if (Math.abs(delta) < 1) continue

        node.style.transition = 'none'
        node.style.transform = `translateY(${delta}px)`
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            node.style.transition = 'transform 240ms cubic-bezier(0.22, 0.8, 0.24, 1)'
            node.style.transform = ''
          })
        })
      }
    }
    libraryPreviousPositionsRef.current = nextPositions
  }, [library, libraryDrag?.itemId, libraryDrag?.targetIndex])

  useEffect(() => {
    return () => {
      libraryPressRef.current?.cleanup?.()
    }
  }, [])

  const togglePreviewSettings = useCallback((): void => {
    if (openPreviewSettings) {
      setOpenPreviewSettings(false)
      return
    }

    const rect = previewSettingsRef.current?.getBoundingClientRect()
    if (rect) {
      setPreviewMenuStyle({
        position: 'fixed',
        right: Math.max(8, window.innerWidth - rect.right),
        bottom: window.innerHeight - rect.top + 6,
        maxHeight: Math.max(1, rect.top - 8),
        overflowY: 'auto',
      })
    }
    setOpenPreviewSettings(true)
  }, [openPreviewSettings])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const next = settingsLoaded ? settings : await window.vdro.getSettings()
        if (cancelled) return

        onSettingsRead(next)
        setFormat(next.outputFormat)
        if (next.outputQuality === 'native') {
          setUseNativeQuality(true)
        } else {
          setUseNativeQuality(false)
          setBitrate(next.outputQuality)
        }
        setSampleRate(next.sampleRate)
        setChannels(next.channels)
        setLoop(next.previewLoop)
        setLibraryCollapsed(next.sidebarCollapsed)

        const draft = projectId ? readDraft<ClipProject>(projectId, 'clip') : null
        if (draft) { projectTimelines.current = draft.timelines; projectCurrent.current = draft.current }
        const legacyDraft = projectId === '__draft__' && !draft
        async function restoreLibrary() {
          const media: ImportedMedia[] = []
          const missing: string[] = []
          for (const path of draft?.paths ?? []) {
            if (cancelled) break
            try { media.push(await window.vdro.importPath(path)) } catch { missing.push(path) }
          }
          return { media, missing }
        }
        const [info, loadedLibrary, loadedClips] = await Promise.all([
          window.vdro.getAppInfo().catch(() => null),
          projectId && !legacyDraft ? restoreLibrary() : next.persistLibrary
            ? window.vdro.loadLibrary().catch(() => ({ media: [], missing: [] }))
            : Promise.resolve({ media: [], missing: [] }),
          projectId || (next.persistExtracted && next.persistLibrary)
            ? window.vdro.loadExtracted(legacyDraft ? undefined : projectId).catch(() => [])
            : Promise.resolve([]),
        ])

        if (cancelled) {
          for (const item of loadedLibrary.media) void window.vdro.releaseMedia(item.id).catch(() => undefined)
          return
        }
        if (info) setAppInfo(info)
        if (loadedLibrary.media.length > 0) {
          setLibrary((previous) => {
            const known = new Set(previous.map((item) => item.filePath))
            return [...previous, ...loadedLibrary.media.filter((item) => !known.has(item.filePath))]
          })
        }
        const availablePaths = new Set(loadedLibrary.media.map(item => item.filePath))
        setUnavailablePaths((draft?.paths ?? []).filter(path => !availablePaths.has(path)))
        const current = loadedLibrary.media.find(item => item.filePath === draft?.current)
        if (current && !await adoptMedia(current)) {
          setLibrary(previous => previous.filter(item => item.id !== current.id))
          setUnavailablePaths(previous => [...new Set([...previous, current.filePath])])
        }
        if (cancelled) return
        setWorkspaceReady(true)
        if (loadedLibrary.missing.length > 0) {
          setNotice(
            `${loadedLibrary.missing.length} 个素材文件已失效，已从素材库跳过`,
          )
        }
        if (loadedClips.length > 0) {
          setExtractedClips(
            loadedClips.map((clip) => {
              const source = findClipSource(clip, loadedLibrary.media)
              return bindClipSource(clip, source)
            }),
          )
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      } finally {
        if (!cancelled) setSettingsLoaded(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [onSettingsRead, setSettingsLoaded, projectId])

  useEffect(() => {
    if (!workspaceReady || !settingsLoaded) return
    const timer = window.setTimeout(() => {
      void window.vdro.saveSettings(settings).catch((cause) => setError(`保存设置失败：${errorMessage(cause)}`))
    }, 150)
    return () => window.clearTimeout(timer)
  }, [settings, settingsLoaded, workspaceReady])

  useEffect(() => {
    if (!settingsLoaded) return
    void window.vdro.setWindowTranslucent(isTranslucent).catch(() => undefined)
  }, [settingsLoaded, isTranslucent, settings.theme, settings.translucent])

  useEffect(() => {
    if (!settingsLoaded) return
    void window.vdro.setAlwaysOnTop(settings.alwaysOnTop).catch(() => undefined)
  }, [settingsLoaded, settings.alwaysOnTop])

  useEffect(() => {
    if (!settingsLoaded) return
    const video = videoRef.current
    if (video) {
      video.volume = settings.previewVolume / 100
      video.muted =
        settings.previewMuted ||
        (extractedPlaybackRef.current && settings.syncExtractedVideo)
    }
    const audio = extractedAudioRef.current
    if (audio) {
      audio.volume = settings.previewVolume / 100
      audio.muted = settings.previewMuted
    }
  }, [
    settingsLoaded,
    settings.previewVolume,
    settings.previewMuted,
    settings.syncExtractedVideo,
    media?.id,
  ])



  useEffect(() => {
    if (!settingsLoaded) return
    setFormat(settings.outputFormat)
    if (settings.outputQuality === 'native') {
      setUseNativeQuality(true)
    } else {
      setUseNativeQuality(false)
      setBitrate(settings.outputQuality)
    }
    setSampleRate(settings.sampleRate)
    setChannels(settings.channels)
  }, [
    settingsLoaded,
    settings.outputFormat,
    settings.outputQuality,
    settings.sampleRate,
    settings.channels,
  ])

  useEffect(() => {
    if (settingsLoaded) setLoop(settings.previewLoop)
  }, [settingsLoaded, settings.previewLoop])

  useEffect(() => {
    if (settingsLoaded) setLibraryCollapsed(settings.sidebarCollapsed)
  }, [settingsLoaded, settings.sidebarCollapsed])

  useEffect(() => {
    if (!media) return
    setExtractedClips((previous) =>
      previous.map((clip) =>
        bindClipSource(clip, findClipSource(clip, library)),
      ),
    )
  }, [media?.id, library])

  useEffect(() => {
    if (!workspaceReady || projectId) return
    const entries = settings.persistLibrary
      ? library.map((item) => ({ filePath: item.filePath, fileName: item.fileName }))
      : []
    void window.vdro.saveLibrary(entries).catch((cause) => setError(`保存素材库失败：${errorMessage(cause)}`))
  }, [library, settings.persistLibrary, workspaceReady, projectId])

  useEffect(() => {
    if (!workspaceReady) return
    const clips =
      projectId || (settings.persistExtracted && settings.persistLibrary) ? extractedClips : []
    void window.vdro.saveExtractedClips(clips, projectId).catch((cause) => {
      if (projectId) reportProjectState(projectId, 'clip', 'error')
      setError(`保存提取记录失败：${errorMessage(cause)}`)
    })
  }, [
    extractedClips,
    projectId, workspaceReady,
    settings.persistExtracted,
    settings.persistLibrary,
    settingsLoaded,
  ])

  useEffect(() => {
    if (zoomFactor <= 1) {
      setZoomTrackWidth(0)
      return
    }

    const track = zoomTrackRef.current
    if (!track) return

    const updateWidth = (): void => setZoomTrackWidth(track.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(track)
    return () => observer.disconnect()
  }, [zoomFactor, zoomMaxScroll])

  useEffect(() => {
    if (!openOutputMenu) return

    const onPointerDown = (event: PointerEvent): void => {
      if (!outputControlsRef.current?.contains(event.target as Node)) {
        setOpenOutputMenu(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenOutputMenu(null)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openOutputMenu])

  useEffect(() => {
    if (!activeExtractedClip) return

    const handleDocumentClick = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.extracted-item')) return
      setActiveExtractedClip(null)
    }

    document.addEventListener('click', handleDocumentClick)
    return () => document.removeEventListener('click', handleDocumentClick)
  }, [activeExtractedClip])

  useEffect(() => {
    if (!openPreviewSettings) return

    const onPointerDown = (event: PointerEvent): void => {
      if (
        !previewSettingsRef.current?.contains(event.target as Node) &&
        !previewMenuRef.current?.contains(event.target as Node)
      ) {
        setOpenPreviewSettings(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenPreviewSettings(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openPreviewSettings])

  useEffect(() => {
    if (!settingsOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen])

  const handleCancelExport = useCallback(async (): Promise<void> => {
    if (!job || job.status !== 'exporting') return
    await window.vdro.cancelExport(job.id)
  }, [job])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!active || settingsOpen) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) {
        return
      }

      const pressed =
        event.code === 'Space'
          ? 'Space'
          : event.key.length === 1
            ? event.key.toUpperCase()
            : event.key
      const shortcuts = settings.shortcuts

      if (pressed === shortcuts.play) {
        event.preventDefault()
        togglePlay()
      } else if (pressed === shortcuts.setIn) {
        event.preventDefault()
        setInPoint()
      } else if (pressed === shortcuts.setOut) {
        event.preventDefault()
        setOutPoint()
      } else if (pressed === shortcuts.seekBack) {
        event.preventDefault()
        seekBy(event.shiftKey ? -10 : -effectiveSkipSeconds)
      } else if (pressed === shortcuts.seekForward) {
        event.preventDefault()
        seekBy(event.shiftKey ? 10 : effectiveSkipSeconds)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    togglePlay,
    setInPoint,
    setOutPoint,
    seekBy,
    settings.shortcuts,
    settings.skipSeconds,
    settings.customSkipSeconds,
    settingsOpen,
    active,
  ])

  const jobLabel =
    job?.status === 'exporting'
      ? `正在导出 ${job.progress}%`
      : job?.status === 'done'
        ? '导出完成'
        : job?.status === 'error'
          ? '导出失败'
          : '已取消导出'

  useEffect(() => { if (!active) { videoRef.current?.pause(); stopExtractedPlayback(); setPreviewing(false) } }, [active, stopExtractedPlayback])
  return (
    <div
      inert={!!projectId && !workspaceReady}
      ref={appRootRef}
      className={`app clip-app theme-${settings.theme} material-${settings.materialColor} accent-${settings.accent} ui-scale-${settings.uiScale}`}
      style={{
        '--clip-inspector-width': layout.inspectorWidth + 'px',
        '--clip-timeline-height': layout.timelineHeight + 'px',
        '--clip-time-height': layout.clipTimeHeight === null ? 'auto' : layout.clipTimeHeight + 'px',
        '--clip-preview-min': MIN_VIDEO_PREVIEW_HEIGHT + 'px',
        '--clip-timeline-min': MIN_TIMELINE_HEIGHT + 'px',
        '--clip-time-min': MIN_CLIP_TIME_HEIGHT + 'px',
        '--clip-results-min': MIN_RESULTS_HEIGHT + 'px',
        '--clip-split-size': PANEL_RESIZER_HEIGHT + 'px',
      } as CSSProperties}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      <div ref={bodyRef} className={`app-body${libraryCollapsed ? ' library-collapsed' : ''}`}>
        <div className={`clip-tools${libraryCollapsed ? ' is-collapsed' : ''}`}>

          <MediaLibrary items={library} collapsed={libraryCollapsed} listRef={libraryListRef} dragging={!!libraryDrag}
            onToggle={() => setLibraryCollapsed(value => !value)} onImport={() => void handleOpen()}>
            {!libraryCollapsed && <MissingMediaList paths={unavailablePaths} disabled={loading || extracting}
              onRelink={(path, choose) => void relinkClipAsset(path, choose)}/>}
            {(() => {
              const visibleLibrary = libraryDrag
                ? library.filter((item) => item.id !== libraryDrag.itemId)
                : library
              const placeholderIndex = libraryDrag?.targetIndex ?? null
              const placeholder = (
                <div
                  className="library-drag-placeholder"
                  style={{ height: libraryDrag?.height ?? 58 }}
                />
              )
              return (
                <>
                  {visibleLibrary.map((item, index) => (
                    <Fragment key={item.id}>
                      {placeholderIndex === index && placeholder}
                      <MediaLibraryItem item={item} selected={media?.id === item.id} collapsed={libraryCollapsed}
                        onPointerDown={event => beginLibraryPress(event, item)}
                        onSelect={() => {
                          if (suppressLibraryClickRef.current) {
                            suppressLibraryClickRef.current = false
                            return
                          }
                          void adoptMedia(item)
                        }}
                        onRemove={() => removeLibraryItem(item)}/>
                    </Fragment>
                  ))}
                  {placeholderIndex === visibleLibrary.length && placeholder}
                </>
              )
            })()}
          </MediaLibrary>
        </div>

        <main ref={mainColumnRef} className="main-column"
          data-preview-collapsed={layout.previewCollapsed} data-timeline-collapsed={layout.timelineCollapsed}>
            <section className={`preview-panel${layout.previewCollapsed ? ' is-collapsed' : ''}`}>
              <div className="preview-collapse-bar">
                <button
                  className="panel-collapse-btn"
                  type="button"
                  title={layout.previewCollapsed ? '展开视频预览' : '收起视频预览'}
                  aria-label={layout.previewCollapsed ? '展开视频预览' : '收起视频预览'}
                  aria-expanded={!layout.previewCollapsed}
                  onClick={() => togglePanel('previewCollapsed')}
                >
                  <IconChevronVertical collapsed={layout.previewCollapsed} />
                </button>
                <span className="panel-collapse-label panel-title-text">视频预览</span>
              </div>
              <div className="preview-stage" onClick={handlePreviewStageClick}>
                {!media && (
                  <div className="empty-stage">
                    <div className="empty-glyph">
                      <IconWave />
                    </div>
                    <h1>导入音频或视频文件以开始</h1>
                    <p className="empty-copy">
                      拖入 MP3、WAV、FLAC、M4A 或 MP4、MOV、MKV、WebM。
                      <br />
                      波形上拖出选区，播放中也能导出。
                    </p>
                    <button className="btn btn-primary" type="button" onClick={() => void handleOpen()}>
                      选择文件
                    </button>
                  </div>
                )}

                {media && (
                  <>
                    <video
                      key={media.id}
                      ref={videoRef}
                      className={`preview-video${hasVideo ? '' : ' is-audio'}`}
                      src={media.url}
                      playsInline
                    />
                    {hasVideo && !nativePreview && <canvas ref={previewCanvasRef} className="preview-canvas" />}
                    {!hasVideo && (
                      <div className="audio-stage">
                        <div className="audio-stage-icon">
                          <IconWave />
                        </div>
                        <span className="audio-stage-label">AUDIO ONLY</span>
                        <strong>{media.fileName}</strong>
                        <span className="audio-stage-sub">
                          {sourceAudio
                            ? `${sourceAudio.codec.toUpperCase()} · ${sourceAudio.sampleRate} Hz · ${sourceAudio.channels} ch`
                            : '音频轨道'}
                        </span>
                      </div>
                    )}
                    <div className="preview-hud">
                      <span>{hasVideo ? 'VIDEO' : 'AUDIO'}</span>
                      <span>
                        {hasVideo
                          ? `${media.info.videoStreams[0].width}×${media.info.videoStreams[0].height}`
                          : `${sourceAudio?.sampleRate ?? '—'} Hz`}
                      </span>
                      <span>{formatBytes(media.info.size)}</span>
                    </div>
                  </>
                )}

                {loading && (
                  <div className="preview-loading">
                    <span className="pulse-dot" />
                    正在读取媒体并生成波形…
                  </div>
                )}
              </div>

              {media && (
                <div className="preview-footer">
                  <div
                    className="preview-progress"
                    style={
                      {
                        '--preview-progress': `${previewProgressPercent}%`,
                      } as CSSProperties
                    }
                  >
                    <span className="preview-progress-track" aria-hidden="true" />
                    <span className="preview-progress-fill" aria-hidden="true" />
                    <span className="preview-progress-thumb" aria-hidden="true" />
                    <input
                      className="preview-progress-range"
                      type="range"
                      min={0}
                      max={Math.max(duration, 0)}
                      step={0.01}
                      value={displayCurrentTime}
                      disabled={duration <= 0}
                      aria-label="视频预览播放进度"
                      onChange={(event) => seekTo(Number(event.target.value))}
                    />
                  </div>
                  <div className="preview-transport">
                    <button
                      className="icon-btn preview-icon-btn"
                      type="button"
                      title={`后退 ${effectiveSkipSeconds} 秒`}
                      onClick={() => seekBy(-effectiveSkipSeconds)}
                    >
                      <IconBack />
                    </button>
                    <button
                      className={`icon-btn play-btn preview-play-btn${isPreviewPlaying ? ' is-playing' : ''}`}
                      type="button"
                      title={isPreviewPlaying ? '暂停' : '播放'}
                      onClick={togglePlay}
                    >
                      {isPreviewPlaying ? <IconPause /> : <IconPlay />}
                    </button>
                    <button
                      className="icon-btn preview-icon-btn"
                      type="button"
                      title={`前进 ${effectiveSkipSeconds} 秒`}
                      onClick={() => seekBy(effectiveSkipSeconds)}
                    >
                      <IconForward />
                    </button>
                    <span className="preview-time">
                      {formatTime(displayCurrentTime)} / {formatTime(duration)}
                    </span>
                  </div>

                  {hasVideo && (
                    <div className="preview-settings" ref={previewSettingsRef}>
                      <button
                        className="preview-settings-button"
                        type="button"
                        aria-haspopup="listbox"
                        aria-expanded={openPreviewSettings}
                        onClick={togglePreviewSettings}
                      >
                        <span>
                          {nativePreview ? (settings.language === 'en-US' ? 'Native preview' : '原生预览') : `${previewResolutionLabel} · ${previewFps}帧`}
                        </span>
                        <IconChevronDown />
                      </button>

                      {openPreviewSettings &&
                        createPortal(
                          <div
                            ref={previewMenuRef}
                            className="preview-settings-menu"
                            style={previewMenuStyle}
                          >
                            <div className="settings-section">
                              <span className="eyebrow">预览分辨率</span>
                              <button type="button" className={`setting-option${nativePreview ? ' is-active' : ''}`} onClick={() => setNativePreview(true)}>
                                {settings.language === 'en-US' ? 'Native preview (follow source)' : '原生预览（跟随源）'}
                              </button>
                              <div className="settings-grid">
                                {PREVIEW_RESOLUTIONS.map((item) => (
                                  <button
                                    key={item.height}
                                    className={`setting-option${
                                      !nativePreview && previewResolution === item.height ? ' is-active' : ''
                                    }`}
                                    type="button"
                                    onClick={() => { setNativePreview(false); setPreviewResolution(item.height) }}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                              {sourceVideo && (
                                <span className="settings-source">
                                  原视频分辨率：{sourceVideo.width}X{sourceVideo.height}
                                </span>
                              )}
                            </div>

                            <div className="settings-section">
                              <span className="eyebrow">帧率</span>
                              <div className="settings-row">
                                {PREVIEW_FPS.map((fps) => (
                                  <button
                                    key={fps}
                                    className={`setting-option${
                                      !nativePreview && previewFps === fps ? ' is-active' : ''
                                    }`}
                                    type="button"
                                    onClick={() => { setNativePreview(false); setPreviewFps(fps) }}
                                  >
                                    {fps}
                                  </button>
                                ))}
                              </div>
                              <span className="settings-source">
                                原视频帧率：{sourceFpsLabel}帧
                              </span>
                            </div>
                          </div>,
                          appRootRef.current ?? document.body,
                        )}
                    </div>
                  )}
                </div>
              )}
            </section>

            {!layout.previewCollapsed && !layout.timelineCollapsed && (
              <div
                className="resizer resizer-horizontal video-resizer"
                role="separator"
                aria-orientation="horizontal"
                aria-label="调整视频预览高度"
                onPointerDown={beginTimelineResize}
              />
            )}

          <section
            ref={timelinePanelRef}
            className={`timeline-panel${layout.timelineCollapsed ? ' is-collapsed' : ''}`}
          >
              <div className="timeline-editor">
            <div className="timeline-head">
              <div className="timeline-tool-row">
                <button
                  className="panel-collapse-btn"
                  type="button"
                  title={layout.timelineCollapsed ? '展开音频时间线' : '收起音频时间线'}
                  aria-label={layout.timelineCollapsed ? '展开音频时间线' : '收起音频时间线'}
                  aria-expanded={!layout.timelineCollapsed}
                  onClick={() => togglePanel('timelineCollapsed')}
                >
                  <IconChevronVertical collapsed={layout.timelineCollapsed} />
                </button>
                {!layout.timelineCollapsed && <>
                  <TimelineToolPicker tool={timelineTool} shortcuts={settings.shortcuts} onChange={changeTimelineTool} />
                  <TimelineEditControls
                    canUndo={canEditTimeline && pastRanges.length > 0}
                    canRedo={canEditTimeline && futureRanges.length > 0}
                    canDelete={canEditTimeline && clipDuration >= .02}
                    canAddMarker={canEditTimeline}
                    deleteLabel="删除当前选区"
                    onUndo={() => restoreRegion(undoRange)}
                    onRedo={() => restoreRegion(redoRange)}
                    onDelete={clearSelectedRange}
                    onAddMarker={addTimelineMarker}
                  />
                  <span className="timeline-note">
                    {media ? (timelineTool === 'split' ? '点击波形分割音频' : '按住左键拖动框选 · 拖两端微调') : '等待媒体'}
                  </span>
                </>}
              </div>
              {!layout.timelineCollapsed && <WaveformZoomControls
                className="timeline-zoom"
                factor={zoomFactor}
                canZoomIn={!!peaks && zoomFactor < 32}
                canZoomOut={!!peaks && zoomFactor > 1.01}
                onZoomIn={() => applyZoom(zoomFactor * 1.5)}
                onZoomOut={() => {
                  const next = zoomFactor / 1.5
                  if (next <= 1.01) resetZoom()
                  else applyZoom(next)
                }}
                onReset={resetZoom}
              />}
            </div>

            {!layout.timelineCollapsed && <div className="timeline-ruler" aria-hidden="true">
              {Array.from({ length: visibleDuration > 0 ? 5 : 1 }, (_, index) => (
                <span key={index}>{formatTime(visibleStartTime + visibleDuration * index / 4, visibleDuration > 0 && visibleDuration < 15)}</span>
              ))}
            </div>}

            <div className={`waveform-wrap${extractedOverlay ? ' has-extracted' : ''}`}
              data-timeline-tool={timelineTool} data-range-selected={clipDuration >= .02}>
              {media ? (
                <div ref={waveRef} className="waveform" />
              ) : (
                <div className="timeline-empty">
                  <span className="timeline-empty-line" />
                  <span className="eyebrow">此处显示波形图</span>
                </div>
              )}
              <div ref={dragBoxRef} className="drag-box" hidden />
              <span ref={splitGuideRef} className="timeline-split-guide" aria-hidden="true" hidden />
              {waveCursor && peaks && !layout.timelineCollapsed && createPortal(<TimelinePlayheadHandle
                label={translateUiText('拖动播放头', settings.language)} time={currentTime} duration={duration}
                seek={seekTo} startDrag={startPlayheadDrag} />, waveCursor)}
              {peaks && visibleDuration > 0 && clipTimeline.cuts.filter(time => time >= visibleStartTime && time <= visibleEndTime)
                .map(time => <span key={time} className="timeline-cut-line" aria-hidden="true"
                  style={{ left: `${(time - visibleStartTime) / visibleDuration * 100}%` }} />)}
              {peaks && !layout.timelineCollapsed && visibleDuration > 0 && clipTimeline.markers.map((time, index) =>
                time >= visibleStartTime && time <= visibleEndTime && <button key={time} type="button" className="clip-marker-pin"
                  disabled={timelineTool === 'split'} aria-label={`定位标记 ${index + 1}`}
                  title={`标记 ${index + 1}：${formatTime(time)}`}
                  style={{ '--clip-marker-position': `${(time - visibleStartTime) / visibleDuration * 100}%` } as CSSProperties}
                  onClick={() => {
                    setActiveExtractedClip(null)
                    seekTo(time)
                  }}>{index + 1}</button>)}
              {media && !peaks && !loading && (
                <div className="waveform-status">波形尚未生成</div>
              )}
              {extractedOverlay && (
                <div
                  className="extracted-range"
                  style={extractedOverlay}
                  title={activeExtractedClip?.fileName}
                >
                  <span>{activeExtractedClip?.fileName}</span>
                </div>
              )}
            </div>

            {zoomFactor > 1 && zoomMaxScroll > 0 && (
              <div className="zoom-scroll-row">
                <span className="eyebrow">平移</span>
                <div className="zoom-pan-track" ref={zoomTrackRef}>
                  <div
                    className="zoom-pan-thumb"
                    style={{
                      width: `${zoomThumbWidth}px`,
                      left: `${zoomThumbLeft}px`,
                    }}
                    role="slider"
                    aria-label="左右移动音频预览"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(zoomMaxScroll)}
                    aria-valuenow={Math.round(zoomScroll)}
                    onPointerDown={beginZoomPan}
                  />
                </div>
              </div>
            )}

            <div className="timeline-transport">
              <button
                className="icon-btn"
                type="button"
                title={`后退 ${effectiveSkipSeconds} 秒`}
                disabled={!media}
                onClick={() => seekBy(-effectiveSkipSeconds)}
              >
                <IconBack />
              </button>
              <button
                className="icon-btn play-btn"
                type="button"
                title={playing ? '暂停' : '播放'}
                disabled={!media}
                onClick={togglePlay}
              >
                {playing ? <IconPause /> : <IconPlay />}
              </button>
              <button
                className="icon-btn"
                type="button"
                title={`前进 ${effectiveSkipSeconds} 秒`}
                disabled={!media}
                onClick={() => seekBy(effectiveSkipSeconds)}
              >
                <IconForward />
              </button>
              <span className="transport-time">
                <strong>{formatTime(currentTime)}</strong>
                <span>/</span>
                <span>{formatTime(duration)}</span>
              </span>
              <span className="timeline-transport-separator" />
              <button
                className={`toggle-btn${previewing ? ' is-active' : ''}`}
                type="button"
                disabled={!media || clipDuration < 0.02}
                onClick={previewRegion}
              >
                <IconPlaySmall />
                预览选区
              </button>
              <button
                className={`toggle-btn${loop ? ' is-active' : ''}`}
                type="button"
                disabled={!media}
                onClick={() => setLoop((value) => !value)}
              >
                <IconLoop />
                循环
              </button>
              <span className="transport-hint">SPACE 播放 · I / O 设起止</span>
              <div className="preview-volume">
                <button
                  className="icon-btn preview-volume-btn"
                  type="button"
                  title={settings.previewMuted ? '取消静音' : '静音'}
                  aria-label={settings.previewMuted ? '取消静音' : '静音'}
                  onClick={() =>
                    updateSettings({ previewMuted: !settings.previewMuted })
                  }
                >
                  <VolumeIcon muted={settings.previewMuted} />
                </button>
                <input
                  className="preview-volume-range"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={settings.previewVolume}
                  aria-label="预览音量"
                  onChange={(event) =>
                    updateSettings({
                      previewVolume: Number(event.target.value),
                      previewMuted: false,
                    })
                  }
                />
              </div>
              {!layout.timelineCollapsed && <div className="timeline-actions">
                <button className="btn btn-ghost btn-small timeline-full-extract" type="button"
                  disabled={!canExtractFull} onClick={handleExtractFull}>整段提取</button>
                <button className="btn btn-primary btn-small timeline-extract" type="button"
                  disabled={!canExtract} onClick={handleExtract}>
                  <IconExport />
                  {extracting ? '提取中…' : '提取'}
                </button>
              </div>}
            </div>
              </div>

          </section>
        </main>

        <aside ref={dockRef} className={`clip-inspector${layout.extractedCollapsed ? ' results-collapsed' : ''}`}>
          <div className="resizer resizer-vertical clip-dock-resizer" role="separator" aria-orientation="vertical"
            aria-label="调整右侧栏宽度" onPointerDown={beginInspectorResize} />
          <section ref={clipTimeRef} className="inspector clip-time">
            <h2 className="panel-heading panel-title-text">片段时间</h2>

                {!media ? (
                  <div className="inspector-empty">
                    <p>导入媒体后，在波形上拖动即可创建片段。</p>
                  </div>
                ) : (
                  <>
                    <div className="clip-times">
                      <div className="time-cell">
                        <span className="eyebrow">起始时间点</span>
                        <strong>{formatTime(region.start)}</strong>
                      </div>
                      <div className="time-cell">
                        <span className="eyebrow">结束时间点</span>
                        <strong>{formatTime(region.end)}</strong>
                      </div>
                      <div className="time-cell duration-cell">
                        <span className="eyebrow">片段时长</span>
                        <strong>{formatTime(clipDuration)}</strong>
                      </div>
                    </div>

                    <div className="inspector-actions">
                      <button
                        className="btn btn-ghost btn-small"
                        type="button"
                        onClick={setInPoint}
                      >
                        设为起始点
                      </button>
                      <button
                        className="btn btn-ghost btn-small"
                        type="button"
                        onClick={setOutPoint}
                      >
                        设为结束点
                      </button>
                    </div>
                  </>
                )}
          </section>
          {!layout.extractedCollapsed && (
            <div
              className="resizer resizer-horizontal clip-results-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label="调整已提取音频高度"
              onPointerDown={beginExtractedResize}
            />
          )}

          <section className={`extracted-panel${layout.extractedCollapsed ? ' is-collapsed' : ''}`}>
            <div className="extracted-head">
              <div className="extracted-title">
                <button
                  className="panel-collapse-btn"
                  type="button"
                  title={layout.extractedCollapsed ? '展开已提取音频' : '收起已提取音频'}
                  aria-label={layout.extractedCollapsed ? '展开已提取音频' : '收起已提取音频'}
                  aria-expanded={!layout.extractedCollapsed}
                  onClick={() => togglePanel('extractedCollapsed')}
                >
                  <IconChevronVertical collapsed={layout.extractedCollapsed} />
                </button>
                <strong>已提取音频</strong>
                <span className="extracted-count">{extractedClips.length}</span>
              </div>

            <div className="extracted-output" ref={outputControlsRef}>
                <div className="output-control">
                  <span className="eyebrow">输出格式</span>
                  <button
                    className="output-select-button"
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={openOutputMenu === 'format'}
                    onClick={() =>
                      setOpenOutputMenu((current) => (current === 'format' ? null : 'format'))
                    }
                  >
                    <span>{formatLabel}</span>
                    <IconChevronDown />
                  </button>
                  {openOutputMenu === 'format' && (
                    <div className="output-menu" role="listbox" aria-label="输出格式">
                      {FORMATS.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          role="option"
                          aria-selected={format === item.value}
                          className={format === item.value ? 'is-selected' : undefined}
                          onClick={() => {
                            setFormat(item.value)
                            setOpenOutputMenu(null)
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="output-control">
                  <span className="eyebrow">输出音质</span>
                  <button
                    className="output-select-button"
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={openOutputMenu === 'quality'}
                    disabled={losslessFormat}
                    onClick={() =>
                      setOpenOutputMenu((current) => (current === 'quality' ? null : 'quality'))
                    }
                  >
                    <span>{qualityLabel}</span>
                    <IconChevronDown />
                  </button>
                  {openOutputMenu === 'quality' && !losslessFormat && (
                    <div className="output-menu" role="listbox" aria-label="输出音质">
                      <button
                        type="button"
                        role="option"
                        aria-selected={useNativeQuality}
                        className={useNativeQuality ? 'is-selected' : undefined}
                        onClick={() => {
                          setUseNativeQuality(true)
                          setOpenOutputMenu(null)
                        }}
                      >
                        原生（{nativeBitrateKbps ?? '—'}-kbps）
                      </button>
                      {QUALITY_OPTIONS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="option"
                          aria-selected={!useNativeQuality && bitrate === value}
                          className={!useNativeQuality && bitrate === value ? 'is-selected' : undefined}
                          onClick={() => {
                            setUseNativeQuality(false)
                            setBitrate(value)
                            setOpenOutputMenu(null)
                          }}
                        >
                          {value} kbps
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
</div>

            <div className="extracted-list">
              {extractedClips.length === 0 ? (
                <div className="extracted-empty">
                  <IconFileAudio />
                  <span>还没有提取音频</span>
                  <small>在波形上选择范围，点击“提取”即可生成片段</small>
                </div>
              ) : (
                extractedClips.map((clip) => (
                  <div
                    key={clip.id}
                    className={`extracted-item${
                      activeExtractedClip?.id === clip.id ? ' is-active' : ''
                    }${playingExtractedId === clip.id ? ' is-playing' : ''}`}
                  >
                    <button
                      className="extracted-main"
                      type="button"
                      onClick={() => selectExtractedClip(clip)}
                    >
                      <span className="extracted-icon">
                        <IconFileAudio />
                      </span>
                      <span className="extracted-meta">
                        <strong title={`源素材：${clip.sourceName}`}><span translate="no">{clip.fileName}</span></strong>
                        <span>
                          {formatTime(clip.start)} – {formatTime(clip.end)} ·{' '}
                          {clip.format.toUpperCase()} · {formatLibrarySize(clip.size)}
                        </span>
                      </span>
                    </button>
                    <div className="extracted-actions">
                      <button
                        className="extracted-action btn btn-ghost btn-small"
                        type="button"
                        onClick={() => toggleExtractedPlayback(clip)}
                      >
                        {playingExtractedId === clip.id ? '暂停' : '播放'}
                      </button>
                      <button
                        className="extracted-action btn btn-ghost btn-small"
                        type="button"
                        disabled={savingClipId === clip.id}
                        onClick={() => void handleSaveExtracted(clip)}
                      >
                        {savingClipId === clip.id ? '保存中' : '保存'}
                      </button>
                      <button className="extracted-action btn btn-ghost btn-small" type="button" onClick={() => onAdjustClip(clip)}>音频调整</button>
                      <button
                        className="extracted-action is-danger btn btn-ghost btn-small"
                        type="button"
                        onClick={() => void handleDeleteExtracted(clip)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

        </aside>

      {job && (
        <div className={`jobbar job-${job.status}`}>
          <div className="jobbar-top">
            <span className="job-label">{jobLabel}</span>
            {job.outputPath && job.status === 'done' && (
              <span className="job-path" title={job.outputPath}>
                {job.outputPath}
              </span>
            )}
            {job.status === 'error' && <span className="job-error">{job.message}</span>}
            <div className="job-actions">
              {job.status === 'exporting' && (
                <button className="btn btn-ghost btn-small" type="button" onClick={() => void handleCancelExport()}>
                  取消
                </button>
              )}
              {job.status === 'done' && job.outputPath && (
                <button
                  className="btn btn-ghost btn-small"
                  type="button"
                  onClick={() => void window.vdro.revealFile(job.outputPath!)}
                >
                  打开文件夹
                </button>
              )}
              {job.status !== 'exporting' && (
                <button className="icon-btn close-job" type="button" title="关闭" onClick={() => setJob(null)}>
                  ×
                </button>
              )}
            </div>
          </div>
          {job.status === 'exporting' && (
            <div className="job-progress">
              <span style={{ width: `${job.progress}%` }} />
            </div>
          )}
        </div>
      )}
      </div>

      <audio
        ref={extractedAudioRef}
        className="hidden-audio"
        onPause={handleExtractedAudioPause}
        onEnded={handleExtractedAudioPause}
      />

      {libraryDrag &&
        (() => {
          const dragged = library.find((item) => item.id === libraryDrag.itemId)
          if (!dragged) return null
          return createPortal(
            <div
              className="library-drag-proxy"
              style={{
                left: libraryDrag.x + 12,
                top: libraryDrag.y + 12,
                width: libraryDrag.width,
              }}
            >
              <span className="library-thumb">
                {dragged.info.videoStreams.length > 0 ? <IconFileVideo /> : <IconFileAudio />}
              </span>
              <span className="library-meta">
                <strong>{dragged.fileName}</strong>
                <span>
                  {formatTime(dragged.info.duration, false)} · {summary(dragged)}
                </span>
              </span>
            </div>,
            document.body,
          )
        })()}

      {notice && (
        <div className="notice-banner" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      {settingsOpen && createPortal(
        <Suspense fallback={null}>
        <SettingsDialog
          settings={settings}
          appInfo={appInfo}
          onUpdate={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onResetAll={resetAllSettings}
          onResetLayout={resetLayoutSettings}
          onClearTemp={clearTemporaryFiles}
          onClearWaveformCache={clearWaveformCache}
          onChooseDirectory={chooseSaveDirectory}
          onOpenDataFolder={openDataFolder}
        />
        </Suspense>, document.getElementById('settings-root') ?? document.body
      )}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <IconWave />
            <strong>DROP TO LOAD</strong>
            <span>音频或视频文件</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function IconSettings(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 0 0 12 8.5Zm8 3.5l1.7 1.3-1.5 3.5-2.2-.6a7.7 7.7 0 0 1-1.6 1.6l.6 2.2-3.5 1.5L12 21l-1.3 1.7-3.5-1.5.6-2.2a7.7 7.7 0 0 1-1.6-1.6l-2.2.6-1.5-3.5L4 12l-1.7-1.3 1.5-3.5 2.2.6A7.7 7.7 0 0 1 7.6 6.2L7 4l3.5-1.5L12 4l1.3-1.7L16.8 4l-.6 2.2a7.7 7.7 0 0 1 1.6 1.6l2.2-.6 1.5 3.5L20 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconChevronVertical({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={collapsed ? 'is-collapsed' : undefined}
    >
      <path
        d="M6 15l6-6 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  )
}

function IconChevronDown(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  )
}

function IconPlay(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  )
}

function IconPause(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor" />
    </svg>
  )
}

function IconPlaySmall(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6l9 6-9 6z" fill="currentColor" />
    </svg>
  )
}

function IconBack(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 6L5 12l6 6v-4h2a4 4 0 010 8h-1v-2h1a2 2 0 000-4h-2z" fill="currentColor" />
    </svg>
  )
}

function IconForward(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 6l6 6-6 6v-4h-2a4 4 0 000 8h1v-2h-1a2 2 0 010-4h2z" fill="currentColor" />
    </svg>
  )
}

function IconExport(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l4 4h-3v7h-2V7H8zm-7 12h2v4h10v-4h2v6H5z" fill="currentColor" />
    </svg>
  )
}

function IconWave(): JSX.Element {
  return (
    <svg viewBox="0 0 48 24" aria-hidden="true">
      <path
        d="M2 12h4l2-7 3 14 3-10 3 7 3-12 3 16 3-9 3 5 3-8 3 11 3-7h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  )
}

function IconLoop(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7h11l-2-2m2 2l-2 2M19 17H8l2-2m-2 2l2 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  )
}
