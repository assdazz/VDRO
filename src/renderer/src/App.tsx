import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, JSX, PointerEvent as ReactPointerEvent } from 'react'
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
import { DEFAULT_APP_SETTINGS } from '@shared/defaults'
import { translateDom, translateUiText } from './i18n'
import { SettingsDialog } from './SettingsDialog'

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
const MIN_VIDEO_PREVIEW_HEIGHT = 180
const MIN_AUDIO_PREVIEW_HEIGHT = 180
const WORKSPACE_VERTICAL_PADDING = 16
const MIN_VIDEO_AREA_HEIGHT =
  MIN_VIDEO_PREVIEW_HEIGHT + WORKSPACE_VERTICAL_PADDING
const PANEL_RESIZER_HEIGHT = 18
const FIXED_AUDIO_HEIGHT = 180
const AUDIO_COLLAPSED_HEIGHT = 48
const AUDIO_EXPAND_DELTA = FIXED_AUDIO_HEIGHT - AUDIO_COLLAPSED_HEIGHT
const PREVIEW_COLLAPSED_HEIGHT = 60
const MIN_EDITOR_TOP_HEIGHT =
  MIN_VIDEO_AREA_HEIGHT + FIXED_AUDIO_HEIGHT + PANEL_RESIZER_HEIGHT

const LAYOUT_STORAGE_KEY = 'vdro.layout.v1'

interface LayoutSettings {
  inspectorWidth: number
  timelineHeight: number
  extractedRatio: number
  previewCollapsed: boolean
  timelineCollapsed: boolean
  extractedCollapsed: boolean
  soloHeight: number | null
}

const DEFAULT_LAYOUT: LayoutSettings = {
  inspectorWidth: 340,
  timelineHeight: FIXED_AUDIO_HEIGHT,
  extractedRatio: 1 / 3,
  previewCollapsed: false,
  timelineCollapsed: false,
  extractedCollapsed: false,
  soloHeight: null,
}

