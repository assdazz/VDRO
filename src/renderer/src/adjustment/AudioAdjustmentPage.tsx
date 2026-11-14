import { useEffect, useRef, useState, type SetStateAction } from 'react'
import WaveSurfer from 'wavesurfer.js'
import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { pitchAt, sortedPitchPoints } from '@shared/pitch'
import type { AudioAdjustment, ImportedMedia, ExtractedClip, ExportFormat, PeaksResult } from '@shared/types'
import type { AppSettings } from '@shared/types'
import { PageTabs } from '../PageTabs'
import { useRealtimePreview } from './useRealtimePreview'

const DEFAULTS: AudioAdjustment = { semitones: 0, gainDb: 0, fadeIn: 0, fadeOut: 0, curve: 'tri', preserveFormants: false, limiter: true }
const NEUTRAL: AudioAdjustment = { ...DEFAULTS, limiter: false }
type Result = { original: ExtractedClip; clip: ExtractedClip; start: number; end: number; fingerprint: string; description: string }
const message = (error: unknown) => String(error instanceof Error ? error.message : error)

export default function AudioAdjustmentPage({ active, incoming, onNavigate, settings }: {
  settings: AppSettings; active: boolean; incoming: { path: string; key: number } | null; onNavigate: (page: 'clip' | 'adjust') => void
}) {
  const defaultEffects = () => ({ ...DEFAULTS, preserveFormants: settings.adjustmentPreserveFormants, limiter: settings.adjustmentLimiter })
  const [media, setMedia] = useState<ImportedMedia | null>(null)
  const [original, setOriginal] = useState<ExtractedClip | null>(null)
  const [peaks, setPeaks] = useState<PeaksResult | null>(null)
  const [stream, setStream] = useState(0)
  const [range, setRangeState] = useState({ start: 0, end: 0 })
  const rangeRef = useRef(range); rangeRef.current = range
  const [effects, setEffectsState] = useState<AudioAdjustment>(defaultEffects)
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(settings.adjustmentSnap)
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const scroll = useRef<HTMLDivElement>(null)
  const points = sortedPitchPoints(effects.pitchPoints)
  const markerState = useRef({ points, snap, distance: settings.adjustmentSnapDistance }); markerState.current = { points, snap, distance: settings.adjustmentSnapDistance }
  const currentPoint = points.find(point => point.id === selectedPoint) ?? points[0]
  const pitchValue = currentPoint?.semitones ?? effects.semitones
  const [format, setFormat] = useState<ExportFormat>(settings.outputFormat)
  const [bitrate, setBitrate] = useState<number | 'native'>(settings.outputQuality)
  useEffect(() => { setFormat(settings.outputFormat); setBitrate(settings.outputQuality) }, [settings.outputFormat, settings.outputQuality])
  const sourceBitrate = media?.info.audioStreams.find(track => track.index === stream)?.bitRate
  const resolvedBitrate = bitrate === 'native' ? (sourceBitrate ? Math.max(32, Math.round(sourceBitrate / 1000)) : 192) : bitrate
  const adjustableQuality = format === 'mp3' || format === 'm4a'
  const outputBitrate = adjustableQuality ? resolvedBitrate : 192
  const [results, setResults] = useState<Result[]>([])
  const [selected, setSelected] = useState<Result | null>(null)
  const [mode, setMode] = useState<'original' | 'live' | 'effect'>('live')
  const playback = useRef({ mode, selected }); playback.current = { mode, selected }
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  const wave = useRef<HTMLDivElement>(null)
  const wavePlayer = useRef<WaveSurfer | null>(null)
  const regionPlugin = useRef<ReturnType<typeof Regions.create> | null>(null)
  const job = useRef<string | null>(null)
  const consumed = useRef<number | null>(null)
  const seekOnLoad = useRef(0)
  const resumeOnLoad = useRef(false)
  const duration = Math.max(0, range.end - range.start)
  const fingerprint = JSON.stringify({ mediaId: media?.id, range, effects, format, bitrate: outputBitrate, sampleRate: settings.sampleRate, channels: settings.channels, filenameTemplate: settings.filenameTemplate })
  const realtime = useRealtimePreview(audio, { enabled: mode === 'live', active, effects, ...range })
  function setRange(value: SetStateAction<{ start: number; end: number }>) {
    chooseMode('live')
    setRangeState(value)
  }
  function setEffects(value: SetStateAction<AudioAdjustment>) {
    chooseMode('live')
    setEffectsState(value)
  }

  useEffect(() => window.vdro.onAdjustmentProgress((event) => {
    if (event.jobId === job.current) setProgress(event.progress)
  }), [])
  useEffect(() => { if (!active) { audio.current?.pause() } }, [active])
  useEffect(() => () => { if (job.current) void window.vdro.cancelAdjustment(job.current) }, [])

  async function render(source: ImportedMedia, index: number, start: number, end: number, options: AudioAdjustment, output: ExportFormat, outputQuality = 192, preview = false) {
    const id = crypto.randomUUID(); job.current = id; setProgress(0)
    try {
      return await window.vdro.renderAdjustment({ jobId: id, mediaId: source.id, audioStreamIndex: index,
        start, end, effects: options, format: output, sampleRate: preview ? 48000 : settings.sampleRate, channels: preview ? 2 : settings.channels, bitrate: outputQuality })
    } finally { if (job.current === id) job.current = null }
  }
  async function load(path?: string) {
    if (busy) return
    setBusy(true); setError(''); setNotice('正在准备纯音频试听…'); audio.current?.pause()
    let next: ImportedMedia | null = null
    try {
      next = path ? await window.vdro.importPath(path) : await window.vdro.openFile()
      if (!next) { setNotice(''); return }
      next = { ...next, fileName: next.fileName.replace(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i, '') }
      const track = next.info.audioStreams.find(item => item.isDefault) ?? next.info.audioStreams[0]
      if (!track) throw new Error('该文件没有音轨')
      const converted = await render(next, track.index, 0, next.info.duration, NEUTRAL, 'wav', 192, true)
      setNotice('正在生成音频波形…')
      let waveform: PeaksResult
      try { waveform = await window.vdro.getPeaks(next.id, track.index) }
      catch (cause) { await window.vdro.deleteExtracted(converted.id, converted.filePath); throw cause }
      if (original && !results.some(result => result.original.id === original.id)) void window.vdro.deleteExtracted(original.id, original.filePath).catch(() => undefined)
      if (media) void window.vdro.releaseMedia(media.id)
      setMedia(next); setOriginal(converted); setPeaks(waveform); setStream(track.index)
      setRange({ start: 0, end: next.info.duration }); setEffects(defaultEffects()); setSnap(settings.adjustmentSnap); setSelectedPoint(null); setZoom(1); setPlayhead(0)
      setSelected(null); setMode('live'); seekOnLoad.current = 0; resumeOnLoad.current = false
      setNotice('已启用实时试听，播放时修改参数即可听到变化。'); next = null
    } catch (cause) { setError(message(cause)); setNotice('') }
    finally { if (next) void window.vdro.releaseMedia(next.id); setBusy(false) }
  }
  useEffect(() => {
    if (!incoming || incoming.key === consumed.current || busy) return
    consumed.current = incoming.key
    void load(incoming.path)
  }, [incoming, busy])

  useEffect(() => {
    if (!active || !original || !peaks || !wave.current || !audio.current) return
    const ws = WaveSurfer.create({ container: wave.current, media: new Audio(), peaks: [peaks.peaks],
      duration: peaks.duration, height: 160, waveColor: '#686868', progressColor: '#a5a5a5', cursorColor: '#faff69',
      barWidth: 2, barGap: 1, barHeight: 0.9, normalize: true, dragToSeek: false })
    // This waveform represents the original timeline; the audio player switches
    // to processed audio for A/B comparison without changing the edit coordinates.
    const regions = ws.registerPlugin(Regions.create())
    wavePlayer.current = ws; regionPlugin.current = regions
    ws.on('interaction', time => {
      const state = playback.current
      if (!audio.current) return
      setPlayhead(time)
      audio.current.currentTime = state.mode === 'effect' && state.selected
        ? Math.max(0, Math.min(state.selected.clip.duration, time - state.selected.start))
        : time
    })
    const initial = regions.addRegion({ ...rangeRef.current, color: 'rgba(250,255,105,.12)', drag: false, resize: true })

    regions.on('region-created', next => {
      for (const other of regions.getRegions()) if (other.id !== next.id) other.remove()
    })
    const snapped = (value: number) => {
      const { points, snap, distance } = markerState.current
      const tolerance = distance / Math.max(1, container.getBoundingClientRect().width) * peaks.duration
      const nearest = points.reduce((best, point) => Math.abs(point.time - value) < Math.abs(best - value) ? point.time : best, Infinity)
      return snap && Math.abs(nearest-value) <= tolerance ? nearest : value
    }
    const regionChanged = (next: {start:number;end:number;setOptions:(value:{start:number;end:number})=>void}) => {
      const value = {start:snapped(next.start),end:snapped(next.end)}
      if (value.end-value.start < .02) return
      if (Math.abs(value.start-next.start)>.000001 || Math.abs(value.end-next.end)>.000001) next.setOptions(value)
      setRange(value)
    }
    regions.on('region-update', regionChanged)
    regions.on('region-updated', regionChanged)
    const container = wave.current
    let origin: number | null = null
    let pointer: number | null = null
    let dragging = false
    const time = (x: number) => { const rect = container.getBoundingClientRect(); return Math.max(0, Math.min(peaks.duration, (x - rect.left) / rect.width * peaks.duration)) }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || event.composedPath().some(node => node instanceof Element && (node.getAttribute('part') ?? '').includes('region-handle'))) return
      origin = event.clientX; pointer = event.pointerId; dragging = false
    }
    const move = (event: PointerEvent) => {
      if (origin === null || pointer !== event.pointerId || (!dragging && Math.abs(event.clientX - origin) < 4)) return
      dragging = true; event.preventDefault(); event.stopPropagation()
      const start = snapped(Math.min(time(origin), time(event.clientX))), end = snapped(Math.max(time(origin), time(event.clientX)))
      if (end - start >= .02) { regions.getRegions()[0]?.setOptions({start,end}); setRange({start,end}) }
    }
    const up = () => { origin = null; pointer = null; dragging = false }
    container.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); window.addEventListener('blur', up)
    void initial
    return () => { container.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('blur', up); regionPlugin.current = null; wavePlayer.current = null; ws.destroy() }
  }, [active, original, peaks])

  useEffect(() => {
    const region = regionPlugin.current?.getRegions()[0]
    if (region && range.end > range.start && (region.start !== range.start || region.end !== range.end)) region.setOptions(range)
  }, [range])

  const bounds = mode === 'effect' && selected ? { start: 0, end: selected.clip.duration } : range
  const url = mode === 'effect' && selected ? selected.clip.url : original?.url
  function chooseMode(next: 'original' | 'live' | 'effect', result = selected) {
    const player = audio.current
    const nextUrl = next === 'effect' && result ? result.clip.url : original?.url
    const sourceTime = mode === 'effect' && selected ? selected.start + (player?.currentTime ?? 0) : (player?.currentTime ?? range.start)
    const target = next === 'effect' && result
      ? Math.max(0, Math.min(result.clip.duration, sourceTime - result.start))
      : Math.max(range.start, Math.min(range.end, sourceTime))
    if (nextUrl !== url) {
      resumeOnLoad.current = !!player && !player.paused
      seekOnLoad.current = target
      player?.pause()
    }
    setSelected(result); setMode(next)
  }
  async function generate() {
    if (!media || !original || busy) return
    if (duration < .02 || effects.fadeIn + effects.fadeOut > duration) { setError('请检查范围：渐入与渐出总时长不能超过片段时长'); return }
    const cached = results.find(result => result.fingerprint === fingerprint)
    if (cached) { setSelected(cached); setNotice('已使用相同参数生成的结果'); return }
    chooseMode('live'); setBusy(true); setError(''); setNotice('正在生成调整结果…'); audio.current?.pause()
    try {
      const clip = await render(media, stream, range.start, range.end, effects, format, outputBitrate)
      const pitchDescription = points.length ? `音高曲线 · ${points.length} 个标记` : `${effects.semitones > 0 ? '+' : ''}${effects.semitones} 半音`
      const result = { original, clip, ...range, fingerprint, description: `${adjustableQuality ? `${outputBitrate} kbps` : '无损编码'} · ${pitchDescription} · ${effects.gainDb} dB · 渐入 ${effects.fadeIn}s / 渐出 ${effects.fadeOut}s` }
      setResults(previous => [result, ...previous]); setSelected(result)
      setNotice('已生成可保存的结果，可选择试听核对导出音质。')
    } catch (cause) { setError(message(cause)); setNotice('') }
    finally { setBusy(false) }
  }
  async function save(result: Result) {
    try { const saved = await window.vdro.saveExtracted(result.clip.filePath, result.clip.fileName); if (!saved.canceled) setNotice('已保存：' + saved.filePath) }
    catch (cause) { setError(message(cause)) }
  }
  async function remove(result: Result) {
    try {
      if (selected === result) { audio.current?.pause(); setSelected(null); setMode('live') }
      await window.vdro.deleteExtracted(result.clip.id, result.clip.filePath)
      setResults(previous => previous.filter(item => item !== result))
    } catch (cause) { setError(message(cause)) }
  }
  function updateRange(key: 'start' | 'end', value: number) {
    if (!Number.isFinite(value)) return
    setRange(current => ({ ...current, [key]: Math.max(0, Math.min(media?.info.duration ?? 0, value)) }))
  }
  function updatePitch(value: number) {
    if (!Number.isFinite(value)) return
    setEffects(current => currentPoint ? { ...current, pitchPoints:current.pitchPoints?.map(point => point.id===currentPoint.id ? {...point,semitones:value} : point) } : {...current,semitones:value})
  }
  function addPoint(time = playhead) {
    if (!media || busy) return
    time = Math.max(0,Math.min(media.info.duration,Math.round(time*100)/100))
    const existing = points.find(point=>Math.abs(point.time-time)<.01-.000001)
    if (existing) { setSelectedPoint(existing.id); return }
    if (points.length>=128) {setError('最多支持 128 个标记');return}
    const point={id:crypto.randomUUID(),time,semitones:pitchAt(points,time,effects.semitones)}
    setEffects(current=>({...current,pitchPoints:sortedPitchPoints([...(current.pitchPoints??[]),point])}));setSelectedPoint(point.id)
  }
  function movePoint(value: number) {
    if (!currentPoint || !media || !Number.isFinite(value)) return
    const time=Math.max(0,Math.min(media.info.duration,Math.round(value*100)/100))
    if (points.some(point=>point.id!==currentPoint.id&&Math.abs(point.time-time)<.01-.000001)) return
    setEffects(current=>({...current,pitchPoints:sortedPitchPoints((current.pitchPoints??[]).map(point=>point.id===currentPoint.id?{...point,time}:point))}))
  }
  const percent = (time: number) => media && media.info.duration > 0 ? Math.max(0, Math.min(100,time/media.info.duration*100)) : 0
  return <div className={`app adjustment-app theme-${settings.theme} material-${settings.materialColor} accent-${settings.accent}`} onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !busy) void load(window.vdro.getPathForFile(file))
  }}>
    <header className="topbar"><div className="brand"><span className="brand-mark"/><span className="brand-name">VDRO</span></div>
      <PageTabs page="adjust" onNavigate={onNavigate}/><span className="topbar-file">{media?.fileName ?? '音频调整'}</span>
    </header>
    <main className="adjustment-workspace">
      <section className="adjustment-editor">
        <div className="adjustment-heading"><h2>音频调整</h2><button className="btn btn-primary" disabled={busy} onClick={() => void load()}>导入音频 / 视频音轨</button></div>
        <p className="settings-hint">拖入文件，或从“音频剪辑”的已提取片段点击“音频调整”。此页只播放音频。</p>
        {(error || realtime.error) && <p className="error-banner" role="alert">{error || realtime.error}</p>}{notice && <p className="settings-hint" role="status">{notice}</p>}
        <div className="adjustment-wave-toolbar"><div><button className="btn btn-ghost btn-small" disabled={!media || zoom<=1} onClick={()=>setZoom(value=>Math.max(1,value/1.5))}>缩小</button><button className="btn btn-ghost btn-small" disabled={!media || zoom>=16} onClick={()=>setZoom(value=>Math.min(16,value*1.5))}>放大</button><button className="btn btn-ghost btn-small" disabled={!media} onClick={()=>{setZoom(1);if(scroll.current)scroll.current.scrollLeft=0}}>重置缩放</button><span>{zoom.toFixed(1)}×</span></div><div><button className="btn btn-ghost btn-small" disabled={!media || busy} onClick={()=>addPoint()}>添加标记</button><label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/>标记吸附</label></div></div>
        <div className="adjustment-wave-shell" ref={scroll} style={{pointerEvents:busy?'none':undefined}}><div className="adjustment-wave-content" style={{width:zoom*100+'%'}}><div className="adjustment-wave" ref={wave}/>{media && <div className="adjustment-envelope">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={`M ${percent(range.start)} 100 L ${percent(range.start + effects.fadeIn)} 0 L ${percent(range.end-effects.fadeOut)} 0 L ${percent(range.end)} 100 Z`}/>{points.length>0 && <polyline className="pitch-curve" points={[{time:0,semitones:points[0].semitones},...points,{time:media.info.duration,semitones:points[points.length-1].semitones}].map(point=>percent(point.time)+','+(50-point.semitones/12*40)).join(' ')}/>}</svg>
        </div>}{points.map((point,index)=><button key={point.id} type="button" className={`pitch-marker${currentPoint?.id===point.id?' is-selected':''}${percent(point.time)>98?' is-end':''}`} style={{left:percent(point.time)+'%'}} title={`标记 ${index+1}：${point.time.toFixed(2)} 秒，${point.semitones} 半音`} aria-label={`选择标记 ${index+1}`} aria-pressed={currentPoint?.id===point.id} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();setSelectedPoint(point.id);chooseMode('live')}}><span>{index+1}</span></button>)}</div></div>
        {!media && <p className="adjustment-empty">导入后显示音频波形</p>}
        <div className="adjustment-range"><TimeField label="起点（秒）" value={range.start} disabled={busy || !media} onChange={value => updateRange('start', value)}/><TimeField label="终点（秒）" value={range.end} disabled={busy || !media} onChange={value => updateRange('end', value)}/><span>片段时长 {duration.toFixed(2)} 秒</span></div>
        <div className="adjustment-compare"><button className="btn btn-ghost" aria-pressed={mode === 'live'} disabled={!original || busy || !realtime.ready || !!realtime.error} onClick={() => chooseMode('live')}>实时试听</button><button className="btn btn-ghost" aria-pressed={mode === 'original'} disabled={!original || busy} onClick={() => chooseMode('original')}>原音</button><button className="btn btn-ghost" aria-pressed={mode === 'effect'} disabled={!selected || busy} onClick={() => chooseMode('effect')}>已生成结果</button>{mode === 'effect' && selected?.fingerprint !== fingerprint && <span>正在试听之前生成的结果</span>}<div className="adjustment-export-actions"><label>输出格式<select disabled={busy || !media} value={format} onChange={e => setFormat(e.target.value as ExportFormat)}>{['wav','mp3','m4a','flac'].map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label><label>输出音质<select aria-label="输出音质" disabled={busy || !media || !adjustableQuality} value={adjustableQuality ? String(bitrate) : 'lossless'} onChange={e => setBitrate(e.target.value === 'native' ? 'native' : Number(e.target.value))}>{adjustableQuality ? <><option value="native">原生码率（未获取时使用 192 kbps）</option>{[96,128,192,256,320].map(value => <option key={value} value={value}>{value} kbps</option>)}</> : <option value="lossless">无损</option>}</select></label><button className="btn btn-primary" disabled={busy || !media} onClick={() => void generate()}>保存修改音频</button></div></div>
        <audio ref={audio} crossOrigin="anonymous" onError={() => { if (url) setError('试听文件不可用，请重新导入或生成。') }} controls src={url} preload="metadata" onLoadedMetadata={() => { if (audio.current) { audio.current.currentTime = seekOnLoad.current; if (resumeOnLoad.current && active) { resumeOnLoad.current = false; void audio.current.play().catch(() => undefined) } } }} onPlay={() => {
          if (!active || !realtime.ready || realtime.error) { audio.current?.pause(); return }
          const player = audio.current!; if (player.currentTime < bounds.start || player.currentTime >= bounds.end) player.currentTime = bounds.start
        }} onTimeUpdate={() => { const player = audio.current; if(player)setPlayhead(mode==='effect'&&selected?selected.start+player.currentTime:player.currentTime); if (player && (mode !== 'effect' || !selected || selected.clip.sourceMediaId === media?.id)) wavePlayer.current?.setTime(mode === 'effect' && selected ? selected.start + player.currentTime : player.currentTime); if (player && !player.paused && player.currentTime >= bounds.end) { player.pause(); player.currentTime = bounds.start } }}/>
        <section className="adjustment-results"><h3>调整结果 <small>{results.length}</small></h3>{results.length === 0 && <p className="settings-hint">生成结果后可试听、保存或删除。原文件不会被修改。</p>}{results.map(result => <article key={result.clip.id}><div><strong>{result.clip.fileName}</strong><p>{result.description}</p><small>{result.start.toFixed(2)}–{result.end.toFixed(2)} 秒 · {result.clip.format.toUpperCase()}</small></div><div><button className="btn btn-ghost btn-small" onClick={() => chooseMode('effect', result)}>选择试听</button><button className="btn btn-ghost btn-small" onClick={() => void save(result)}>保存</button><button className="btn btn-ghost btn-small" onClick={() => void remove(result)}>删除</button></div></article>)}</section>
      </section>
      <aside className="adjustment-controls"><h3>调整参数</h3><fieldset disabled={busy || !media}>
        <label>{currentPoint ? '标记音高（半音）' : '基础音调（半音）'}<input type="range" min="-12" max="12" step="0.5" value={pitchValue} onChange={e => updatePitch(+e.target.value)}/><input aria-label="音调半音数" type="number" min="-12" max="12" step="0.5" value={pitchValue} onChange={e => updatePitch(+e.target.value)}/><button className="btn btn-ghost btn-small" type="button" aria-label="重置音调" onClick={() => updatePitch(0)}>重置</button></label>
        <section className="pitch-point-controls"><h4>音高标记 {points.length}</h4><p className="settings-hint">点击“添加标记”在播放头创建标记。点击波形上的数字选择标记，上方音高调整实时生效。</p>{currentPoint && <TimeField label="标记时间（秒）" value={currentPoint.time} disabled={busy} onChange={movePoint}/>}<div className="pitch-point-list">{points.map((point,index)=><div key={point.id}><button type="button" aria-pressed={currentPoint?.id===point.id} onClick={()=>{setSelectedPoint(point.id);chooseMode('live')}}>标记 {index+1} · {point.time.toFixed(2)}s · {point.semitones>0?'+':''}{point.semitones}</button><button type="button" aria-label={`删除标记 ${index+1}`} onClick={()=>{setEffects(current=>({...current,pitchPoints:current.pitchPoints?.filter(item=>item.id!==point.id)}));if(selectedPoint===point.id)setSelectedPoint(null)}}>×</button></div>)}</div><button className="btn btn-ghost btn-small" onClick={()=>{setSelectedPoint(null);setEffects(current=>({...current,pitchPoints:[]}))}} type="button">清除全部标记</button></section>
        <div><label><input type="checkbox" aria-describedby="formant-description" checked={effects.preserveFormants} onChange={e => setEffects({ ...effects, preserveFormants: e.target.checked })}/>保持人声共振峰</label><p id="formant-description" className="settings-hint">声音变高，但尽量保留原来的嗓音特点。若想要保留人声特点，可以打开此选项。</p></div>
        <label><input type="checkbox" checked={effects.limiter} onChange={e => setEffects({ ...effects, limiter: e.target.checked })}/>防止音量削波</label>
        <label>音量（dB）<input type="range" min="-24" max="12" step="0.5" value={effects.gainDb} onChange={e => setEffects({ ...effects, gainDb: +e.target.value })}/><output>{effects.gainDb} dB</output><button className="btn btn-ghost btn-small" type="button" aria-label="重置音量" onClick={() => setEffects(current => ({ ...current, gainDb: DEFAULTS.gainDb }))}>重置</button></label>
        <label>渐入（秒）<input aria-label="渐入时长" type="number" min="0" max={duration} step="0.1" value={effects.fadeIn} onChange={e => setEffects({ ...effects, fadeIn: +e.target.value })}/><input aria-label="渐入控制柄" type="range" min="0" max={duration} step="0.01" value={effects.fadeIn} onChange={e => setEffects({ ...effects, fadeIn: +e.target.value })}/></label>
        <label>渐出（秒）<input aria-label="渐出时长" type="number" min="0" max={duration} step="0.1" value={effects.fadeOut} onChange={e => setEffects({ ...effects, fadeOut: +e.target.value })}/><input aria-label="渐出控制柄" type="range" min="0" max={duration} step="0.01" value={effects.fadeOut} onChange={e => setEffects({ ...effects, fadeOut: +e.target.value })}/></label>
        <label>渐变曲线<select value={effects.curve} onChange={e => setEffects({ ...effects, curve: e.target.value as AudioAdjustment['curve'] })}><option value="tri">线性</option><option value="qsin">平滑</option><option value="exp">指数</option></select></label>


        <button className="btn btn-ghost" onClick={() => setEffects(defaultEffects())}>恢复参数</button>
      </fieldset>{busy && <><progress max="100" value={progress}/><span>{progress}%</span><button className="btn btn-ghost" onClick={() => { if (job.current) void window.vdro.cancelAdjustment(job.current) }}>取消处理</button></>}<p className="settings-hint">参数和标记修改会自动切回实时试听，保持速度和时长。保存前生成结果；实时试听与导出音色可能略有差别，可试听已生成结果核对。</p></aside>
    </main>
  </div>
}

function TimeField({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return <label>{label}<input aria-label={label} type="number" step="0.01" min="0" value={draft ?? value.toFixed(2)} disabled={disabled}
    onFocus={() => setDraft(value.toFixed(2))}
    onChange={event => { setDraft(event.target.value); if (event.target.value !== '') onChange(Number(event.target.value)) }}
    onBlur={() => setDraft(null)} /></label>
}
