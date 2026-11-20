import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { MAX_MIX_OFFSET, MAX_MIX_CLIPS } from '@shared/types'
import type { AppSettings, AudioAdjustment, ExtractedClip, ImportedMedia, MixTrackRequest, PeaksResult } from '@shared/types'
import { fadeBounds, fadeLevel } from '@shared/fades'
import { pitchAt, sortedPitchPoints } from '@shared/pitch'
import { translateUiText } from '../i18n'
import { formatTime, MediaLibrary, MediaLibraryItem } from '../MediaLibrary'
import { WaveformZoomControls } from '../WaveformZoomControls'
import { TimelineToolPicker, useTimelineToolShortcuts, type TimelineTool } from '../TimelineToolPicker'
import { TimelineEditButton, TimelineEditControls } from '../TimelineEditControls'
import { TimelinePlayheadHandle, type PlayheadDrag } from '../TimelinePlayheadHandle'
import { ClipContextMenu, type ClipMenuAction } from './ClipContextMenu'
import { MissingMediaList } from '../MissingMediaList'
import { readDraft, saveDraft, reportProjectState } from '../projectDraft'
import { useTimelineHistoryShortcuts } from '../useTimelineHistoryShortcuts'
import { useEditHistory } from '../useEditHistory'
import { AdjustmentOutputFields, defaultAdjustment, TimeField, useAdjustmentOutput } from './AdjustmentFields'
import { AdjustmentTrackHeader, DEFAULT_TRACK_APPEARANCE, type TrackAppearance } from './AdjustmentTrackHeader'
import { useRealtimePreview } from './useRealtimePreview'
import { RealtimeMix } from './RealtimeMix'
import { openPreviewWave, type PreviewWave } from './previewWave'
import './audio-mix.css'

type LibraryAsset = {
  media: ImportedMedia
  audioStreamIndex: number
}
type Track = MixTrackRequest & LibraryAsset & {
  id: string
  lane: number
  waveform: PeaksResult
  muted: boolean
}
type MixTimeline = { tracks: Track[]; laneAppearance: Record<number, TrackAppearance> }
type ProjectTrack = Omit<Track, 'media' | 'mediaId' | 'waveform'> & { path: string }
type MixProject = { paths: string[]; tracks: ProjectTrack[]; laneAppearance: MixTimeline['laneAppearance']; selected: string; results?: { id: string; fingerprint: string; offset: number }[] }
type RenderedOutput = { clip: ExtractedClip; fingerprint: string; offset: number }
type SourcePreview = { mediaId: string; start: number; end: number; url: string; wave: PreviewWave; clip?: ExtractedClip }
type RealtimeMode = 'realtime-mix' | 'realtime-clip'
type PlaybackMode = 'mix' | RealtimeMode | 'live' | 'original'
type DragSource = { asset: LibraryAsset } | { track: Track }
type DropPlacement = { start: number; end: number; guide?: number }
type TimelineView = { start: number; length: number }
type TrimEdge = 'start' | 'end'
type TrimRange = { from: number; to: number; guide?: number }
const MIN_CLIP_DURATION = 0.02
const MIN_TIMELINE_DURATION = 10
const MAX_TIMELINE_ZOOM = 32
const MIX_ASSET_TYPE = 'application/x-vdro-mix-asset'
const MIX_CLIP_TYPE = 'application/x-vdro-mix-clip'
const NEUTRAL: AudioAdjustment = { semitones: 0, gainDb: 0, fadeIn: 0, fadeOut: 0, curve: 'tri', preserveFormants: false, limiter: false }
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/^Error invoking remote method '[^']+': Error: /, '')
const seconds = (value: number) => value.toFixed(2) + ' s'
const mixEnd = (track: MixTrackRequest) => track.offset + track.end - track.start
const orientedRange = (track: Track, original: boolean) => original && track.reversed
  ? { start: track.media.info.duration - track.end, end: track.media.info.duration - track.start }
  : { start: track.start, end: track.end }
const dragDuration = (source: DragSource) => 'track' in source
  ? source.track.end - source.track.start : source.asset.media.info.duration
const canSplitAt = (track: Track, time: number) => time <= MAX_MIX_OFFSET &&
  time - track.offset >= MIN_CLIP_DURATION - 1e-6 && mixEnd(track) - time >= MIN_CLIP_DURATION - 1e-6
const clamp = (time: number, low: number, high: number) => Math.max(low, Math.min(high, time))
const percent = (time: number, view: TimelineView) => (time - view.start) / view.length * 100 + '%'
function timeAt(clientX: number, rect: DOMRect, view: TimelineView) {
  return view.start + clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1) * view.length
}
function overlaps(tracks: Track[], lane: number, start: number, end: number, except?: string) {
  return tracks.some(track => track.lane === lane && track.id !== except &&
    track.offset < end - 0.000001 && mixEnd(track) > start + 0.000001)
}

function renderTrackKey(track: Track) {
  return { filePath: track.media.filePath, size: track.media.info.size, modifiedAt: track.media.info.modifiedAt,
    audioStreamIndex: track.audioStreamIndex, start: track.start, end: track.end, offset: track.offset,
    effects: track.effects, reversed: track.reversed }
}

const disposeClip = (clip: ExtractedClip) => window.vdro.deleteExtracted(clip.id, clip.filePath).catch(() => undefined)

