import { fadeBounds, fadeLevel } from '@shared/fades'
import { pitchAt, sortedPitchPoints } from '@shared/pitch'
import type { MixTrackRequest } from '@shared/types'
import { RubberBandNode } from './RubberBandNode'
import type { PreviewWave } from './previewWave'

type Track = MixTrackRequest & { id: string; muted: boolean }
type Channel = {
  input: GainNode
  processor: RubberBandNode
  dry: GainNode
  wet: GainNode
  gain: GainNode
  limiter: DynamicsCompressorNode
  sources: Set<AudioBufferSourceNode>
  nextFrame: number
  wetReadyAt: number
  reading: boolean
  effects?: Track['effects']
}
type Voice = { track: Track; wave: PreviewWave; loading?: Promise<Channel | undefined>; output?: Channel }
const LOOKAHEAD = .65
const END_TAIL = .04
function usesPitch(effects: Track['effects']) {
  return effects.pitchPoints?.length ? effects.pitchPoints.some(point => point.semitones !== 0) : effects.semitones !== 0
}
const endOf = (track: Track) => track.offset + track.end - track.start
const clamp = (n: number, min: number, max: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min

function previewGain(time: number, { effects, start, end }: Track) {
  return 10 ** (clamp(effects.gainDb, -24, 12) / 20) * fadeLevel(time, effects, start, end)
}

/** All voices schedule PCM blocks against one AudioContext clock. */
export class RealtimeMix {
  private context?: AudioContext
  private master?: GainNode
  private destination?: DynamicsCompressorNode
  private tracks: Track[] = []
  private waves: ReadonlyMap<string, PreviewWave> = new Map()
  private voices = new Map<string, Voice>()
  private timer?: number
  private session = 0
  private origin = 0
  private start = 0
  private volume = 1
  private rate = 1
  private limitOutput = true
  private starting = false
  private playing = false

  constructor(
    private onPosition: (position: number) => void,
    private onPlaying: (playing: boolean) => void,
    private onError: (error: unknown) => void,
  ) {}

  private get end() {
    return Math.max(0, ...this.tracks.filter(track => !track.muted).map(endOf))
  }

  update(tracks: Track[], waves: ReadonlyMap<string, PreviewWave>, limitOutput: boolean) {
    this.tracks = tracks
    this.waves = waves
    this.limitOutput = limitOutput
    if (this.destination) this.destination.ratio.value = limitOutput ? 20 : 1
    for (const [id, voice] of this.voices) {
      const next = tracks.find(track => track.id === id)
      if (!next || next.muted || next.start !== voice.track.start || next.end !== voice.track.end ||
        next.offset !== voice.track.offset || next.reversed !== voice.track.reversed) this.removeVoice(voice)
      else voice.track = next
    }
    if (this.playing) this.tick()
  }

  setVolume(value: number) {
    this.volume = value
    if (this.master && this.context) this.master.gain.setTargetAtTime(value, this.context.currentTime, .015)
  }

  private timelinePosition(now: number) {
    return this.start + (now - this.origin) * this.rate
  }

  setPlaybackRate(rate: number) {
    if (this.rate === rate) return
    const position = this.playing
      ? clamp(this.timelinePosition(this.context!.currentTime), this.start, this.end)
      : this.start
    this.rate = rate
    if (!this.playing && !this.starting) return
    if (position >= this.end) {
      this.onPosition(this.end)
      this.pause()
      return
    }
    void this.play(position)
  }

  private audioContext() {
    if (!this.context) {
      const context = new AudioContext({ latencyHint: 'interactive' })
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = this.limitOutput ? 20 : 1
      limiter.attack.value = .003; limiter.release.value = .1
      const master = context.createGain()
      master.gain.value = this.volume
      limiter.connect(master).connect(context.destination)
      this.context = context
      this.master = master
      this.destination = limiter
    }
    return this.context
  }

  prime(tracks: Track[], waves: ReadonlyMap<string, PreviewWave>, position: number) {
    if (!tracks.length) return
    const context = this.audioContext()
    void RubberBandNode.prepare(context).catch(() => undefined)
    for (const track of tracks) {
      const wave = waves.get(track.id)
      if (!wave) continue
      const time = position >= track.offset && position < endOf(track) ? position - track.offset : 0
      const frame = Math.ceil((track.start + time) * wave.sampleRate)
      if (frame < wave.frames) void wave.readBlock(context, wave.blockStart(frame), track.reversed).catch(() => undefined)
    }
  }

  async play(position: number) {
    this.pause()
    const session = this.session
    if (!this.end || !this.tracks.some(track => !track.muted)) return
    this.start = position >= this.end ? 0 : clamp(position, 0, this.end)
    this.starting = true
    this.onPosition(this.start)
    this.onPlaying(true)
    try {
      // Resume during the play gesture, then wait for blocks under the playhead.
      const context = this.audioContext()
      if (context.state !== 'running') await context.resume()
      if (session !== this.session) return
      await Promise.all(this.ensureVoices(this.start).map(voice => {
        const frame = Math.ceil((voice.track.start + Math.max(0, this.start - voice.track.offset)) * voice.wave.sampleRate)
        const block = frame < voice.wave.frames ? voice.wave.readBlock(context, voice.wave.blockStart(frame), voice.track.reversed) : undefined
        return Promise.all([voice.loading, block])
      }))
      if (session !== this.session) return
      const latency = Math.max(0, ...[...this.voices.values()].filter(voice => this.rate !== 1 || usesPitch(voice.track.effects))
        .map(voice => (voice.output?.processor.latencySeconds ?? 0) - Math.max(0, voice.track.offset - this.start) / this.rate))
      this.origin = context.currentTime + latency + .015
      this.starting = false
      this.playing = true
      this.timer = window.setInterval(() => this.tick(), 24)
      this.tick()
    } catch (error) {
      if (this.session === session) this.fail(error)
    }
  }

  pause() {
    this.session++
    this.starting = false
    this.playing = false
    if (this.timer !== undefined) window.clearInterval(this.timer)
    this.timer = undefined
    for (const voice of this.voices.values()) this.removeVoice(voice)
    this.onPlaying(false)
  }

  dispose() {
    this.pause()
    if (this.context) void this.context.close()
  }

  private fail(error: unknown) {
    this.pause()
    this.onError(error)
  }

  private ensureVoices(position: number) {
    return this.tracks.flatMap(track => {
      const wave = this.waves.get(track.id)
      if (!wave || track.muted || endOf(track) <= position || track.offset > position + LOOKAHEAD * this.rate) return []
      const existing = this.voices.get(track.id)
      if (existing) return [existing]
      const voice: Voice = { track, wave }
      this.voices.set(track.id, voice)
      voice.loading = this.createChannel(voice, position)
      return [voice]
    })
  }

  private async createChannel(voice: Voice, position: number) {
    const context = this.context!
    const id = voice.track.id
    try {
      const processor = await RubberBandNode.create(context)
      // A seek or edit can replace the voice while its worklet initializes.
      if (this.voices.get(id) !== voice) { processor.dispose(); return }
      processor.playbackRate.value = this.rate
      const input = context.createGain()
      const dry = context.createGain(), wet = context.createGain(), gain = context.createGain()
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -1; limiter.knee.value = 3
      limiter.attack.value = .003; limiter.release.value = .1
      dry.connect(gain)
      input.connect(processor).connect(wet).connect(gain)
      gain.connect(limiter).connect(this.destination!)
      processor.onprocessorerror = () => this.fail(new Error('实时混音处理失败。'))
      const { track } = voice
      const channel: Channel = {
        input, processor, dry, wet, gain, limiter, sources: new Set(), reading: false, wetReadyAt: context.currentTime + processor.latencySeconds,
        nextFrame: Math.ceil((track.start + Math.max(0, position - track.offset)) * voice.wave.sampleRate),
      }
      voice.output = channel
      return channel
    } catch (error) {
      if (this.voices.get(id) === voice) this.fail(error)
      return undefined
    }
  }

  private removeVoice(voice: Voice) {
    this.voices.delete(voice.track.id)
    const channel = voice.output
    if (!channel) return
    for (const source of channel.sources) source.stop()
    channel.limiter.disconnect()
    channel.dry.disconnect()
    channel.input.disconnect()
    channel.processor.dispose()
  }

  private tick() {
    const now = this.context!.currentTime
    const position = this.timelinePosition(now)
    if (position >= this.end + END_TAIL * this.rate) {
      this.onPosition(this.end)
      this.pause()
      return
    }
    this.onPosition(clamp(position, this.start, this.end))
    for (const voice of this.voices.values()) {
      if (position >= endOf(voice.track) + END_TAIL * this.rate) this.removeVoice(voice)
    }
    for (const voice of this.ensureVoices(Math.max(this.start, position))) {
      if (!voice.output) continue
      this.applyEffects(voice.track, voice.output, position, now)
      this.queueBlock(voice, position)
    }
  }

  private applyEffects(track: Track, channel: Channel, position: number, now: number) {
    const { effects } = track
    if (channel.effects === effects) return
    const entering = !channel.effects
    channel.effects = effects
    const pitch = channel.processor.pitchSemitones
    const points = sortedPitchPoints(effects.pitchPoints)
    const shifted = this.rate !== 1 || usesPitch(effects)
    const pitchTime = track.start + position - track.offset + channel.processor.latencySeconds * this.rate
    const ramp = (parameter: AudioParam, value: number, at = now) => {
      if (entering) parameter.setValueAtTime(value, at)
      else {
        parameter.cancelAndHoldAtTime(now)
        parameter.setTargetAtTime(value, at, .012)
      }
    }
    const switchAt = shifted && !entering ? Math.max(now, channel.wetReadyAt) : now
    ramp(channel.dry.gain, shifted ? 0 : 1, switchAt)
    ramp(channel.wet.gain, shifted ? 1 : 0, switchAt)
    ramp(channel.limiter.ratio, effects.limiter ? 20 : 1)
    ramp(channel.processor.formantStrength, effects.preserveFormants ? 1 : 0)
    pitch.cancelAndHoldAtTime(now)
    const pitchLead = entering ? 0 : .025
    pitch.linearRampToValueAtTime(pitchAt(points, pitchTime + pitchLead * this.rate, effects.semitones), now + pitchLead)
    for (const point of points) {
      const delay = (point.time - pitchTime) / this.rate
      if (delay > pitchLead) pitch.linearRampToValueAtTime(point.semitones, now + delay)
    }

    const gain = channel.gain.gain
    gain.cancelAndHoldAtTime(now)
    const gainLead = entering ? 0 : .012
    const initial = track.start + position - track.offset + gainLead * this.rate
    gain.linearRampToValueAtTime(previewGain(initial, track), now + gainLead)
    const bounds = fadeBounds(effects, track.start, track.end)
    for (const [start, end] of [[bounds.start, bounds.start + effects.fadeIn], [bounds.end - effects.fadeOut, bounds.end]]) {
      if (end <= start || end <= initial) continue
      for (let i = 0; i <= 16; i++) {
        const time = start + (end - start) * i / 16
        if (time > initial) gain.linearRampToValueAtTime(previewGain(time, track), now + gainLead + (time - initial) / this.rate)
      }
    }
  }

  private queueBlock(voice: Voice, position: number) {
    const channel = voice.output!
    if (channel.reading) return
    const { track, wave } = voice
    const first = channel.nextFrame
    const last = Math.min(wave.frames, Math.round(track.end * wave.sampleRate))
    const time = track.offset + first / wave.sampleRate - track.start
    if (first >= last || time > position + LOOKAHEAD * this.rate) return
    const context = this.context!
    const block = wave.blockStart(first)
    channel.reading = true
    void wave.readBlock(context, block, track.reversed).then(buffer => {
      if (!this.playing || this.voices.get(track.id) !== voice) return
      const count = Math.min(last - first, buffer.length - (first - block))
      channel.nextFrame += count
      const audibleAt = this.origin + (time - this.start) / this.rate
      const schedule = (destination: AudioNode, when: number) => {
        const scheduled = Math.max(when, context.currentTime + .003)
        const late = (scheduled - when) * this.rate
        const duration = count / wave.sampleRate - late
        if (duration <= 0) return
        const source = context.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = this.rate
        source.connect(destination)
        channel.sources.add(source)
        source.onended = () => { source.disconnect(); channel.sources.delete(source) }
        source.start(scheduled, (first - block) / wave.sampleRate + late, duration)
      }
      // Both paths share the audible clock. Only the pitch processor needs its input early.
      schedule(channel.dry, audibleAt)
      schedule(channel.input, audibleAt - channel.processor.latencySeconds)
    }).catch(error => {
      if (this.voices.get(track.id) === voice) this.fail(error)
    }).finally(() => { channel.reading = false })
  }
}