function loadLayout(): LayoutSettings {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<LayoutSettings>
    return {
      inspectorWidth: clamp(
        Number(parsed.inspectorWidth) || DEFAULT_LAYOUT.inspectorWidth,
        240,
        560,
      ),
      timelineHeight: FIXED_AUDIO_HEIGHT,
      extractedRatio: clamp(
        Number(parsed.extractedRatio) || DEFAULT_LAYOUT.extractedRatio,
        0.18,
        0.55,
      ),
      previewCollapsed: parsed.previewCollapsed === true,
      timelineCollapsed: parsed.timelineCollapsed === true,
      extractedCollapsed: parsed.extractedCollapsed === true,
      soloHeight:
        typeof parsed.soloHeight === 'number'
          ? clamp(parsed.soloHeight, 120, 760)
          : null,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

function formatTime(seconds: number, milliseconds = true): string {
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatLibrarySize(bytes: number): string {
  const MB = 1024 * 1024
  const GB = 1024 * MB
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.00MB'
  if (bytes < MB) return `${(bytes / MB).toFixed(2)}MB`
  if (bytes < GB) return `${Math.round(bytes / MB)}MB`
  return `${(bytes / GB).toFixed(2)}GB`
}

function summary(media: ImportedMedia): string {
  const video = media.info.videoStreams[0]
  const audio = media.info.audioStreams[0]
  return [video?.codec, audio?.codec]
    .filter(Boolean)
    .map((value) => value!.toUpperCase())
    .join(' · ')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

export default function App(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  const waveSurferRef = useRef<WaveSurfer | null>(null)
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
  const mainColumnRef = useRef<HTMLDivElement>(null)
  const editorTopRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const timelinePanelRef = useRef<HTMLElement>(null)
  const extractedPanelRef = useRef<HTMLElement>(null)
  const zoomFactorRef = useRef(1)
  const zoomTrackRef = useRef<HTMLDivElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewSettingsRef = useRef<HTMLDivElement>(null)
  const previewMenuRef = useRef<HTMLDivElement>(null)
  const appRootRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<LayoutSettings>(loadLayout)
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



  const [media, setMedia] = useState<ImportedMedia | null>(null)
  const [library, setLibrary] = useState<ImportedMedia[]>([])
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
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [loop, setLoop] = useState(false)
  const [region, setRegion] = useState<RegionRange>({ start: 0, end: 0 })
  const [format, setFormat] = useState<ExportFormat>('mp3')
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
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  const hasVideo = Boolean(media && media.info.videoStreams.length > 0)
  const sourceVideo = media?.info.videoStreams[0]
  const sourceAudio = media?.info.audioStreams.find((stream) => stream.index === audioStreamIndex)
  const clipDuration = Math.max(0, region.end - region.start)
  const libraryBytes = library.reduce(
    (total, item) => total + (Number.isFinite(item.info.size) ? item.info.size : 0),
    0,
  )
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
  const timelinePanelHeight = layout.timelineCollapsed
    ? 48
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
  }, [media?.id, settings.previewResolution, settings.previewFps])

  const syncRegion = useCallback((next: RegionRange): void => {
    regionRangeRef.current = next
    setRegion(next)
  }, [])

  const adoptMedia = useCallback(
    async (next: ImportedMedia): Promise<void> => {
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
        rememberPeaks(peaksCacheRef.current, next.id, nextPeaks)
        setPeaks(nextPeaks)
        setDuration(nextPeaks.duration)
      } catch (cause) {
        setMedia(null)
        setPeaks(null)
        setAudioStreamIndex(null)
        setError(errorMessage(cause))
      } finally {
        setLoading(false)
      }
    },
    [settings.previewMuted, settings.previewVolume],
  )

  const handleOpen = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const imported = await window.vdro.openFile()
      if (imported) await adoptMedia(imported)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [adoptMedia])

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

  useEffect(() => {
    const video = videoRef.current
    if (!video || !media) return

    const onLoadedMetadata = (): void => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration)
      }
    }
    const onTimeUpdate = (): void => {
      const mediaDuration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 0
      setCurrentTime(
        mediaDuration > 0 && video.currentTime >= mediaDuration - 0.03
          ? mediaDuration
          : video.currentTime,
      )
    }
    const onPlay = (): void => {
      if (extractedPlaybackRef.current) {
        setPlaying(true)
        return
      }
      extractedAudioRef.current?.pause()
      setPlayingExtractedId(null)
      setPlaying(true)
    }
    const onPause = (): void => {
      setPlaying(false)
      setPreviewing(false)
    }
    const onEnded = (): void => {
      // timeupdate often stops slightly before the real media duration, so
      // the preview progress bar never reaches 100% for audio-only media.
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration)
        setCurrentTime(video.duration)
      }
      setPlaying(false)
      setPreviewing(false)
    }

    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.load()

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
    }
  }, [media])

  useEffect(() => {
    const video = videoRef.current
    const canvas = previewCanvasRef.current
    if (!media || !hasVideo || !video || !canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    let frame = 0
    let lastDraw = 0

    const draw = (): void => {
      if (!video.videoWidth || !video.videoHeight) return
      const aspect = video.videoWidth / video.videoHeight
      const width = Math.max(1, Math.round(previewResolution * aspect))
      const height = previewResolution
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      context.drawImage(video, 0, 0, width, height)
    }

    const loop = (now: number): void => {
      if (video.paused) return
      if (now - lastDraw >= 1000 / previewFps) {
        draw()
        lastDraw = now
      }
      frame = requestAnimationFrame(loop)
    }

    const start = (): void => {
      cancelAnimationFrame(frame)
      lastDraw = 0
      frame = requestAnimationFrame(loop)
    }
    const stop = (): void => {
      cancelAnimationFrame(frame)
      draw()
    }

    video.addEventListener('loadedmetadata', draw)
    video.addEventListener('loadeddata', draw)
    video.addEventListener('canplay', draw)
    video.addEventListener('seeked', draw)
    video.addEventListener('timeupdate', draw)
    video.addEventListener('play', start)
    video.addEventListener('pause', stop)
    draw()
    const initialFrame = requestAnimationFrame(draw)
    if (!video.paused) start()

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(initialFrame)
      video.removeEventListener('loadedmetadata', draw)
      video.removeEventListener('loadeddata', draw)
      video.removeEventListener('canplay', draw)
      video.removeEventListener('timeupdate', draw)
      video.removeEventListener('seeked', draw)
      video.removeEventListener('play', start)
      video.removeEventListener('pause', stop)
    }
  }, [media, hasVideo, previewResolution, previewFps])

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
      cursorColor: '#faff69',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 0,
      normalize: true,
      interact: true,
      dragToSeek: true,
      autoScroll: false,
      autoCenter: false,
      hideScrollbar: true,
    })

    const regions = waveSurfer.registerPlugin(RegionsPlugin.create())
    regions.enableDragSelection({ color: 'rgba(250,255,105,0.10)' })

    const handleRegion = (next: RegionLike): void => {
      regionRef.current = next
      syncRegion({ start: next.start, end: next.end })
    }

    regions.on('region-created', (next) => {
      for (const other of regions.getRegions()) {
        if (other.id !== next.id) {
          setTimeout(() => other.remove(), 0)
        }
      }
      handleRegion(next)
    })
    regions.on('region-updated', (next) => {
      setActiveExtractedClip(null)
      handleRegion(next)
    })

    waveSurfer.on('ready', () => {
      if (regions.getRegions().length === 0) {
        const end = Math.min(10, Math.max(1, peaks.duration))
        const initial = regions.addRegion({
          start: 0,
          end,
          color: 'rgba(250,255,105,0.10)',
          drag: true,
          resize: true,
        })
        handleRegion(initial)
      }

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
      resizeObserver.disconnect()
      waveSurfer.destroy()
      waveSurferRef.current = null
      regionRef.current = null
    }
  }, [media, peaks, syncRegion])

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
      void adoptMedia(next)
    })
  }, [adoptMedia])

  const applyZoom = useCallback(
    (nextFactor: number): void => {
      const wave = waveSurferRef.current
      if (!wave || !peaks) return

      const duration = wave.getDuration() || peaks.duration
      const width = wave.getWidth()
      if (duration <= 0 || width <= 0) return

      const fitPxPerSec = width / duration
      const factor = clamp(nextFactor, 1, 16)
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
    setActiveExtractedClip(null)
    current.setOptions({ start })
    syncRegion({ start, end: current.end })
  }, [syncRegion])

  const setOutPoint = useCallback((): void => {
    const video = videoRef.current
    const current = regionRef.current
    if (!video || !current) return
    const end = clamp(video.currentTime, current.start + 0.02, duration || video.duration)
    setActiveExtractedClip(null)
    current.setOptions({ end })
    syncRegion({ start: current.start, end })
  }, [duration, syncRegion])

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

    setActiveExtractedClip(null)
    regionRef.current?.setOptions({ start: 0, end: fullEnd })
    syncRegion({ start: 0, end: fullEnd })
    void extractRange(0, fullEnd)
  }, [
    media,
    peaks,
    audioStreamIndex,
    extracting,
    duration,
    extractRange,
    syncRegion,
  ])

  const resolveExtractedSource = useCallback(
    async (clip: ExtractedClip): Promise<ExtractedClip | null> => {
      if (media && clip.sourceMediaId === media.id) return clip

      const source = library.find((item) => item.fileName === clip.sourceName)
      if (!source) {
        setError('找不到该片段对应的源素材，请重新导入原文件')
        return null
      }

      await adoptMedia(source)
      const resolved = { ...clip, sourceMediaId: source.id }
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
      const next = { ...current, ...patch }
      void window.vdro.saveSettings(next).catch(() => undefined)
      return next
    })
  }, [])

  const resetAllSettings = useCallback((): void => {
    setSettings(DEFAULT_APP_SETTINGS)
    void window.vdro.saveSettings(DEFAULT_APP_SETTINGS).catch(() => undefined)
    setLayout(DEFAULT_LAYOUT)
    setLoop(DEFAULT_APP_SETTINGS.previewLoop)
    setLibraryCollapsed(DEFAULT_APP_SETTINGS.sidebarCollapsed)
    setNotice('已恢复全部默认设置')
  }, [])

  const resetLayoutSettings = useCallback((): void => {
    setLayout(DEFAULT_LAYOUT)
    setAudioEditorHeight(null)
    setNotice('已重置界面布局')
  }, [])

  const togglePanel = useCallback(
    (panel: 'previewCollapsed' | 'timelineCollapsed' | 'extractedCollapsed'): void => {
      if (panel === 'timelineCollapsed') {
        if (layout.previewCollapsed) {
          // Video is a collapsed 60px bar. The audio panel is the only
          // expanding row, so the editor should be exactly their sum.
          setAudioEditorHeight(
            PREVIEW_COLLAPSED_HEIGHT +
              (layout.timelineCollapsed
                ? FIXED_AUDIO_HEIGHT
                : AUDIO_COLLAPSED_HEIGHT),
          )
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
          const minHeight = layout.timelineCollapsed
            ? MIN_EDITOR_TOP_HEIGHT
            : MIN_VIDEO_AREA_HEIGHT +
              AUDIO_COLLAPSED_HEIGHT +
              PANEL_RESIZER_HEIGHT
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
          setAudioEditorHeight(
            layout.timelineCollapsed
              ? MIN_VIDEO_AREA_HEIGHT +
                  AUDIO_COLLAPSED_HEIGHT +
                  PANEL_RESIZER_HEIGHT
              : MIN_EDITOR_TOP_HEIGHT,
          )
        } else {
          // Collapsing video: drop the editor to the two collapsed bars so
          // there is no empty space above the extracted-audio panel.
          setAudioEditorHeight(
            PREVIEW_COLLAPSED_HEIGHT +
              (layout.timelineCollapsed
                ? AUDIO_COLLAPSED_HEIGHT
                : FIXED_AUDIO_HEIGHT),
          )
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
    stopExtractedPlayback()
    await window.vdro.clearTempFiles()
    setExtractedClips([])
    setActiveExtractedClip(null)
    setNotice('已清理所有临时提取文件')
  }, [stopExtractedPlayback, settings.confirmDelete, settings.language])

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
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // Layout persistence is non-critical.
    }
  }, [layout])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const next = await window.vdro.getSettings()
        if (cancelled) return

        setSettings(next)
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
        if (!next.restoreLayout) setLayout(DEFAULT_LAYOUT)

        const [info, loadedLibrary, loadedClips] = await Promise.all([
          window.vdro.getAppInfo().catch(() => null),
          next.persistLibrary
            ? window.vdro.loadLibrary().catch(() => ({ media: [], missing: [] }))
            : Promise.resolve({ media: [], missing: [] }),
          next.persistExtracted && next.persistLibrary
            ? window.vdro.loadExtracted().catch(() => [])
            : Promise.resolve([]),
        ])

        if (cancelled) return
        if (info) setAppInfo(info)
        if (loadedLibrary.media.length > 0) {
          setLibrary((previous) => {
            const known = new Set(previous.map((item) => item.filePath))
            return [...previous, ...loadedLibrary.media.filter((item) => !known.has(item.filePath))]
          })
        }
        if (loadedLibrary.missing.length > 0) {
          setNotice(
            `${loadedLibrary.missing.length} 个素材文件已失效，已从素材库跳过`,
          )
        }
        if (loadedClips.length > 0) {
          setExtractedClips(
            loadedClips.map((clip) => {
              const source = loadedLibrary.media.find(
                (item) => item.fileName === clip.sourceName,
              )
              return source ? { ...clip, sourceMediaId: source.id } : clip
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
  }, [])

  useEffect(() => {
    if (!settingsLoaded) return
    const timer = window.setTimeout(() => {
      void window.vdro.saveSettings(settings).catch(() => undefined)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [settings, settingsLoaded])

  useEffect(() => {
    if (!settingsLoaded) return
    void window.vdro.setWindowTranslucent(isTranslucent).catch(() => undefined)
  }, [settingsLoaded, isTranslucent, settings.theme, settings.translucent])

  useEffect(() => {
    if (!settingsLoaded) return
    void window.vdro.setZoomFactor(settings.uiScale / 100).catch(() => undefined)
  }, [settingsLoaded, settings.uiScale])

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
    const root = appRootRef.current
    if (!root) return

    const apply = (): void => translateDom(root, settings.language)
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder'],
    })
    return () => observer.disconnect()
  }, [settings.language, settingsLoaded, settingsOpen])

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
    if (!settingsLoaded) return
    setLayout(settings.restoreLayout ? loadLayout() : DEFAULT_LAYOUT)
  }, [settingsLoaded, settings.restoreLayout])

  useEffect(() => {
    if (!media) return
    setExtractedClips((previous) =>
      previous.map((clip) =>
        clip.sourceName === media.fileName
          ? { ...clip, sourceMediaId: media.id }
          : clip,
      ),
    )
  }, [media?.id])

  useEffect(() => {
    if (!settingsLoaded) return
    const entries = settings.persistLibrary
      ? library.map((item) => ({ filePath: item.filePath, fileName: item.fileName }))
      : []
    void window.vdro.saveLibrary(entries).catch(() => undefined)
  }, [library, settings.persistLibrary, settingsLoaded])

  useEffect(() => {
    if (!settingsLoaded) return
    const clips =
      settings.persistExtracted && settings.persistLibrary ? extractedClips : []
    void window.vdro.saveExtractedClips(clips).catch(() => undefined)
  }, [
    extractedClips,
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
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
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
      const audioHeight = layout.timelineCollapsed
        ? AUDIO_COLLAPSED_HEIGHT
        : FIXED_AUDIO_HEIGHT
      const minEditorHeight =
        MIN_VIDEO_AREA_HEIGHT + audioHeight + PANEL_RESIZER_HEIGHT
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
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
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
            Math.max(120, mainHeight - 120),
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
        const nextRatio = clamp(startRatio + up / mainHeight, 0.18, 0.55)
        setLayout((current) => ({
          ...current,
          extractedRatio: nextRatio,
        }))
      }
      const onUp = (): void => {
        document.body.style.userSelect = previousSelect
        document.body.classList.remove('is-resizing-layout')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
    },
    [layout.extractedRatio, soloPanel],
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
          Math.max(minHeight, mainHeight - 120),
        )
        setLayout((current) => ({ ...current, soloHeight: next }))
      }
      const onUp = (): void => {
        document.body.style.userSelect = previousSelect
        document.body.classList.remove('is-resizing-layout')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
    },
    [soloPanel],
  )

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
      if (settingsOpen) return
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
  ])

  const jobLabel =
    job?.status === 'exporting'
      ? `正在导出 ${job.progress}%`
      : job?.status === 'done'
        ? '导出完成'
        : job?.status === 'error'
          ? '导出失败'
          : '已取消导出'

  return (
    <div
      ref={appRootRef}
      className={`app theme-${settings.theme} material-${settings.materialColor} accent-${settings.accent} ui-scale-${settings.uiScale}`}
      style={
        {
          '--vd-font-scale': settings.fontScale / 100,
        } as CSSProperties
      }
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
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">VDRO</span>
          <span className="brand-sub">音频提取器</span>
        </div>

        <div className="topbar-file">
          {media && (
            <>
              <span className="file-name" title={media.fileName}>
                {media.fileName}
              </span>
              <span className="format-badge">{summary(media)}</span>
              <span className="file-duration">{formatTime(duration, false)}</span>
            </>
          )}
        </div>

        <button
          className="topbar-settings-btn"
          type="button"
          title="设置"
          aria-label="打开设置"
          onClick={() => setSettingsOpen(true)}
        >
          <IconSettings />
        </button>
      </header>

      <div className={`app-body${libraryCollapsed ? ' library-collapsed' : ''}`}>
        <aside className={`library-panel${libraryCollapsed ? ' is-collapsed' : ''}`}>
          <div className="library-head">
            {!libraryCollapsed && (
              <div className="library-title">
                <span className="library-count">素材数量：{library.length}</span>
                <span className="library-size">共{formatLibrarySize(libraryBytes)}</span>
              </div>
            )}
            <button
              className="library-toggle"
              type="button"
              title={libraryCollapsed ? '展开素材栏' : '收缩素材栏'}
              aria-label={libraryCollapsed ? '展开素材栏' : '收缩素材栏'}
              onClick={() => setLibraryCollapsed((value) => !value)}
            >
              <IconChevron collapsed={libraryCollapsed} />
            </button>
          </div>

          {!libraryCollapsed && (
            <button className="library-add" type="button" onClick={() => void handleOpen()}>
              <IconPlus />
              导入素材
            </button>
          )}

          <div
            ref={libraryListRef}
            className={`library-list${libraryDrag ? ' is-dragging' : ''}`}
          >
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
                      <div
                        data-library-id={item.id}
                        className={`library-item${media?.id === item.id ? ' is-active' : ''}`}
                        title={item.fileName}
                        onPointerDown={(event) => beginLibraryPress(event, item)}
                      >
                        <button
                          className="library-main"
                          type="button"
                          onClick={() => {
                            if (suppressLibraryClickRef.current) {
                              suppressLibraryClickRef.current = false
                              return
                            }
                            void adoptMedia(item)
                          }}
                        >
                          <span className="library-thumb">
                            {item.info.videoStreams.length > 0 ? (
                              <IconFileVideo />
                            ) : (
                              <IconFileAudio />
                            )}
                          </span>
                          {!libraryCollapsed && (
                            <span className="library-meta">
                              <strong>{item.fileName}</strong>
                              <span>
                                {formatTime(item.info.duration, false)} · {summary(item)}
                              </span>
                            </span>
                          )}
                        </button>
                        {!libraryCollapsed && (
                          <button
                            className="library-remove"
                            type="button"
                            title="从素材栏移除"
                            aria-label={`从素材栏移除 ${item.fileName}`}
                            onClick={() => removeLibraryItem(item)}
                          >
                            <IconTrash />
                          </button>
                        )}
                      </div>
                    </Fragment>
                  ))}
                  {placeholderIndex === visibleLibrary.length && placeholder}
                </>
              )
            })()}

            {!libraryCollapsed && library.length === 0 && (
              <div className="library-empty">
                <IconLibrary />
                <span>素材会出现在这里</span>
                <small>拖入音频或视频，或点击上方导入</small>
              </div>
            )}

            {libraryCollapsed && (
              <button
                className="library-rail-add"
                type="button"
                title="导入素材"
                aria-label="导入素材"
                onClick={() => void handleOpen()}
              >
                <IconPlus />
              </button>
            )}
          </div>

          {libraryCollapsed && <span className="library-rail-label">素材</span>}
        </aside>

        <div className="main-column" ref={mainColumnRef}>
          <div
            ref={editorTopRef}
            className={`editor-top${layout.previewCollapsed ? ' preview-collapsed' : ''}${
              layout.timelineCollapsed ? ' timeline-collapsed' : ''
            }${layout.previewCollapsed && layout.timelineCollapsed ? ' all-top-collapsed' : ''}${
              isSoloSized ? ' solo-resized' : ''
            }${isPreviewSolo ? ' preview-solo' : ''}${audioToggling ? ' audio-toggling' : ''}`}
            style={
              isPreviewSolo
                ? {
                    flexGrow: 1,
                    flexBasis: 0,
                    height: undefined,
                    minHeight: MIN_VIDEO_AREA_HEIGHT + AUDIO_COLLAPSED_HEIGHT,
                  }
                : {
                    flexGrow:
                      audioEditorHeight === null
                        ? 1 - layout.extractedRatio
                        : 0,
                    flexBasis:
                      audioEditorHeight === null
                        ? undefined
                        : `${audioEditorHeight}px`,
                    height:
                      audioEditorHeight === null
                        ? undefined
                        : `${audioEditorHeight}px`,
                    minHeight:
                      audioEditorHeight === null
                        ? undefined
                        : `${Math.max(
                            audioEditorHeight,
                            layout.previewCollapsed
                              ? 0
                              : layout.timelineCollapsed
                                ? MIN_VIDEO_AREA_HEIGHT +
                                  48 +
                                  PANEL_RESIZER_HEIGHT
                                : MIN_EDITOR_TOP_HEIGHT,
                          )}px`,
                  }
            }
          >
            <main
              ref={workspaceRef}
              className={`workspace${layout.previewCollapsed ? ' is-collapsed' : ''}`}
            >
            <section
              className={`preview-panel${layout.previewCollapsed ? ' is-collapsed' : ''}`}
              style={
                layout.previewCollapsed
                  ? { flex: '0 0 44px', minHeight: 44, alignSelf: 'stretch' }
                  : undefined
              }
            >
              <div className="preview-collapse-bar">
                <button
                  className="panel-collapse-btn"
                  type="button"
                  title={layout.previewCollapsed ? '展开视频预览' : '收起视频预览'}
                  aria-label={layout.previewCollapsed ? '展开视频预览' : '收起视频预览'}
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
                    {hasVideo && <canvas ref={previewCanvasRef} className="preview-canvas" />}
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
                          {previewResolutionLabel} · {previewFps}帧
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
                              <div className="settings-grid">
                                {PREVIEW_RESOLUTIONS.map((item) => (
                                  <button
                                    key={item.height}
                                    className={`setting-option${
                                      previewResolution === item.height ? ' is-active' : ''
                                    }`}
                                    type="button"
                                    onClick={() => setPreviewResolution(item.height)}
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
                                      previewFps === fps ? ' is-active' : ''
                                    }`}
                                    type="button"
                                    onClick={() => setPreviewFps(fps)}
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

            </main>

            {soloPanel === null && !layout.previewCollapsed && (
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
            style={{
              flexBasis: `${effectiveTimelineHeight}px`,
              minHeight: `${effectiveTimelineHeight}px`,
              height: layout.timelineCollapsed ? '48px' : undefined,
              maxHeight: layout.timelineCollapsed ? '48px' : undefined,
              flexGrow: layout.timelineCollapsed ? 0 : undefined,
            }}
          >
            <div
              className="timeline-layout"
              style={{
                gridTemplateColumns: `minmax(0, 1fr) 12px ${layout.inspectorWidth}px`,
              }}
            >
              <div className="timeline-editor">
            <div className="timeline-head">
              <div>
                <button
                  className="panel-collapse-btn"
                  type="button"
                  title={layout.timelineCollapsed ? '展开音频预览' : '收起音频预览'}
                  aria-label={layout.timelineCollapsed ? '展开音频预览' : '收起音频预览'}
                  onClick={() => togglePanel('timelineCollapsed')}
                >
                  <IconChevronVertical collapsed={layout.timelineCollapsed} />
                </button>
                <span className="panel-title-text">音频预览</span>
                <span className="timeline-note">
                  {media ? '拖动波形创建选区 · 拖两端调整' : '等待媒体'}
                </span>
              </div>
              {!layout.timelineCollapsed && <div className="timeline-actions">
                <button
                  className="btn btn-ghost btn-small timeline-full-extract"
                  type="button"
                  disabled={!canExtractFull}
                  onClick={handleExtractFull}
                >
                  整段提取
                </button>
                <button
                  className="btn btn-primary btn-small timeline-extract"
                  type="button"
                  disabled={!canExtract}
                  onClick={handleExtract}
                >
                  <IconExport />
                  {extracting ? '提取中…' : '提取'}
                </button>
              </div>}
              {!layout.timelineCollapsed && (
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
                    {settings.previewMuted ? <IconVolumeMuted /> : <IconVolume />}
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
              )}
            </div>

            <div className={`waveform-wrap${extractedOverlay ? ' has-extracted' : ''}`}>
              {media ? (
                <div ref={waveRef} className="waveform" />
              ) : (
                <div className="timeline-empty">
                  <span className="timeline-empty-line" />
                  <span className="eyebrow">此处显示波形图</span>
                </div>
              )}
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
            </div>

            <div className="timeline-zoom" role="group" aria-label="波形缩放">
              <button
                className="zoom-btn"
                type="button"
                disabled={!peaks || zoomFactor <= 1.01}
                onClick={() => {
                  const next = zoomFactor / 1.5
                  if (next <= 1.01) resetZoom()
                  else applyZoom(next)
                }}
              >
                缩小
              </button>
              <button
                className="zoom-btn"
                type="button"
                disabled={!peaks || zoomFactor >= 16}
                onClick={() => applyZoom(zoomFactor * 1.5)}
              >
                放大
              </button>
              <button
                className="zoom-btn"
                type="button"
                disabled={!peaks || zoomFactor <= 1.01}
                onClick={resetZoom}
              >
                重置
              </button>
            </div>
              </div>

              <div
                className={`resizer resizer-vertical timeline-inspector-resizer${layout.timelineCollapsed ? ' is-disabled' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整音频预览与片段时间宽度"
                onPointerDown={layout.timelineCollapsed ? undefined : beginInspectorResize}
              />

              <aside className="inspector inspector-embedded">
                <div className="panel-heading">
                  <span className="eyebrow">片段时间</span>
                  <span className="panel-index">01</span>
                </div>

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
              </aside>
            </div>
          </section>

          </div>

          {soloPanel === null && !layout.extractedCollapsed && (
            <div
              className="resizer resizer-horizontal"
              role="separator"
              aria-orientation="horizontal"
              aria-label="调整已提取音频高度"
              onPointerDown={beginExtractedResize}
            />
          )}

          <section
            ref={extractedPanelRef}
            className={`extracted-panel${layout.extractedCollapsed ? ' is-collapsed' : ''}`}
            style={
              layout.extractedCollapsed
                ? { flexGrow: 0, flexBasis: '48px', minHeight: '48px' }
                : soloPanel === 'extracted' && layout.soloHeight !== null
                  ? {
                      flexGrow: 0,
                      flexBasis: `${layout.soloHeight}px`,
                      minHeight: `${layout.soloHeight}px`,
                    }
                  : {
                      flexGrow:
                        audioEditorHeight !== null || soloPanel === 'extracted'
                          ? 1
                          : layout.extractedRatio,
                    }
            }
          >
            <div className="extracted-head">
              <div className="extracted-title">
                <button
                  className="panel-collapse-btn"
                  type="button"
                  title={layout.extractedCollapsed ? '展开已提取音频' : '收起已提取音频'}
                  aria-label={layout.extractedCollapsed ? '展开已提取音频' : '收起已提取音频'}
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
                  <small>在波形上选择范围，点击时间轴右侧“提取”</small>
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
                        <strong title={`源素材：${clip.sourceName}`}>{clip.fileName}</strong>
                        <span>
                          {formatTime(clip.start)} – {formatTime(clip.end)} ·{' '}
                          {clip.format.toUpperCase()} · {formatLibrarySize(clip.size)}
                        </span>
                      </span>
                    </button>
                    <div className="extracted-actions">
                      <button
                        className="extracted-action"
                        type="button"
                        onClick={() => toggleExtractedPlayback(clip)}
                      >
                        {playingExtractedId === clip.id ? '暂停' : '播放'}
                      </button>
                      <button
                        className="extracted-action"
                        type="button"
                        disabled={savingClipId === clip.id}
                        onClick={() => void handleSaveExtracted(clip)}
                      >
                        {savingClipId === clip.id ? '保存中' : '保存'}
                      </button>
                      <button
                        className="extracted-action is-danger"
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

          {soloPanel === 'extracted' && (
            <div
              className="resizer resizer-horizontal solo-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label="调整已提取音频高度"
              onPointerDown={beginSoloResize}
            />
          )}

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

      {settingsOpen && (
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

function IconSettings(): JSX.Element {
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

function IconPlus(): JSX.Element {
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

function IconLibrary(): JSX.Element {
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

function IconFileAudio(): JSX.Element {
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

function IconFileVideo(): JSX.Element {
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

function IconVolume(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 9h4l5-4v14l-5-4H4V9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconVolumeMuted(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 9h4l5-4v14l-5-4H4V9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m16 9 5 6m0-6-5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