export function AudioMixWorkspace({ settings, active, incoming, projectId }: {
  projectId?: string
  settings: AppSettings
  active: boolean
  incoming: { path: string; key: number } | null
}) {
  const { present: mixTimeline, past, future, commit: editTimeline, reset: restoreProject, undo, redo } =
    useEditHistory<MixTimeline>({ tracks: [], laneAppearance: {} })
  const { tracks, laneAppearance } = mixTimeline
  const [library, setLibrary] = useState<LibraryAsset[]>([])
  const [libraryCollapsed, setLibraryCollapsed] = useState(settings.sidebarCollapsed)
  const [selected, setSelected] = useState('')
  const selectedId = useRef(selected)
  selectedId.current = selected
  const [clipboard, setClipboard] = useState<Track | null>(null)
  const [clipMenu, setClipMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [selectedMedia, setSelectedMedia] = useState('')
  const [dropTarget, setDropTarget] = useState<(DropPlacement & { lane: number; pointerX: number }) | null>(null)
  const dragSource = useRef<DragSource | null>(null)
  const [marker, setMarker] = useState('')
  const [results, setResults] = useState<RenderedOutput[]>([])
  const [result, setResult] = useState<RenderedOutput | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [mode, setMode] = useState<PlaybackMode>('live')
  const [inspector, setInspector] = useState<'parameters' | 'results'>('parameters')
  const [position, setPosition] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState(0)
  const panDrag = useRef<{ pointerId: number; clientX: number; start: number; secondsPerPixel: number } | null>(null)
  const [selectRange, setSelectRange] = useState(false)
  const [timelineTool, setTimelineTool] = useState<TimelineTool>('select')
  const [trimPreview, setTrimPreview] = useState<{ lane: number; range: TrimRange } | null>(null)
  const [keptRange, setKeptRange] = useState<TrimRange | null>(null)
  const [snap, setSnap] = useState(settings.adjustmentSnap)
  const [busy, setBusy] = useState<'import' | 'place' | 'prepare' | 'render' | 'save' | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const [dragging, setDragging] = useState<{ clipId?: string; duration: number } | null>(null)
  const [mixPlaying, setMixPlaying] = useState(false)
  const [mixVolume, setMixVolume] = useState(settings.previewMuted ? 0 : settings.previewVolume)
  const mix = useRef<RealtimeMix>(null)
  const previewCache = useRef(new Map<string, SourcePreview>())
  const ownedMedia = useRef(new Set<string>())
  const removedAssets = useRef(new Set<string>())
  const activePage = useRef(active)
  activePage.current = active
  const audio = useRef<HTMLAudioElement>(null)
  const liveAudio = useRef<HTMLAudioElement>(null)
  const originalAudio = useRef<HTMLAudioElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  const pendingPreview = useRef<{ id: string; mode: 'live' | 'original'; time: number } | null>(null)
  const consumed = useRef<number | null>(null)
  const job = useRef<string | null>(null)
  const working = useRef(false)
  const playOnLoad = useRef<{ id: string; time: number } | null>(null)
  const changeTimelineTool = useCallback((tool: TimelineTool) => {
    setTimelineTool(tool)
    if (tool === 'split') {
      setSelectRange(false)
      setTrimPreview(null)
      setKeptRange(null)
    }
  }, [])
  const dismissClipMenu = useCallback(() => setClipMenu(null), [])
  useTimelineToolShortcuts(active, settings.shortcuts, changeTimelineTool)
  const selectedTrack = tracks.find(track => track.id === selected)
  const sourceBitrate = selectedTrack?.media.info.audioStreams.find(stream => stream.index === selectedTrack.audioStreamIndex)?.bitRate
  const output = useAdjustmentOutput(settings, sourceBitrate)
  const mixTracks = useMemo(() => tracks
    .filter(track => !laneAppearance[track.lane]?.ignored)
    .map(track => laneAppearance[track.lane]?.muted ? { ...track, muted: true } : track),
  [tracks, laneAppearance])
  const audibleTracks = useMemo(() => mixTracks.filter(track => !track.muted)
    .map(({ mediaId, audioStreamIndex, start, end, offset, effects, reversed }) => ({
      mediaId, audioStreamIndex, start, end, offset, effects, reversed,
    })), [mixTracks])
  const lastEnd = Math.max(0, ...tracks.map(mixEnd))
  const realtimeClip = mode === 'realtime-clip'
  const realtimeMode = mode === 'realtime-mix' || realtimeClip
  const mixing = mode === 'realtime-mix' && mixPlaying
  const playbackTracks = useMemo(() => realtimeClip ? (selectedTrack ? [{ ...selectedTrack, muted: false }] : [])
    : mixTracks, [realtimeClip, selectedTrack, mixTracks])
  const mixEndTime = Math.max(0, ...playbackTracks.filter(track => !track.muted).map(mixEnd))
  const timelineDuration = lastEnd > MIN_TIMELINE_DURATION ? lastEnd * 1.1 : MIN_TIMELINE_DURATION
  // Leave room to reach the midpoint of a clip appended at the end during a drag.
  const duration = Math.max(timelineDuration, lastEnd + (dragging?.duration ?? 0) / 2)
  const visibleLength = duration / zoom
  const maxPan = duration - visibleLength
  const panThumbWidth = `min(100%, max(24px, ${100 / zoom}%))`
  const view = { start: clamp(pan, 0, maxPan), length: visibleLength }
  const mixBitrate = output.quality === 'native' ? 192 : output.bitrate
  const fingerprint = JSON.stringify({
    tracks: mixTracks.filter(track => !track.muted).map(renderTrackKey),
    format: output.format,
    bitrate: mixBitrate,
    sampleRate: settings.sampleRate,
    channels: settings.channels,
    name: settings.filenameTemplate,
  })
  const cachedMix = results.find(item => item.fingerprint === fingerprint)
  const selectedLocked = selectedTrack ? laneAppearance[selectedTrack.lane]?.locked === true : false
  const canSelectRange = tracks.some(track => !laneAppearance[track.lane]?.locked)
  const rangeFeedback = trimPreview?.range ?? keptRange
  const selectedAsset = library.find(asset => asset.media.id === selectedMedia)
  const playheadVisible = position >= view.start && position <= view.start + view.length
  const realtime = useRealtimePreview(liveAudio, {
    active: active && mode === 'live', effects: selectedTrack?.effects ?? NEUTRAL,
    start: selectedTrack?.start ?? 0, end: selectedTrack?.end ?? 0,
  })
  const lanes = [...new Set(tracks.map(track => track.lane))].sort((left, right) => left - right)
  const newLane = (lanes.at(-1) ?? -1) + 1
  lanes.push(newLane)

  const [unavailable, setUnavailable] = useState<{ paths: string[]; tracks: ProjectTrack[] }>({ paths: [], tracks: [] })
  const [workspaceReady, setWorkspaceReady] = useState(!projectId)
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const imported: ImportedMedia[] = []
    async function restore() {
      const draft = readDraft<MixProject>(projectId!, 'adjust')
      if (!draft) return
      if (draft.results?.length) {
        const files = await window.vdro.loadExtracted(projectId + ':adjust')
        if (cancelled) return
        const clips = new Map(files.map(clip => [clip.id, clip]))
        setResults(draft.results.flatMap(item => {
          const clip = clips.get(item.id)
          return clip ? [{ clip, fingerprint: item.fingerprint, offset: item.offset }] : []
        }))
      }
      const paths = new Set([...draft.paths, ...draft.tracks.map(track => track.path)])
      const assets = new Map<string, LibraryAsset>()
      const restored: Track[] = []
      for (const path of paths) {
        if (cancelled) return
        try {
          const media = await window.vdro.importPath(path)
          ownedMedia.current.add(media.id)
          imported.push(media)
          if (cancelled) return
          const stream = media.info.audioStreams.find(item => item.isDefault) ?? media.info.audioStreams[0]
          if (!stream) throw new Error('该文件没有音轨')
          assets.set(path, { media, audioStreamIndex: stream.index })
        } catch { /* The path is retained for recovery below. */ }
      }
      const waves = new Map<string, PeaksResult>()
      const failedPaths = new Set([...paths].filter(path => !assets.has(path)))
      for (const { path, ...item } of draft.tracks) {
        if (cancelled) return
        const asset = assets.get(path)
        if (!asset || failedPaths.has(path)) continue
        try {
          const key = asset.media.id + ':' + item.audioStreamIndex
          const waveform = waves.get(key) ?? await window.vdro.getPeaks(asset.media.id, item.audioStreamIndex)
          waves.set(key, waveform)
          restored.push({ ...asset, ...item, mediaId: asset.media.id, waveform })
        } catch { failedPaths.add(path) }
      }
      if (cancelled) return
      setUnavailable({ paths: [...failedPaths], tracks: draft.tracks.filter(track => failedPaths.has(track.path)) })
      setLibrary(draft.paths.flatMap(path => assets.get(path) && !failedPaths.has(path) ? [assets.get(path)!] : []))
      const validTracks = restored.filter(track => !failedPaths.has(track.media.filePath))
      restoreProject({ tracks: validTracks, laneAppearance: draft.laneAppearance })
      setSelected(draft.selected)
      if (failedPaths.size) setError(failedPaths.size + ' 个素材文件已失效，已从素材库跳过')
    }
    void restore().then(() => { if (!cancelled) setWorkspaceReady(true) }).catch(cause => {
      if (!cancelled) {
        reportProjectState(projectId!, 'adjust', 'error')
        setError(errorText(cause))
      }
    }).finally(() => {
      if (cancelled) for (const item of imported) void window.vdro.releaseMedia(item.id)
    })
    return () => { cancelled = true }
  }, [projectId, restoreProject])

  useEffect(() => {
    if (!projectId || !workspaceReady) return
    const draft: MixProject = {
      paths: [...library.map(asset => asset.media.filePath), ...unavailable.paths], laneAppearance, selected,
      results: results.map(({ clip, fingerprint, offset }) => ({ id: clip.id, fingerprint, offset })),
      tracks: tracks.map(({ media, mediaId, waveform, ...item }) => ({ ...item, path: media.filePath })).concat(unavailable.tracks),
    }
    try { saveDraft(projectId, 'adjust', draft) } catch { setError('无法保存项目，请重试。') }
  }, [projectId, workspaceReady, library, laneAppearance, tracks, selected, results, unavailable])

  useEffect(() => {
    if (!projectId || !workspaceReady) return
    void window.vdro.saveExtractedClips(results.map(item => item.clip), projectId + ':adjust')
      .catch(() => {
        reportProjectState(projectId, 'adjust', 'error')
        setError('无法保存项目，请重试。')
      })
  }, [projectId, workspaceReady, results])

  useEffect(() => setLibraryCollapsed(settings.sidebarCollapsed), [settings.sidebarCollapsed])

  useEffect(() => window.vdro.onAdjustmentProgress(event => {
    if (job.current === event.jobId) setProgress(event.progress)
  }), [])

  useEffect(() => {
    if (!active || mode !== 'mix') audio.current?.pause()
    if (!active || mode !== 'live') liveAudio.current?.pause()
    if (!active || mode !== 'original') originalAudio.current?.pause()
    if (!active || !realtimeMode) mix.current?.pause()
    if (!active) { playOnLoad.current = null; pendingPreview.current = null; dismissClipMenu() }
  }, [active, mode, realtimeMode, dismissClipMenu])

  useEffect(() => {
    const player = new RealtimeMix(setPosition, setMixPlaying, cause => setError(errorText(cause)))
    mix.current = player
    return () => { mix.current = null; player.dispose() }
  }, [])

  useEffect(() => {
    const waves = sourceWaves(playbackTracks)
    if (mixPlaying && playbackTracks.some(track => !track.muted && !waves.has(track.id))) {
      void startRealtimePlayback(realtimeClip ? 'realtime-clip' : 'realtime-mix', playbackTracks,
        playbackTracks.filter(track => !track.muted), position)
    } else {
      mix.current?.update(playbackTracks, waves)
    }
  }, [playbackTracks])

  useEffect(() => {
    setMixVolume(settings.previewMuted ? 0 : settings.previewVolume)
  }, [settings.previewMuted, settings.previewVolume])

  useEffect(() => mix.current?.setVolume(mixVolume / 100), [mixVolume])

  useEffect(() => {
    if (!removedAssets.current.size) return
    const retained = new Set([mixTimeline, ...past, ...future].flatMap(snapshot => snapshot.tracks.map(track => track.mediaId)))
    if (clipboard) retained.add(clipboard.mediaId)
    for (const id of removedAssets.current) {
      if (retained.has(id)) continue
      removedAssets.current.delete(id)
      releaseSource(id)
    }
  }, [library, mixTimeline, past, future, clipboard])

  useEffect(() => () => {
    if (job.current) void window.vdro.cancelAdjustment(job.current)
    for (const source of previewCache.current.values()) if (source.clip) void disposeClip(source.clip)
    previewCache.current.clear()
    for (const id of ownedMedia.current) void window.vdro.releaseMedia(id).catch(() => undefined)
    ownedMedia.current.clear()
  }, [])

  useEffect(() => {
    const beforeClear = (event: Event) => {
      if (working.current) event.preventDefault()
      else pausePreview()
    }
    const cleared = () => {
      previewCache.current.clear()
      setPreviewUrl('')
      setResult(null)
      setResults([])
      setSavedPath('')
      setMode('live')
    }
    const guardProject = (event: Event) => { if (working.current) event.preventDefault() }
    window.addEventListener('vdro:before-project-change', guardProject)
    window.addEventListener('vdro:before-clear-temp', beforeClear)
    window.addEventListener('vdro:temp-cleared', cleared)
    return () => {
      window.removeEventListener('vdro:before-project-change', guardProject)
      window.removeEventListener('vdro:before-clear-temp', beforeClear)
      window.removeEventListener('vdro:temp-cleared', cleared)
    }
  }, [])

  async function relinkAsset(path: string, choose: boolean) {
    if (working.current) return
    working.current = true
    setBusy('import')
    setError('')
    let media: ImportedMedia | null = null
    try {
      media = choose ? await window.vdro.openFile(settings.mediaDirectory) : await window.vdro.importPath(path)
      if (!media) return
      const stream = media.info.audioStreams.find(item => item.isDefault) ?? media.info.audioStreams[0]
      if (!stream) throw new Error('该文件没有音轨')
      const pending = unavailable.tracks.filter(track => track.path === path)
      if (pending.some(track => track.end > media!.info.duration + .001 ||
        (track.effects.fadeRange?.end ?? 0) > media!.info.duration + .001 ||
        track.effects.pitchPoints?.some(point => point.time > media!.info.duration + .001))) {
        throw new Error('替换素材时长不足，无法恢复原片段。')
      }
      if (pending.length + tracks.length > MAX_MIX_CLIPS) throw new Error('恢复后片段数量超出上限，请先移除部分片段。')
      if (pending.some(track => overlaps(tracks, track.lane, track.offset, track.offset + track.end - track.start))) {
        throw new Error('恢复位置已有片段，请先移开后重试。')
      }
      const waves = new Map<number, PeaksResult>()
      for (const track of pending) {
        const index = media.info.audioStreams.some(item => item.index === track.audioStreamIndex) ? track.audioStreamIndex : stream.index
        if (!waves.has(index)) waves.set(index, await window.vdro.getPeaks(media.id, index))
      }
      const asset = { media, audioStreamIndex: stream.index }
      const recovered = pending.map(({ path: _path, ...track }) => {
        const audioStreamIndex = asset.media.info.audioStreams.some(item => item.index === track.audioStreamIndex)
          ? track.audioStreamIndex : stream.index
        return { ...track, ...asset, audioStreamIndex, waveform: waves.get(audioStreamIndex)!, mediaId: asset.media.id }
      })
      pausePreview()
      ownedMedia.current.add(media.id)
      setLibrary(previous => previous.some(item => item.media.id === asset.media.id) ? previous : [...previous, asset])
      restoreProject({ tracks: [...tracks, ...recovered], laneAppearance })
      setUnavailable(previous => ({
        paths: previous.paths.filter(item => item !== path),
        tracks: previous.tracks.filter(item => item.path !== path),
      }))
      if (recovered.length) selectTrack(recovered[0])
      media = null
    } catch (cause) { setError(errorText(cause)) }
    finally {
      if (media) void window.vdro.releaseMedia(media.id).catch(() => undefined)
      working.current = false
      setBusy(null)
    }
  }

  async function importAssets(paths?: string[]) {
    if (!workspaceReady || working.current) return
    working.current = true
    setBusy('import')
    setError('')
    const imported: LibraryAsset[] = []
    const failed: string[] = []
    try {
      const files = paths ?? await window.vdro.pickMixTracks(settings.mediaDirectory)
      for (const file of files) {
        let media: ImportedMedia | undefined
        try {
          media = await window.vdro.importPath(file, projectId ?? '@session')
          ownedMedia.current.add(media.id)
          media = { ...media, fileName: media.fileName.replace(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i, '') }
          const stream = media.info.audioStreams.find(track => track.isDefault) ?? media.info.audioStreams[0]
          if (!stream) throw new Error('该文件没有音轨')
          if (media.info.duration < MIN_CLIP_DURATION) throw new Error('片段太短，至少需要 20ms')
          imported.push({ media, audioStreamIndex: stream.index })
        } catch (cause) {
          if (media) void window.vdro.releaseMedia(media.id).catch(() => undefined)
          failed.push(errorText(cause))
        }
      }
      if (imported.length) {
        setLibrary(previous => [...previous, ...imported])
        setSelectedMedia(imported[0].media.id)
      }
      if (failed.length) setError(failed[0])
      return imported[0]
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      working.current = false
      setBusy(null)
    }
  }

  useEffect(() => {
    if (!workspaceReady || !active || !incoming || busy || working.current || incoming.key === consumed.current) return
    consumed.current = incoming.key
    void importAssets([incoming.path]).then(asset => {
      if (asset) return placeAsset(asset, newLane, clamp(position, 0, MAX_MIX_OFFSET))
    })
  }, [workspaceReady, active, incoming, busy])

  function selectTrack(track?: Track) {
    setInspector('parameters')
    if (track?.id === selected) return
    if (realtimeClip) {
      mix.current?.pause()
      setMode('live')
    }
    liveAudio.current?.pause()
    originalAudio.current?.pause()
    pendingPreview.current = null
    setPreviewUrl(track ? findSource(track, true)?.url ?? '' : '')
    setSelected(track?.id ?? '')
    if (track) setSelectedMedia(track.mediaId)
    setMarker('')
  }

  function changeLane(lane: number, update: Partial<TrackAppearance>, group?: object) {
    if (working.current) return
    const current = laneAppearance[lane] ?? DEFAULT_TRACK_APPEARANCE
    const next = { ...current, ...update }
    if (next.name === current.name && next.ignored === current.ignored && next.locked === current.locked && next.muted === current.muted) return
    editTimeline({ tracks, laneAppearance: { ...laneAppearance, [lane]: next } }, group)
    if (update.ignored !== undefined || update.muted !== undefined) {
      audio.current?.pause()
      setSavedPath('')
    }
  }

  function addMarker(track: Track) {
    if (working.current || laneAppearance[track.lane]?.locked) return
    const { effects } = track
    const points = sortedPitchPoints(effects.pitchPoints)
    const time = clamp(Math.round((track.start + position - track.offset) * 100) / 100, track.start, track.end)
    const existing = points.find(point => Math.abs(point.time - time) < .01 - 1e-6)
    if (existing) { setMarker(existing.id); return }
    if (points.length >= 128) return
    const point = { id: crypto.randomUUID(), time, semitones: pitchAt(points, time, effects.semitones) }
    changeTrack(track.id, current => ({ ...current,
      effects: { ...current.effects, pitchPoints: sortedPitchPoints([...points, point]) },
    }))
    setMarker(point.id)
  }

  function selectAsset(asset: LibraryAsset) {
    const id = asset.media.id
    setSelectedMedia(id)
    if (selectedTrack?.mediaId !== id) selectTrack(tracks.find(track => track.mediaId === id))
  }

  function removeAsset(asset: LibraryAsset) {
    if (working.current) return
    const { id, fileName } = asset.media
    if (settings.confirmDelete && !window.confirm(translateUiText(`确定从素材栏移除“${fileName}”吗？源文件不会被删除。`, settings.language))) return
    removedAssets.current.add(id)
    setLibrary(previous => previous.filter(item => item.media.id !== id))
    if (selectedMedia === id) setSelectedMedia('')
  }

  async function placeAsset(asset: LibraryAsset, lane: number, offset: number) {
    if (working.current) return
    if (laneAppearance[lane]?.locked) {
      setError('轨道已锁定。')
      return
    }
    if (tracks.length >= MAX_MIX_CLIPS) {
      setError(`最多可添加 ${MAX_MIX_CLIPS} 条混音片段`)
      return
    }
    const { media, audioStreamIndex } = asset
    if (overlaps(tracks, lane, offset, offset + media.info.duration)) {
      setError('该位置与同一轨道上的片段重叠。')
      return
    }
    working.current = true
    setBusy('place')
    setError('')
    try {
      const waveform = tracks.find(track => track.mediaId === media.id)?.waveform ??
        await window.vdro.getPeaks(media.id, audioStreamIndex)
      const track: Track = {
        ...asset, id: crypto.randomUUID(), lane, mediaId: media.id, waveform, offset,
        start: 0, end: media.info.duration, effects: defaultAdjustment(settings), muted: false,
      }
      if (mixPlaying) await prepareSource(track)
      audio.current?.pause()
      editTimeline({ tracks: [...tracks, track], laneAppearance })
      selectTrack(track)
      setSavedPath('')
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      working.current = false
      setBusy(null)
    }
  }

  function changeTrack(id: string, change: (track: Track) => Track, group?: object) {
    if (working.current) return false
    const track = tracks.find(item => item.id === id)
    if (!track || laneAppearance[track.lane]?.locked) return false
    const next = change(track)
    if (laneAppearance[next.lane]?.locked || next.offset < 0 || next.offset > MAX_MIX_OFFSET) return false
    if (overlaps(tracks, next.lane, next.offset, mixEnd(next), id)) {
      setError('该位置与同一轨道上的片段重叠。')
      return false
    }
    if (next.lane === track.lane && next.offset === track.offset && next.start === track.start && next.end === track.end &&
      next.muted === track.muted && next.reversed === track.reversed &&
      (next.effects === track.effects || JSON.stringify(next.effects) === JSON.stringify(track.effects))) return true
    audio.current?.pause()
    setError('')
    setSavedPath('')
    const updated = tracks.map(item => item.id === id ? next : item)
    editTimeline({ tracks: updated, laneAppearance: appearanceAfterEdit(updated, track.lane) }, group)
    return true
  }

  function appearanceAfterEdit(updated: Track[], lane: number) {
    if (!laneAppearance[lane] || updated.some(track => track.lane === lane)) return laneAppearance
    const next = { ...laneAppearance }
    delete next[lane]
    return next
  }

  function removeTrack(id: string) {
    if (working.current) return false
    const track = tracks.find(item => item.id === id)
    if (!track || laneAppearance[track.lane]?.locked) return false
    if (settings.confirmDelete && !window.confirm(translateUiText('确定移除这个片段吗？', settings.language))) return false
    audio.current?.pause()
    const remaining = tracks.filter(item => item.id !== id)
    editTimeline({ tracks: remaining, laneAppearance: appearanceAfterEdit(remaining, track.lane) })
    if (selected === id) selectTrack(remaining[0])
    setError('')
    setSavedPath('')
    return true
  }

  function reverseTrack(track: Track) {
    const length = track.media.info.duration
    const pitchPoints = track.effects.pitchPoints?.map(point => ({ ...point, time: length - point.time })).reverse()
    const fadeRange = track.effects.fadeRange
    const next = { ...track, reversed: !track.reversed, start: length - track.end, end: length - track.start,
      effects: { ...track.effects, pitchPoints,
        fadeRange: fadeRange ? { start: length - fadeRange.end, end: length - fadeRange.start } : undefined,
        fadeIn: track.effects.fadeOut, fadeOut: track.effects.fadeIn,
      },
    }
    if (!changeTrack(track.id, () => next)) return
    if (mode === 'live' && track.id === selected && liveAudio.current && !liveAudio.current.paused) {
      void startRealtimePlayback('realtime-clip', [{ ...next, muted: false }], [next], clipPlaybackPosition(next))
    }
  }

  function runClipAction(action: ClipMenuAction, track: Track) {
    dismissClipMenu()
    if (working.current) return
    if (action === 'copy') setClipboard(track)
    else if (action === 'cut') { if (removeTrack(track.id)) setClipboard(track) }
    else if (action === 'reverse') reverseTrack(track)
    else removeTrack(track.id)
  }

  async function pasteTrack() {
    if (!clipboard || working.current) return
    dismissClipMenu()
    if (tracks.length >= MAX_MIX_CLIPS) {
      setError(`最多可添加 ${MAX_MIX_CLIPS} 条混音片段`)
      return
    }
    const offset = clamp(position, 0, MAX_MIX_OFFSET)
    const desiredLane = selectedTrack?.lane ?? clipboard.lane
    const lane = laneAppearance[desiredLane]?.locked || overlaps(tracks, desiredLane, offset, offset + clipboard.end - clipboard.start)
      ? newLane : desiredLane
    const next = { ...clipboard, id: crypto.randomUUID(), lane, offset }
    working.current = true
    try {
      if (mixing && !findSource(next)) {
        setBusy('prepare')
        await prepareSource(next)
      }
      if (!activePage.current) return
      audio.current?.pause()
      editTimeline({ tracks: [...tracks, next], laneAppearance })
      selectTrack(next)
      setSavedPath('')
      setError('')
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      working.current = false
      setBusy(null)
    }
  }

  const menuTrack = clipMenu && tracks.find(track => track.id === clipMenu.id)
  useEffect(() => {
    if (!active) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.metaKey || event.shiftKey ||
        (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]')) ||
        document.querySelector('.settings-dialog')) return
      const key = event.key.toLowerCase()
      if (event.ctrlKey && key === 'v' && clipboard) {
        event.preventDefault()
        void pasteTrack()
        return
      }
      const track = menuTrack ?? selectedTrack
      const action = event.ctrlKey ? (key === 'c' ? 'copy' : key === 'x' ? 'cut' : undefined)
        : key === 'delete' ? 'delete' : undefined
      if (!track || !action) return
      event.preventDefault()
      runClipAction(action, track)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function restoreTimeline(restore: () => MixTimeline | undefined) {
    if (working.current) return
    const next = restore()
    if (!next) return
    audio.current?.pause()
    playOnLoad.current = null
    setError('')
    setSavedPath('')
    setTrimPreview(null)
    setKeptRange(null)
    if (mixPlaying && next.tracks.some(track => !track.muted && !next.laneAppearance[track.lane]?.ignored &&
      !next.laneAppearance[track.lane]?.muted && !findSource(track))) mix.current?.pause()

    const target = next.tracks.find(track => !tracks.some(previous => previous.id === track.id)) ??
      next.tracks.find(track => track.id === selected) ?? next.tracks[0]
    if (target?.id !== selectedTrack?.id) selectTrack(target)
    else if (marker && !target?.effects.pitchPoints?.some(point => point.id === marker)) setMarker('')
  }

  useTimelineHistoryShortcuts(active && !busy, () => restoreTimeline(undo), () => restoreTimeline(redo))

  function seekTimeline(event: MouseEvent<HTMLDivElement>) {
    if (event.detail === 0) return
    const time = timeAt(event.clientX, event.currentTarget.getBoundingClientRect(), view)
    seek(time)
  }

  function seek(time: number) {
    setPosition(time)
    if (realtimeMode) {
      if (mixPlaying) void mix.current?.play(time)
      return
    }
    const player = mode === 'live' ? liveAudio.current : originalAudio.current
    if (mode !== 'mix' && player?.readyState && selectedTrack && previewUrl) {
      const { start, end } = orientedRange(selectedTrack, mode === 'original')
      player.currentTime = clamp(start + time - selectedTrack.offset, start, end)
    } else if (mode === 'mix' && result?.fingerprint === fingerprint && audio.current?.readyState) {
      audio.current.currentTime = Math.min(result.clip.duration, time)
    }
  }

  function startPlayheadDrag(): PlayheadDrag | undefined {
    const width = timeline.current?.getBoundingClientRect().width ?? 0
    if (working.current || !width) return
    const player = realtimeMode ? null : mode === 'live' ? liveAudio.current
      : mode === 'original' ? originalAudio.current : audio.current
    const preview = mode === 'mix' ? result && { offset: result.offset, start: 0, end: result.clip.duration }
      : selectedTrack && { ...orientedRange(selectedTrack, mode === 'original'), offset: selectedTrack.offset }
    const resumeMix = realtimeMode && mixPlaying
    const resumePlayer = player && !player.paused
    let target = position
    scrubbing.current = true
    if (resumeMix) mix.current?.pause()
    player?.pause()
    return {
      move: deltaX => {
        target = clamp(position + deltaX * view.length / width, view.start, view.start + view.length)
        setPosition(target)
      },
      finish: resume => {
        scrubbing.current = false
        if (!resume || !activePage.current) return
        setPosition(target)
        if (resumeMix && target < mixEndTime) void mix.current?.play(target)
        if (!player?.readyState || !preview) return
        const time = preview.start + target - preview.offset
        if (time < preview.start || time > preview.end) return
        player.currentTime = time
        if (resumePlayer && time < preview.end) void player.play().catch(cause => setError(errorText(cause)))
      },
    }
  }

  function changeZoom(factor: number) {
    const next = clamp(factor, 1, MAX_TIMELINE_ZOOM)
    const length = duration / next
    const anchor = playheadVisible ? position : view.start + view.length / 2
    const share = clamp((anchor - view.start) / view.length, 0, 1)
    setZoom(next)
    setPan(clamp(anchor - share * length, 0, duration - length))
  }

  function movePanThumb(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = panDrag.current
    if (drag?.pointerId !== event.pointerId) return
    setPan(clamp(drag.start + (event.clientX - drag.clientX) * drag.secondsPerPixel, 0, maxPan))
  }

  function trimBounds(track: Track, first: number, last: number, edge?: TrimEdge, allowSnap = true): TrimRange {
    const end = mixEnd(track)
    const others = tracks.filter(other => other.id !== track.id)
    const lane = others.filter(other => other.lane === track.lane)
    const earliest = Math.max(0, track.offset - track.start,
      ...lane.filter(other => mixEnd(other) <= track.offset + 1e-6).map(mixEnd))
    const latest = Math.min(track.offset + track.media.info.duration - track.start,
      ...lane.filter(other => other.offset >= end - 1e-6).map(other => other.offset))
    const anchors = [
      position,
      ...others.flatMap(other => [other.offset, mixEnd(other)]),
      ...(track.effects.pitchPoints ?? []).map(point => track.offset + point.time - track.start),
    ]
    const tolerance = settings.adjustmentSnapDistance * view.length / Math.max(1, timeline.current?.clientWidth ?? 0)
    let guide: number | undefined
    function nearest(time: number, min: number, max: number) {
      const clamped = clamp(time, min, max)
      if (!snap || !allowSnap) return clamped
      const target = anchors.reduce((best, anchor) =>
        anchor >= min - 1e-6 && anchor <= max + 1e-6 && Math.abs(anchor - time) < Math.abs(best - time) ? anchor : best, Infinity)
      if (Math.abs(target - time) > tolerance) return clamped
      guide = target
      return clamp(target, min, max)
    }
    const from = edge === 'end' ? track.offset : nearest(first,
      edge === 'start' ? earliest : track.offset, end - MIN_CLIP_DURATION)
    const to = edge === 'start' ? end : nearest(last,
      from + MIN_CLIP_DURATION, edge === 'end' ? latest : end)
    return { from, to, guide }
  }

  function trimTrack(track: Track, { from, to }: TrimRange) {
    const start = clamp(track.start + from - track.offset, 0, track.media.info.duration)
    const end = clamp(track.start + to - track.offset, start, track.media.info.duration)
    if (end - start < MIN_CLIP_DURATION - 1e-6) return
    const fadeIn = Math.min(track.effects.fadeIn, end - start)
    const fadeOut = Math.min(track.effects.fadeOut, end - start - fadeIn)
    const applied = changeTrack(track.id, current => ({ ...current, start, end, offset: from,
      effects: { ...current.effects, fadeIn, fadeOut, fadeRange: undefined } }))
    if (!applied) return
    if (selectRange) setKeptRange({ from, to })
    selectTrack(track)
  }

  function splitTrack(track: Track, time: number) {
    if (working.current || laneAppearance[track.lane]?.locked || !canSplitAt(track, time)) return
    if (tracks.length >= MAX_MIX_CLIPS) {
      setError(`最多可添加 ${MAX_MIX_CLIPS} 条混音片段`)
      return
    }
    const cut = track.start + time - track.offset
    const effects = { ...track.effects, fadeRange: fadeBounds(track.effects, track.start, track.end) }
    const left: Track = { ...track, end: cut, effects }
    const right: Track = { ...track, id: crypto.randomUUID(), start: cut, offset: time, effects }
    audio.current?.pause()
    playOnLoad.current = null
    setError('')
    setSavedPath('')
    editTimeline({ tracks: tracks.flatMap(item => item.id === track.id ? [left, right] : [item]), laneAppearance })
    selectTrack(right)
    setPosition(time)
  }

  function getDropPlacement(event: DragEvent<HTMLDivElement>, lane: number, source: DragSource, dropView = view): DropPlacement {
    const bounds = event.currentTarget.getBoundingClientRect()
    const moving = 'track' in source ? source.track : undefined
    const span = dragDuration(source)
    const time = clamp(timeAt(event.clientX, bounds, dropView) - span / 2, 0, MAX_MIX_OFFSET)
    const start = Math.round(time * 100) / 100
    let placement: DropPlacement = { start, end: start + span }
    if (!snap) return placement

    const tolerance = settings.adjustmentSnapDistance * dropView.length / Math.max(1, bounds.width)
    const anchors = [position, 0, ...tracks.filter(track => track.id !== moving?.id)
      .flatMap(track => [track.offset, mixEnd(track)])]
    let closestDistance = Infinity
    for (const guide of anchors) {
      for (const candidate of [guide, guide - span]) {
        if (candidate < -1e-6 || candidate > MAX_MIX_OFFSET + 1e-6) continue
        const alignedStart = clamp(candidate, 0, MAX_MIX_OFFSET)
        const distance = Math.abs(alignedStart - time)
        if (distance > tolerance || distance >= closestDistance) continue
        const end = alignedStart + span
        if (overlaps(tracks, lane, alignedStart, end, moving?.id)) continue
        placement = { start: alignedStart, end, guide }
        closestDistance = distance
      }
    }
    return placement
  }

  function startTimelineDrag(event: DragEvent<HTMLElement>, source: DragSource) {
    const element = event.currentTarget
    const bounds = element.getBoundingClientRect()
    event.dataTransfer.setDragImage(element, Math.round(bounds.width / 2), Math.round(clamp(event.clientY - bounds.top, 0, bounds.height)))
    dragSource.current = source
    setDragging({ clipId: 'track' in source ? source.track.id : undefined, duration: dragDuration(source) })
  }

  function clearDropTarget() {
    dragSource.current = null
    setDropTarget(null)
    setDragging(null)
  }

  function previewDrop(event: DragEvent<HTMLDivElement>, lane: number) {
    const source = dragSource.current
    if (!source || !event.dataTransfer.types.includes('track' in source ? MIX_CLIP_TYPE : MIX_ASSET_TYPE)) return
    event.preventDefault()
    const moving = 'track' in source ? source.track : undefined
    const bounds = event.currentTarget.getBoundingClientRect()
    let dropView = view
    if (zoom > 1 && !working.current) {
      const margin = Math.min(20, bounds.width / 8)
      const direction = event.clientX > bounds.right - margin ? 1 : event.clientX < bounds.left + margin ? -1 : 0
      const start = clamp(view.start + direction * view.length / 24, 0, maxPan)
      if (start !== view.start) {
        setPan(start)
        dropView = { ...view, start }
      }
    }
    const placement = getDropPlacement(event, lane, source, dropView)
    if (working.current || laneAppearance[lane]?.locked || (!moving && tracks.length >= MAX_MIX_CLIPS) ||
      overlaps(tracks, lane, placement.start, placement.end, moving?.id)) {
      event.dataTransfer.dropEffect = 'none'
      setDropTarget(null)
      return
    }
    event.dataTransfer.dropEffect = moving ? 'move' : 'copy'
    setDropTarget(current => current?.lane === lane && current.pointerX === event.clientX &&
      current.start === placement.start && current.end === placement.end && current.guide === placement.guide
      ? current : { lane, pointerX: event.clientX, ...placement })
  }

  function dropOnLane(event: DragEvent<HTMLDivElement>, lane: number) {
    const source = dragSource.current
    if (!source) return
    event.preventDefault()
    event.stopPropagation()
    const offset = dropTarget?.lane === lane && dropTarget.pointerX === event.clientX
      ? dropTarget.start : getDropPlacement(event, lane, source).start
    clearDropTarget()
    if ('track' in source) {
      if (event.dataTransfer.getData(MIX_CLIP_TYPE) === source.track.id) {
        changeTrack(source.track.id, current => ({ ...current, lane, offset }))
      }
    } else if (event.dataTransfer.getData(MIX_ASSET_TYPE) === source.asset.media.id) {
      void placeAsset(source.asset, lane, offset)
    }
  }

  async function runRender(request: (jobId: string) => Promise<ExtractedClip>) {
    const jobId = crypto.randomUUID()
    job.current = jobId
    setProgress(0)
    try {
      return await request(jobId)
    } finally {
      job.current = null
    }
  }

  function pausePreview() {
    mix.current?.pause()
    audio.current?.pause()
    liveAudio.current?.pause()
    originalAudio.current?.pause()
    pendingPreview.current = null
    playOnLoad.current = null
  }

  function findSource(track: Track, full = false) {
    const range = orientedRange(track, true)
    return [...previewCache.current.values()].find(source => source.mediaId === track.mediaId &&
      source.start <= (full ? 0 : range.start) && source.end >= (full ? track.media.info.duration : range.end))
  }

  function sourceWaves(playing: Track[]) {
    const waves = new Map<string, PreviewWave>()
    for (const track of playing) {
      const source = findSource(track)
      if (!source) continue
      const { wave } = source
      // Translate source-time frames to frames in the decoded excerpt, in either playback direction.
      const origin = Math.round((track.reversed ? track.media.info.duration - source.end : source.start) * wave.sampleRate)
      waves.set(track.id, origin === 0 ? wave : {
        sampleRate: wave.sampleRate, frames: origin + wave.frames,
        blockStart: frame => origin + wave.blockStart(Math.max(0, frame - origin)),
        readBlock: (context, first, reversed) => wave.readBlock(context, first - origin, reversed),
      })
    }
    return waves
  }

  function releaseSource(id: string) {
    ownedMedia.current.delete(id)
    for (const [key, source] of previewCache.current) {
      if (source.mediaId !== id) continue
      previewCache.current.delete(key)
      if (source.clip) void disposeClip(source.clip)
    }
    void window.vdro.releaseMedia(id).catch(() => undefined)
  }

  async function prepareSource(track: Track, full = false) {
    const cached = findSource(track, full)
    if (cached) return cached
    const { media } = track
    const audioStream = media.info.audioStreams.find(stream => stream.index === track.audioStreamIndex)
    if (media.info.audioStreams.length === 1 && audioStream?.codec === 'pcm_s16le') {
      const wave = await openPreviewWave(media.url).catch(() => null)
      if (wave) {
        const source = { mediaId: media.id, start: 0, end: media.info.duration, url: media.url, wave }
        previewCache.current.set(track.mediaId, source)
        return source
      }
    }
    const range = full ? { start: 0, end: media.info.duration } : orientedRange(track, true)
    const clip = await runRender(jobId => window.vdro.renderAdjustment({
      jobId, mediaId: track.mediaId, audioStreamIndex: track.audioStreamIndex, ...range,
      format: 'wav', bitrate: 192, channels: audioStream?.channels === 1 ? 1 : 2, sampleRate: 48000, effects: NEUTRAL,
    }))
    try {
      const wave = await openPreviewWave(clip.url)
      if (!wave) throw new Error('无法读取混音试听素材。')
      const source = { mediaId: media.id, ...range, url: clip.url, wave, clip }
      previewCache.current.set(clip.id, source)
      return source
    } catch (cause) {
      void disposeClip(clip)
      throw cause
    }
  }

  async function startRealtimePlayback(nextMode: RealtimeMode, playingTracks: Track[], prepareTracks: Track[], time: number) {
    const player = mix.current
    if (!player || working.current) return
    pausePreview()
    setMode(nextMode)
    setError('')
    working.current = true
    setBusy('prepare')
    try {
      await player.activate()
      for (const track of prepareTracks) {
        if (!activePage.current) return
        await prepareSource(track)
      }
      if (!activePage.current || mix.current !== player) return
      if (nextMode === 'realtime-clip' && selectedId.current !== playingTracks[0]?.id) return
      player.update(playingTracks, sourceWaves(playingTracks))
      await player.play(time)
    } catch (cause) {
      const message = errorText(cause)
      if (message !== 'CANCELLED') setError(message)
    } finally {
      working.current = false
      setBusy(null)
    }
  }

  function toggleMix() {
    if (mixing) { mix.current?.pause(); return }
    if (audibleTracks.length) void startRealtimePlayback('realtime-mix', mixTracks, mixTracks.filter(track => !track.muted), position)
  }

  function clipPlaybackPosition(track: Track) {
    return position >= track.offset && position < mixEnd(track) ? position : track.offset
  }

  function playGenerated(output: RenderedOutput, time: number) {
    pausePreview()
    const player = audio.current
    const start = time < 0 || time >= output.clip.duration ? 0 : time
    setMode('mix')
    setResult(output)
    if (player?.currentSrc === output.clip.url && player.readyState) {
      if (player.currentTime !== start) player.currentTime = start
      void player.play().catch(() => undefined)
    } else {
      playOnLoad.current = { id: output.clip.id, time: start }
    }
  }

  async function renderOutput(single = false) {
    const track = single ? selectedTrack : undefined
    if (working.current || (single ? !track : !audibleTracks.length)) return
    working.current = true
    pausePreview()
    setError('')
    try {
      const encoding = { format: output.format, bitrate: track ? output.bitrate : mixBitrate, sampleRate: settings.sampleRate, channels: settings.channels }
      const key = track ? JSON.stringify({
        ...renderTrackKey(track), encoding, name: settings.filenameTemplate,
      }) : fingerprint
      let generated = track ? results.find(item => item.fingerprint === key) : cachedMix
      if (!generated) {
        setBusy('render')
        const clip = await runRender(jobId => track
          ? window.vdro.renderAdjustment({
            ...encoding, jobId, mediaId: track.mediaId, audioStreamIndex: track.audioStreamIndex,
            start: track.start, end: track.end, effects: track.effects, reversed: track.reversed,
          })
          : window.vdro.renderMix({ ...encoding, jobId, tracks: audibleTracks }))
        generated = { clip, fingerprint: key, offset: track?.offset ?? 0 }
        const entry = generated
        setResults(previous => [entry, ...previous])
      }
      setMode('mix')
      setResult(generated)
      if (single) setInspector('results')
      await saveResult(generated)
    } catch (cause) {
      const message = errorText(cause)
      if (message !== 'CANCELLED') setError(message)
    } finally {
      working.current = false
      setBusy(null)
    }
  }

  async function saveResult(output: RenderedOutput) {
    setBusy('save')
    const saved = await window.vdro.saveExtracted(output.clip.filePath, output.clip.fileName)
    if (!saved.canceled) setSavedPath(saved.filePath ?? '')
  }

  async function manageResult(output: RenderedOutput, remove: boolean) {
    if (working.current) return
    if (remove && settings.confirmDelete &&
      !window.confirm(translateUiText(`确定删除已提取音频“${output.clip.fileName}”吗？`, settings.language))) return
    working.current = true
    try {
      if (!remove) {
        await saveResult(output)
        return
      }
      if (output === result) { pausePreview(); setResult(null) }
      await window.vdro.deleteExtracted(output.clip.id, output.clip.filePath)
      setResults(previous => previous.filter(item => item !== output))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      working.current = false
      setBusy(null)
    }
  }

  async function audition(kind: 'live' | 'original') {
    const track = selectedTrack
    if (!track || working.current || (kind === 'live' && (!realtime.ready || realtime.error))) return
    if (kind === 'live' && (track.reversed || realtimeClip)) {
      if (realtimeClip && mixPlaying) { mix.current?.pause(); return }
      await startRealtimePlayback('realtime-clip', [{ ...track, muted: false }], [track], clipPlaybackPosition(track))
      return
    }
    pausePreview()
    setError('')
    const { start } = orientedRange(track, kind === 'original')
    const time = start + clipPlaybackPosition(track) - track.offset
    pendingPreview.current = { id: track.id, mode: kind, time }
    setMode(kind)
    if (previewUrl) {
      const player = kind === 'live' ? liveAudio.current : originalAudio.current
      if (player) applyClipPreview(kind, player)
      return
    }
    working.current = true
    setBusy('prepare')
    try {
      const source = await prepareSource(track, true)
      setPreviewUrl(source.url)
    } catch (cause) {
      pendingPreview.current = null
      const message = errorText(cause)
      if (message !== 'CANCELLED') setError(message)
    } finally {
      working.current = false
      setBusy(null)
    }
  }

  function applyClipPreview(kind: 'live' | 'original', player: HTMLAudioElement) {
    const pending = pendingPreview.current
    if (!active || !pending || pending.mode !== kind || pending.id !== selectedTrack?.id ||
      player.currentSrc !== previewUrl || !player.readyState) return
    pendingPreview.current = null
    if (player.currentTime !== pending.time) player.currentTime = pending.time
    void player.play().catch(() => undefined)
  }

  useEffect(() => {
    const player = mode === 'live' ? liveAudio.current : mode === 'original' ? originalAudio.current : null
    if (player && (mode === 'live' || mode === 'original')) applyClipPreview(mode, player)
  }, [active, mode, previewUrl, selectedTrack?.id])

  function clipPlayerProps(kind: 'live' | 'original') {
    return {
      controls: true,
      preload: 'metadata' as const,
      src: previewUrl,
      hidden: mode !== kind || !previewUrl,
      onLoadedMetadata: (event: SyntheticEvent<HTMLAudioElement>) => applyClipPreview(kind, event.currentTarget),
      onPlay: (event: SyntheticEvent<HTMLAudioElement>) => {
        const player = event.currentTarget
        if (!active || mode !== kind || !selectedTrack || (kind === 'live' && (!realtime.ready || realtime.error))) {
          player.pause()
        } else {
          const { start, end } = orientedRange(selectedTrack, kind === 'original')
          if (player.currentTime < start || player.currentTime >= end) player.currentTime = start
        }
      },
      onTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) => {
        if (scrubbing.current || mode !== kind || !selectedTrack || !previewUrl) return
        const player = event.currentTarget
        const { start, end } = orientedRange(selectedTrack, kind === 'original')
        if (!player.paused && player.currentTime >= end) {
          player.pause()
          player.currentTime = end
        }
        setPosition(selectedTrack.offset + clamp(player.currentTime, start, end) - start)
      },
    }
  }

  const snapGuide = dropTarget?.guide ?? trimPreview?.range.guide

  return <main className="adjustment-workspace adjustment-desk mix-workspace"
    onDragOver={event => event.preventDefault()} onDrop={event => {
      event.preventDefault()
      event.stopPropagation()
      const paths = Array.from(event.dataTransfer.files, file => window.vdro.getPathForFile(file)).filter(Boolean)
      if (active && paths.length) void importAssets(paths)
    }}>
    <div className={`clip-tools adjustment-library mix-library${libraryCollapsed ? ' is-collapsed' : ''}`}>
      <MediaLibrary items={library.map(asset => asset.media)} collapsed={libraryCollapsed}
        onImport={() => void importAssets()} importDisabled={!!busy || !workspaceReady}
        onToggle={() => setLibraryCollapsed(value => !value)}>
        {!libraryCollapsed && <MissingMediaList paths={unavailable.paths} disabled={!!busy}
          onRelink={(path, choose) => void relinkAsset(path, choose)}/>}
        {library.map(asset => <MediaLibraryItem key={asset.media.id} item={asset.media} selected={asset === selectedAsset}
          collapsed={libraryCollapsed} removalDisabled={!!busy}
          onSelect={() => selectAsset(asset)} onRemove={() => removeAsset(asset)}
          onDragStart={event => {
            if (working.current || tracks.length >= MAX_MIX_CLIPS) {
              event.preventDefault()
              return
            }
            startTimelineDrag(event, { asset })
            event.dataTransfer.setData(MIX_ASSET_TYPE, asset.media.id)
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onDragEnd={clearDropTarget}/>)}
      </MediaLibrary>
    </div>
    <section inert={!workspaceReady} className="adjustment-editor adjustment-timeline mix-editor">
      <header className="adjustment-heading">
        <div className="timeline-tool-row">
          <TimelineToolPicker tool={timelineTool} shortcuts={settings.shortcuts} onChange={changeTimelineTool} />
          <TimelineEditControls
            canUndo={!busy && past.length > 0}
            canRedo={!busy && future.length > 0}
            canDelete={!busy && !!selectedTrack && !selectedLocked}
            canAddMarker={!busy && !!selectedTrack && !selectedLocked && (selectedTrack.effects.pitchPoints?.length ?? 0) < 128}
            deleteLabel="移除片段"
            onUndo={() => restoreTimeline(undo)}
            onRedo={() => restoreTimeline(redo)}
            onDelete={() => { if (selectedTrack) removeTrack(selectedTrack.id) }}
            onAddMarker={() => { if (selectedTrack) addMarker(selectedTrack) }}
          >
            <TimelineEditButton action="reverse" disabled={!!busy || !selectedTrack || selectedLocked}
              pressed={!!selectedTrack?.reversed} onClick={() => { if (selectedTrack) reverseTrack(selectedTrack) }} />
          </TimelineEditControls>
          {selectedAsset && <button className="btn btn-ghost btn-small" type="button"
            disabled={!!busy || tracks.length >= MAX_MIX_CLIPS}
            onClick={() => void placeAsset(selectedAsset, newLane, Math.min(position, duration, MAX_MIX_OFFSET))}>添加到时间线</button>}
        </div>
        <div className="adjustment-wave-toolbar">
          <div>
            <button className={`btn btn-small ${selectRange ? 'btn-primary' : 'btn-ghost'} mix-range-toggle`} type="button"
              aria-pressed={selectRange} aria-describedby={selectRange ? 'mix-range-status' : undefined}
              disabled={!!busy || (!selectRange && !canSelectRange)} onClick={() => {
                setTimelineTool('select')
                setTrimPreview(null)
                setKeptRange(null)
                setSelectRange(current => !current)
              }}>框选片段</button>
            <button className="timeline-icon-btn mix-snap-toggle" type="button" title="吸附对齐" aria-label="吸附对齐"
              aria-pressed={snap} onClick={() => setSnap(current => !current)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 13a9 9 0 0 1 18 0v7h-5v-7a4 4 0 0 0-8 0v7H3v-7ZM3 16h5m8 0h5" />
              </svg>
            </button>
          </div>
          <WaveformZoomControls
            factor={zoom}
            canZoomIn={zoom < MAX_TIMELINE_ZOOM}
            canZoomOut={zoom > 1}
            onZoomIn={() => changeZoom(zoom * 1.5)}
            onZoomOut={() => changeZoom(zoom / 1.5)}
            onReset={() => changeZoom(1)}
          />
        </div>
      </header>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {realtime.error && <p className="settings-hint" role="status">{realtime.error}</p>}
      {selectRange && <p className="mix-range-status" id="mix-range-status">
        {rangeFeedback ? <>
          <strong>{trimPreview ? '将保留' : '已保留'}</strong>
          <span>{seconds(rangeFeedback.from)} – {seconds(rangeFeedback.to)}</span>
          <span>({seconds(rangeFeedback.to - rangeFeedback.from)})</span>
        </> : '在波形上按住左键框选，松开后保留框内音频。'}
      </p>}
      <div className="mix-tracks" id="mix-timeline" data-range-select={selectRange} data-placing={!!dragging} data-timeline-tool={timelineTool}>
        <div className="mix-track-grid">
        <div className="adjustment-track-row adjustment-ruler-row" aria-hidden="true">
          <time className="adjustment-timecode">{formatTime(Math.min(position, duration))}</time>
          <div ref={timeline} className="mix-ruler adjustment-ruler">{[0, .25, .5, .75, 1].map(tick => <span key={tick}>{seconds(view.start + tick * view.length)}</span>)}</div>
        </div>
        <div className="mix-lanes">
          {lanes.map((lane, index) => {
            const row = tracks.filter(track => track.lane === lane)
            const appearance = laneAppearance[lane] ?? DEFAULT_TRACK_APPEARANCE
            const selectedLane = selectedTrack?.lane === lane
            return <div className="adjustment-track-row" key={lane}>
              {row.length > 0 ? <AdjustmentTrackHeader {...appearance} defaultName={`轨道 ${index + 1}`}
                selected={selectedLane} disabled={!!busy}
                onIgnore={() => changeLane(lane, { ignored: !appearance.ignored })}
                onLock={() => changeLane(lane, { locked: !appearance.locked })}
                onMute={() => changeLane(lane, { muted: !appearance.muted })}
                onName={(name, group) => changeLane(lane, { name }, group)}
                onSelect={() => { if (!selectedLane) selectTrack(row[0]) }}/>
                : <span className="adjustment-empty-track">新轨道</span>}
              <div className={`mix-track mix-track-wave${lane === newLane ? ' mix-drop-lane' : ''}`}
                data-locked={appearance.locked} data-ignored={appearance.ignored} data-muted={appearance.muted}
                onClick={timelineTool === 'select' ? seekTimeline : undefined}
                onDragOver={event => previewDrop(event, lane)} onDrop={event => dropOnLane(event, lane)}
                onDragLeave={event => {
                  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null)
                }}>
                {row.filter(track => track.id === dragging?.clipId ||
                  (mixEnd(track) > view.start && track.offset < view.start + view.length)).map(track =>
                  <TrackWave key={track.id} track={track} view={view} selected={track === selectedTrack} marker={marker}
                    editable={!appearance.locked && !busy} selectRange={selectRange}
                    movable={timelineTool === 'select' && !selectRange && !appearance.locked && !busy}
                    splitMode={timelineTool === 'split'}
                    playhead={position} onSplit={time => splitTrack(track, time)} onClick={() => selectTrack(track)}
                    onMarker={id => { selectTrack(track); setMarker(id) }}
                    onContextMenu={event => {
                      event.preventDefault()
                      if (working.current) return
                      selectTrack(track)
                      const bounds = event.currentTarget.getBoundingClientRect()
                      setClipMenu({ id: track.id, x: event.clientX || bounds.left, y: event.clientY || bounds.top })
                    }}
                    constrainTrim={(first, last, edge, allowSnap) => trimBounds(track, first, last, edge, allowSnap)}
                    onPreview={range => setTrimPreview(range ? { lane, range } : null)}
                    onTrim={range => trimTrack(track, range)}
                    onDragStart={event => {
                      if (working.current || selectRange || appearance.locked) { event.preventDefault(); return }
                      startTimelineDrag(event, { track })
                      event.dataTransfer.setData(MIX_CLIP_TYPE, track.id)
                      event.dataTransfer.effectAllowed = 'move'
                      selectTrack(track)
                    }} onDragEnd={clearDropTarget}/>)}
                {row.filter(track => track.offset > view.start && track.offset < view.start + view.length &&
                  row.some(previous => previous !== track && previous.mediaId === track.mediaId &&
                    Math.abs(mixEnd(previous) - track.offset) < 1e-6 && Math.abs(previous.end - track.start) < 1e-6))
                  .map(track => <span key={'cut-' + track.id} className="timeline-cut-line" aria-hidden="true"
                    style={{ left: percent(track.offset, view) }} />)}
                {lane === newLane && <span className="mix-drop-hint">从素材栏拖入素材</span>}
                {dropTarget?.lane === lane && <>
                  <span className="mix-drop-outline" style={{
                    left: percent(dropTarget.start, view),
                    width: `${(dropTarget.end - dropTarget.start) / view.length * 100}%`,
                  }} aria-hidden="true" />
                  <span className="mix-drop-cursor" style={{
                    left: percent(clamp((dropTarget.start + dropTarget.end) / 2, view.start, view.start + view.length), view),
                  }} aria-hidden="true" />
                </>}
                {trimPreview?.lane === lane && <span className="mix-selection" style={{
                  left: percent(clamp(trimPreview.range.from, view.start, view.start + view.length), view),
                  right: clamp((view.start + view.length - trimPreview.range.to) / view.length * 100, 0, 100) + '%',
                }} aria-hidden="true"/>}
              </div>
            </div>
          })}
        </div>
        <div className="mix-playhead-layer">
          {playheadVisible && <span className="mix-playhead" style={{ left: percent(position, view) }}>
            <TimelinePlayheadHandle label="拖动播放头" time={position} duration={duration} seek={seek} startDrag={startPlayheadDrag} />
          </span>}
          {snapGuide !== undefined && <span className="mix-trim-guide" style={{ left: percent(snapGuide, view) }} aria-hidden="true" />}
        </div>
        </div>
      </div>
      {maxPan > 0 && <div className="adjustment-track-row zoom-scroll-row mix-pan">
        <span aria-hidden="true">平移</span>
        <div className="zoom-pan-track">
          <div className="zoom-pan-thumb" role="scrollbar" tabIndex={0}
            aria-label="左右移动音频预览" aria-controls="mix-timeline" aria-orientation="horizontal"
            aria-valuemin={0} aria-valuemax={maxPan} aria-valuenow={view.start}
            aria-valuetext={`${seconds(view.start)} – ${seconds(view.start + view.length)}`}
            style={{ width: panThumbWidth, left: `calc((100% - ${panThumbWidth}) * ${view.start / maxPan})` }}
            onPointerDown={event => {
              if (!event.isPrimary || event.button !== 0) return
              const thumb = event.currentTarget
              const track = thumb.parentElement
              const travel = (track?.clientWidth ?? 0) - thumb.getBoundingClientRect().width
              if (travel <= 0) return
              event.preventDefault()
              thumb.focus({ preventScroll: true })
              thumb.setPointerCapture(event.pointerId)
              panDrag.current = { pointerId: event.pointerId, clientX: event.clientX, start: view.start,
                secondsPerPixel: maxPan / travel }
            }}
            onPointerMove={movePanThumb}
            onPointerUp={movePanThumb}
            onLostPointerCapture={() => { panDrag.current = null }}
            onKeyDown={event => {
              const destinations: Record<string, number> = {
                ArrowLeft: view.start - view.length / 10, ArrowRight: view.start + view.length / 10,
                PageUp: view.start - view.length, PageDown: view.start + view.length, Home: 0, End: maxPan,
              }
              if (!Object.hasOwn(destinations, event.key)) return
              event.preventDefault()
              setPan(clamp(destinations[event.key], 0, maxPan))
            }}/>
        </div>
      </div>}
      <div className="adjustment-compare mix-transport">
        <button className="btn btn-ghost" type="button" aria-pressed={mixing}
          disabled={!mixing && (!!busy || !audibleTracks.length)} onClick={toggleMix}>
          {mixing ? '暂停混音' : '实时混音试听'}
        </button>
        <button className="btn btn-ghost" type="button" aria-pressed={mode === 'live' || realtimeClip}
          disabled={!!busy || !selectedTrack || !realtime.ready || !!realtime.error} onClick={() => void audition('live')}>实时试听</button>
        <button className="btn btn-ghost" type="button" aria-pressed={mode === 'original'} disabled={!!busy || !selectedTrack} onClick={() => void audition('original')}>原音</button>
        <div className="adjustment-export-actions">
          <AdjustmentOutputFields output={output} disabled={!!busy}/>
          <button className="btn btn-ghost" type="button" disabled={!!busy || !selectedTrack} onClick={() => void renderOutput(true)}>保存片段</button>
          <button className="btn btn-primary" type="button" disabled={!!busy || !audibleTracks.length} onClick={() => void renderOutput()}>保存混音</button>
        </div>
      </div>
      {busy === 'import' && <p role="status">正在导入素材…</p>}
      {busy === 'place' && <p role="status">正在生成音频波形…</p>}
      {(busy === 'render' || busy === 'prepare') && <div className="mix-progress" role="status">
        <span>{busy === 'prepare' ? '正在准备纯音频试听…' : '正在生成调整结果…'}</span><progress max="100" value={progress}/>
        <button className="btn btn-ghost btn-small" type="button" onClick={() => { if (job.current) void window.vdro.cancelAdjustment(job.current) }}>取消处理</button>
      </div>}
      {savedPath && <p className="settings-hint" role="status">音频已保存 <span translate="no">{savedPath}</span></p>}
      {!busy && mode === 'mix' && result?.clip.sourceMediaId === '' && result.fingerprint !== fingerprint &&
        <p className="settings-hint">正在试听之前生成的结果</p>}
      {realtimeMode && mixEndTime > 0 && <div className="mix-live-controls">
        <time>{formatTime(Math.min(position, mixEndTime))} / {formatTime(mixEndTime)}</time>
        <input className="mix-live-seek" type="range" min={0} max={mixEndTime} step="0.001" value={Math.min(position, mixEndTime)}
          aria-label={realtimeClip ? '预览播放进度' : '混音播放进度'} onChange={event => seek(event.currentTarget.valueAsNumber)}/>
        <label>试听音量 <input type="range" min={0} max={100} value={mixVolume}
          onChange={event => setMixVolume(event.currentTarget.valueAsNumber)}/></label>
      </div>}
      <audio {...clipPlayerProps('live')} ref={liveAudio} crossOrigin="anonymous"/>
      <audio {...clipPlayerProps('original')} ref={originalAudio}/>
      <audio ref={audio} controls hidden={mode !== 'mix' || !result} src={result?.clip.url} preload="auto"
        onError={() => { if (result) setError('试听文件不可用，请重新导入或生成。') }}
        onLoadedMetadata={event => {
          const player = event.currentTarget
          const pending = playOnLoad.current
          if (!pending || pending.id !== result?.clip.id || result.clip.url !== player.currentSrc) return
          playOnLoad.current = null
          if (active && mode === 'mix') {
            if (player.currentTime !== pending.time) player.currentTime = pending.time
            void player.play().catch(() => undefined)
          }
        }}
        onPlay={event => { if (!active || mode !== 'mix' || !result) event.currentTarget.pause() }}
        onTimeUpdate={event => {
          if (!scrubbing.current && result && mode === 'mix' && event.currentTarget.readyState) {
            setPosition(Math.min(result.offset + result.clip.duration, result.offset + event.currentTarget.currentTime))
          }
        }}/>
    </section>
    <aside className="adjustment-controls adjustment-parameters mix-controls">
      <nav className="adjustment-inspector-tabs" aria-label="调整侧栏">
        <button className="btn btn-ghost btn-small" type="button" aria-pressed={inspector === 'parameters'} onClick={() => setInspector('parameters')}>调整参数</button>
        <button className="btn btn-ghost btn-small" type="button" aria-pressed={inspector === 'results'} onClick={() => setInspector('results')}>调整结果 <small>{results.length}</small></button>
      </nav>
      <div hidden={inspector !== 'parameters'}>
      {selectedTrack ? <TrackControls key={selectedTrack.id} track={selectedTrack} disabled={!!busy || selectedLocked}
        marker={marker} setMarker={setMarker} onAddMarker={() => addMarker(selectedTrack)} settings={settings}
        onRemove={() => removeTrack(selectedTrack.id)}
        update={(change, group) => {
          changeTrack(selectedTrack.id, change, group)
          if (mode === 'original' && originalAudio.current && !originalAudio.current.paused) void audition('live')
        }}/>
        : <p className="settings-hint">添加音轨后可编辑轨道参数。</p>}
      </div>
      <section className="adjustment-results" hidden={inspector !== 'results'}>
        {!results.length && <p className="settings-hint">生成结果后可试听、保存或删除。原文件不会被修改。</p>}
        {results.map(item => <article key={item.clip.id}>
          <div><strong translate="no">{item.clip.fileName}</strong><p>{formatTime(item.clip.duration)} · {item.clip.format.toUpperCase()}</p></div>
          <div>
            <button className="btn btn-ghost btn-small" type="button" disabled={!!busy} onClick={() => playGenerated(item, 0)}>选择试听</button>
            <button className="btn btn-ghost btn-small" type="button" disabled={!!busy} onClick={() => void manageResult(item, false)}>保存</button>
            <button className="btn btn-ghost btn-small" type="button" disabled={!!busy} onClick={() => void manageResult(item, true)}>删除</button>
          </div>
        </article>)}
      </section>
    </aside>
    {active && clipMenu && menuTrack && <ClipContextMenu x={clipMenu.x} y={clipMenu.y}
      locked={!!laneAppearance[menuTrack.lane]?.locked} reversed={!!menuTrack.reversed}
      onDismiss={dismissClipMenu} onAction={action => runClipAction(action, menuTrack)} />}
  </main>
}

function TrackControls({ track, disabled, marker, setMarker, onAddMarker, settings, onRemove, update }: {
  track: Track
  disabled: boolean
  marker: string
  setMarker: (id: string) => void
  onAddMarker: () => void
  settings: AppSettings
  onRemove: () => void
  update: (callback: (track: Track) => Track, group?: object) => void
}) {
  const controlEdit = useRef<{ field: HTMLInputElement; group: object } | null>(null)
  const groupFor = (input: HTMLInputElement) => controlEdit.current?.field === input ? controlEdit.current.group : undefined
  const { effects } = track
  const duration = +(track.end - track.start).toFixed(6)
  const fadeDuration = track.effects.fadeRange ? track.effects.fadeRange.end - track.effects.fadeRange.start : duration
  const points = sortedPitchPoints(effects.pitchPoints)
  const point = points.find(item => item.id === marker) ?? points[0]
  const pitch = point?.semitones ?? effects.semitones
  const adjust = (changes: Partial<AudioAdjustment>, group?: object) =>
    update(current => ({ ...current, effects: { ...current.effects, ...changes } }), group)
  const updatePitch = (semitones: number, group?: object) => {
    if (!Number.isFinite(semitones)) return
    semitones = clamp(semitones, -12, 12)
    if (point) adjust({ pitchPoints: points.map(item => item.id === point.id ? { ...item, semitones } : item) }, group)
    else adjust({ semitones }, group)
  }
  function setRange(bound: 'start' | 'end', value: number, group?: object) {
    update(current => {
      const start = bound === 'start' ? Math.max(0, Math.min(value, current.end - MIN_CLIP_DURATION)) : current.start
      const end = bound === 'end' ? Math.min(current.media.info.duration, Math.max(value, start + MIN_CLIP_DURATION)) : current.end
      const length = +(end - start).toFixed(6)
      const fadeIn = Math.min(current.effects.fadeIn, length)
      const fadeOut = Math.min(current.effects.fadeOut, Math.max(0, length - fadeIn))
      return { ...current, start, end, effects: { ...current.effects, fadeIn, fadeOut, fadeRange: undefined } }
    }, group)
  }

  return <>
    <strong className="mix-selected-file" translate="no">{track.media.fileName}</strong>
    <fieldset disabled={disabled} onPointerDown={event => {
      if (event.button === 0 && event.target instanceof HTMLInputElement && event.target.type === 'range') {
        controlEdit.current = { field: event.target, group: {} }
      }
    }} onPointerUp={() => { if (controlEdit.current?.field.type === 'range') controlEdit.current = null }}
      onPointerCancel={() => { controlEdit.current = null }}
      onLostPointerCapture={() => { controlEdit.current = null }}
      onBlur={event => { if (controlEdit.current?.field.isSameNode(event.target)) controlEdit.current = null }}>
      <div className="mix-track-actions">
        <button className="btn btn-ghost btn-small" type="button" aria-pressed={track.muted}
          onClick={() => update(current => ({ ...current, muted: !current.muted }))}>静音</button>
        <TimelineEditButton action="delete" label="移除片段" onClick={onRemove} />
      </div>
      <TimeField label="混音起点（秒）" value={track.offset} max={MAX_MIX_OFFSET}
        onChange={(value, group) => update(current => ({ ...current, offset: Math.max(0, Math.min(value, MAX_MIX_OFFSET)) }), group)}/>
      <TimeField label="起点（秒）" value={track.start} max={track.end - MIN_CLIP_DURATION} onChange={(value, group) => setRange('start', value, group)}/>
      <TimeField label="终点（秒）" value={track.end} max={track.media.info.duration} onChange={(value, group) => setRange('end', value, group)}/>
      <p className="settings-hint">片段时长 <span>{seconds(duration)}</span></p>
      <label>{point ? '标记音高（半音）' : '基础音调（半音）'}
        <input type="range" min="-12" max="12" step=".5" value={pitch}
          onChange={event => updatePitch(event.target.valueAsNumber, groupFor(event.target))}/>
        <input type="number" className="mix-pitch-input" min="-12" max="12" step=".5" value={pitch}
          aria-label="音调半音数" onFocus={event => { controlEdit.current = { field: event.currentTarget, group: {} } }}
          onChange={event => updatePitch(event.target.valueAsNumber, groupFor(event.target))}/>
        <button className="btn btn-ghost btn-small" type="button" aria-label="重置音调" onClick={() => updatePitch(0)}>重置</button>
      </label>
      {point && <TimeField label="标记时间（秒）" value={point.time} max={track.media.info.duration} onChange={(value, group) => {
        const time = Math.max(0, Math.min(track.media.info.duration, Math.round(value * 100) / 100))
        if (points.some(item => item.id !== point.id && Math.abs(item.time - time) < .01 - .000001)) return
        adjust({ pitchPoints: sortedPitchPoints(points.map(item => item.id === point.id ? { ...item, time } : item)) }, group)
      }}/>}
      <div className="pitch-point-list">
        {points.map((item, index) => <div key={item.id}>
          <button type="button" aria-pressed={item.id === point?.id} onClick={() => setMarker(item.id)}>标记 {index + 1} · {seconds(item.time)} · {item.semitones}</button>
          <button type="button" aria-label={`删除标记 ${index + 1}`} onClick={() => {
            adjust({ pitchPoints: points.filter(other => other.id !== item.id) })
            if (item.id === marker) setMarker('')
          }}>×</button>
        </div>)}
        <TimelineEditButton action="marker" disabled={points.length >= 128} onClick={onAddMarker} />
        {points.length > 0 && <button className="btn btn-ghost btn-small" type="button"
          onClick={() => { adjust({ pitchPoints: [] }); setMarker('') }}>清除全部标记</button>}
      </div>
      <div>
        <label><input type="checkbox" checked={effects.preserveFormants} aria-describedby="mix-formant-description"
          onChange={event => adjust({ preserveFormants: event.target.checked })}/>保持人声共振峰</label>
        <p className="settings-hint" id="mix-formant-description">声音变高，但尽量保留原来的嗓音特点。若想要保留人声特点，可以打开此选项。</p>
      </div>
      <label><input type="checkbox" checked={effects.limiter}
        onChange={event => adjust({ limiter: event.target.checked })}/>防止音量削波</label>
      <label>音量（dB）
        <input type="range" min="-24" max="12" step=".5" value={effects.gainDb}
          onChange={event => adjust({ gainDb: event.target.valueAsNumber }, groupFor(event.target))}/>
        <output>{effects.gainDb} dB</output>
        <button className="btn btn-ghost btn-small" type="button" aria-label="重置音量" onClick={() => adjust({ gainDb: 0 })}>重置</button>
      </label>
      {effects.fadeRange && (effects.fadeIn > 0 || effects.fadeOut > 0) && <div>
        <p className="settings-hint">分割保留原片段的渐入渐出曲线。</p>
        <button className="btn btn-ghost btn-small" type="button"
          onClick={() => adjust({ fadeIn: 0, fadeOut: 0, fadeRange: undefined })}>重置渐入渐出</button>
      </div>}
      <div>
        <TimeField label="渐入（秒）" value={effects.fadeIn} max={fadeDuration - effects.fadeOut}
          onChange={(value, group) => adjust({ fadeIn: clamp(value, 0, fadeDuration - effects.fadeOut) }, group)}/>
        <input type="range" min={0} max={fadeDuration - effects.fadeOut} step="0.01" aria-label="渐入控制柄"
          value={effects.fadeIn} onChange={event => adjust({ fadeIn: event.target.valueAsNumber }, groupFor(event.target))}/>
      </div>
      <div>
        <TimeField label="渐出（秒）" value={effects.fadeOut} max={fadeDuration - effects.fadeIn}
          onChange={(value, group) => adjust({ fadeOut: clamp(value, 0, fadeDuration - effects.fadeIn) }, group)}/>
        <input type="range" min={0} max={fadeDuration - effects.fadeIn} step="0.01" aria-label="渐出控制柄"
          value={effects.fadeOut} onChange={event => adjust({ fadeOut: event.target.valueAsNumber }, groupFor(event.target))}/>
      </div>
      <label>渐变曲线<select value={effects.curve} onChange={event => adjust({ curve: event.target.value as AudioAdjustment['curve'] })}>
        <option value="tri">线性</option><option value="qsin">平滑</option><option value="exp">指数</option>
      </select></label>
      <button className="btn btn-ghost" type="button" onClick={() => { adjust({ ...defaultAdjustment(settings), pitchPoints: [], fadeRange: undefined }); setMarker('') }}>恢复参数</button>
    </fieldset>
  </>
}

function TrackWave({ track, view, selected, marker, editable, selectRange, movable, splitMode, playhead, onSplit, onClick, onMarker, onContextMenu,
  constrainTrim, onPreview, onTrim, onDragStart, onDragEnd }: {
  track: Track
  view: TimelineView
  selected: boolean
  marker: string
  editable: boolean
  selectRange: boolean
  movable: boolean
  splitMode: boolean
  playhead: number
  onSplit: (time: number) => void
  onClick: () => void
  onMarker: (id: string) => void
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void
  constrainTrim: (first: number, last: number, edge?: TrimEdge, allowSnap?: boolean) => TrimRange
  onPreview: (range: TrimRange | null) => void
  onTrim: (range: TrimRange) => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}) {
  const first = Math.max(track.offset, view.start)
  const last = Math.min(mixEnd(track), view.start + view.length)
  const visibleLength = Math.max(0, last - first)
  const start = track.start + (first - track.offset)
  const end = last === mixEnd(track) ? track.end : track.start + (last - track.offset)
  const { waveform, reversed } = track
  const waveformStart = reversed ? track.media.info.duration - end : start
  const waveformEnd = reversed ? track.media.info.duration - start : end
  const gesture = useRef<{ pointer: number; x: number; time: number; edge?: TrimEdge } | null>(null)
  const suppressClick = useRef(false)
  const splitGuide = useRef<HTMLSpanElement>(null)
  const canSplit = splitMode && editable
  const splitTime = (clientX: number, clip: HTMLDivElement) => +timeAt(clientX, clip.getBoundingClientRect(), { start: first, length: visibleLength }).toFixed(6)
  const hideSplitGuide = () => { if (splitGuide.current) splitGuide.current.hidden = true }
  const points = useMemo(() => {
    const bins = waveform.peaks.length / 2
    const from = Math.max(0, Math.min(bins - 1, Math.floor(waveformStart * waveform.peaksPerSecond)))
    const to = Math.min(bins, Math.ceil(waveformEnd * waveform.peaksPerSecond))
    const count = Math.min(400, to - from)
    const path: string[] = []
    for (let i = 0; i < count; i++) {
      let min = 0
      let max = 0
      const index = reversed ? count - i - 1 : i
      for (let j = from + Math.floor(index * (to - from) / count); j < from + Math.floor((index + 1) * (to - from) / count); j++) {
        min = Math.min(min, waveform.peaks[j * 2])
        max = Math.max(max, waveform.peaks[j * 2 + 1])
      }
      const x = ((i + .5) * 400 / count).toFixed(2)
      path.push('M' + x + ',' + ((1 - max) * 49 + 1).toFixed(2) + 'V' + ((1 - min) * 49 + 1).toFixed(2))
    }
    return path.join('')
  }, [waveform, waveformStart, waveformEnd, reversed])
  const nameId = 'mix-clip-name-' + track.id
  const pointerTime = (event: ReactPointerEvent<HTMLDivElement>, edge?: TrimEdge) => {
    const lane = event.currentTarget.parentElement
    if (edge && lane) return view.start + (event.clientX - lane.getBoundingClientRect().left) / Math.max(1, lane.clientWidth) * view.length
    return timeAt(event.clientX, event.currentTarget.getBoundingClientRect(), { start: first, length: visibleLength })
  }
  function trimmedRange(time: number, origin: number, edge?: TrimEdge) {
    if (edge === 'start') return constrainTrim(track.offset + time - origin, mixEnd(track), edge)
    if (edge === 'end') return constrainTrim(track.offset, mixEnd(track) + time - origin, edge)
    return constrainTrim(Math.min(origin, time), Math.max(origin, time))
  }
  function clearGesture() {
    if (!gesture.current) return
    gesture.current = null
    onPreview(null)
  }
  const markers = useMemo(() => sortedPitchPoints(track.effects.pitchPoints), [track.effects.pitchPoints])
  const visibleMarkers = visibleLength > 0 ? markers
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.time >= start - 1e-6 && point.time <= end + 1e-6) : []
  const pitchX = (time: number) => clamp((time - start) / (visibleLength || 1), 0, 1)
  const basePitch = track.effects.semitones
  const pitchCurve = visibleLength > 0 ? [
    [0, pitchAt(markers, start, basePitch)],
    ...visibleMarkers.map(({ point }) => [pitchX(point.time), point.semitones]),
    [1, pitchAt(markers, end, basePitch)],
  ].map(([x, pitch]) => `${400 * x},${50 - pitch / 12 * 40}`).join(' ') : ''
  const clipLeft = (first - view.start) / view.length * 100
  const { fadeIn, fadeOut } = track.effects
  const bounds = fadeBounds(track.effects, track.start, track.end)
  const fadeShape = visibleLength > 0 && (fadeIn > 0 || fadeOut > 0)
    ? [start, ...[bounds.start + fadeIn, bounds.end - fadeOut].filter(time => time > start && time < end), end].map(time =>
      (time - start) / visibleLength * 400 + ',' + fadeLevel(time, track.effects, track.start, track.end) * 100).join(' ')
    : ''
  return <div className="mix-wave-signal" data-muted={track.muted} data-selected={selected} data-trim={editable && selectRange}
    data-split={splitMode} data-reversed={!!track.reversed} onContextMenu={onContextMenu}
    style={{ left: percent(first, view), width: (visibleLength / view.length * 100) + '%' }}
    draggable={movable} onDragStart={event => {
      if (gesture.current || (event.target as HTMLElement).dataset.trimEdge) event.preventDefault()
      else onDragStart(event)
    }} onDragEnd={onDragEnd}
    onClick={event => {
      if (splitMode) {
        event.stopPropagation()
        if (canSplit) {
          onSplit(event.detail === 0 ? playhead : splitTime(event.clientX, event.currentTarget))
          hideSplitGuide()
        }
        return
      }
      if (suppressClick.current) { event.stopPropagation(); suppressClick.current = false; return }
      onClick()
    }}
    onPointerDown={event => {
      suppressClick.current = false
      const edge = (event.target as HTMLElement).dataset.trimEdge as TrimEdge | undefined
      if (splitMode || !editable || (!edge && !selectRange) || event.button !== 0 || !event.isPrimary) return
      event.preventDefault()
      gesture.current = { pointer: event.pointerId, x: event.clientX, time: pointerTime(event, edge), edge }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      if (splitGuide.current) {
        const cut = splitTime(event.clientX, event.currentTarget)
        splitGuide.current.hidden = !canSplitAt(track, cut)
        if (!splitGuide.current.hidden) splitGuide.current.style.left = `${(cut - first) * 100 / visibleLength}%`
        return
      }
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      const drag = Math.abs(event.clientX - current.x) >= 4
      onPreview(drag ? trimmedRange(pointerTime(event, current.edge), current.time, current.edge) : null)
    }}
    onPointerUp={event => {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      const next = trimmedRange(pointerTime(event, current.edge), current.time, current.edge)
      clearGesture()
      if (Math.abs(event.clientX - current.x) >= 4) {
        suppressClick.current = true
        onTrim(next)
      }
    }}
    onPointerLeave={hideSplitGuide} onPointerCancel={clearGesture} onLostPointerCapture={clearGesture}>
    <button className="mix-wave-pick" type="button" aria-label={splitMode ? '在此分割片段' : '在此波形定位播放头'} aria-describedby={nameId}
      disabled={splitMode && !canSplit} aria-pressed={splitMode ? undefined : selected}>
      <span className="mix-clip-name" id={nameId} translate="no" title={track.media.fileName}>{track.media.fileName}</span>
      <svg viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={points}/>
        {fadeShape && <polygon className="mix-fade-shape" points={`0,100 ${fadeShape} 400,100`}/>}
        {visibleMarkers.map(({ point }) => {
          const x = pitchX(point.time) * 400
          return <line key={point.id} className="mix-marker-guide" x1={x} x2={x} y1="0" y2="100"/>
        })}
        {pitchCurve && <polyline className="mix-pitch-curve" points={pitchCurve}/>}
      </svg>
    </button>
    {editable && !splitMode && !selectRange && visibleLength > 0 && (['start', 'end'] as const).map(edge => {
      if (edge === 'start' ? first !== track.offset : last !== mixEnd(track)) return null
      const label = edge === 'start' ? '拖动裁剪片段起点' : '拖动裁剪片段终点'
      return <button key={edge} className="mix-trim-edge" type="button" data-trim-edge={edge} draggable={false}
        aria-label={label} title={label} onClick={event => { event.stopPropagation(); onClick() }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? .1 : .01)
          const end = mixEnd(track)
          onTrim(constrainTrim(track.offset + (edge === 'start' ? delta : 0), end + (edge === 'end' ? delta : 0), edge, false))
        }}/>
    })}
    {visibleMarkers.map(({ point, index }) =>
      <button key={point.id} className="mix-marker-pin" type="button"
        aria-label={'选择标记 ' + (index + 1)} aria-pressed={selected && (marker || markers[0]?.id) === point.id}
        disabled={splitMode}
        title={`标记 ${index + 1}：${point.time.toFixed(2)} 秒，${point.semitones} 半音`}
        style={{ left: `clamp(calc(var(--mix-marker-size) / 2 - ${clipLeft}cqw), ${pitchX(point.time) * 100}%, calc(${100 - clipLeft}cqw - var(--mix-marker-size) / 2))` }}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onMarker(point.id) }}>
        {index + 1}
      </button>)}
    {canSplit && <span ref={splitGuide} className="timeline-split-guide" aria-hidden="true" hidden />}
  </div>
}
