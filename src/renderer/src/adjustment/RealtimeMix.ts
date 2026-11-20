import { fadeBounds } from '@shared/fades'
import { pitchAt, sortedPitchPoints } from '@shared/pitch'
import type { MixTrackRequest } from '@shared/types'
import { RubberBandNode } from './RubberBandNode'
import { previewGain } from './useRealtimePreview'
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
  reading: boolean
  effects?: Track['effects']
}
type Voice = { track: Track; wave: PreviewWave; loading?: Promise<Channel | undefined>; output?: Channel }
const LOOKAHEAD = .65
const END_TAIL = .04
const endOf = (track: Track) => track.offset + track.end - track.start
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

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
  private playing = false

  constructor(
    private onPosition: (position: number) => void,
    private onPlaying: (playing: boolean) => void,
    private onError: (error: unknown) => void,
  ) {}

  private get end() {
    return Math.max(0, ...this.tracks.filter(track => !track.muted).map(endOf))
  }

  update(tracks: Track[], waves: ReadonlyMap<string, PreviewWave>) {
    this.tracks = tracks
    this.waves = waves
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

  async activate() {
    if (!this.context) {
      const context = new AudioContext({ latencyHint: 'interactive' })
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20
      limiter.attack.value = .003; limiter.release.value = .1
      const master = context.createGain()
      master.gain.value = this.volume
      limiter.connect(master).connect(context.destination)
      this.context = context
      this.master = master
      this.destination = limiter
    }
    await this.context.resume()
    return this.context
  }

  async play(position: number) {
    this.pause()
    const session = this.session
    if (!this.end || !this.tracks.some(track => !track.muted)) return
    this.start = position >= this.end ? 0 : clamp(position, 0, this.end)
    this.onPlaying(true)
    try {
      // Resume during the play gesture, then wait for blocks under the playhead.
      const context = await this.activate()
      if (session !== this.session) return
      await Promise.all(this.ensureVoices(this.start).map(async voice => {
        const channel = await voice.loading
        if (!channel) return
        const frame = channel.nextFrame
        if (frame < voice.wave.frames) await voice.wave.readBlock(context, voice.wave.blockStart(frame), voice.track.reversed)
      }))
      if (session !== this.session) return
      const latency = Math.max(.14, ...[...this.voices.values()].map(voice => voice.output?.processor.latencySeconds ?? 0))
      this.origin = context.currentTime + latency + .055
      this.playing = true
      this.timer = window.setInterval(() => this.tick(), 24)
      this.tick()
    } catch (error) {
      if (this.session === session) this.fail(error)
    }
  }

  pause() {
    this.session++
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
      if (!wave || track.muted || endOf(track) <= position || track.offset > position + LOOKAHEAD) return []
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
      const input = context.createGain()
      const delay = context.createDelay(1)
      delay.delayTime.value = processor.latencySeconds
      const dry = context.createGain(), wet = context.createGain(), gain = context.createGain()
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -1; limiter.knee.value = 3
      limiter.attack.value = .003; limiter.release.value = .1
      input.connect(delay).connect(dry).connect(gain)
      input.connect(processor).connect(wet).connect(gain)
      gain.connect(limiter).connect(this.destination!)
      processor.onprocessorerror = () => this.fail(new Error('实时混音处理失败。'))
      const { track } = voice
      const channel: Channel = {
        input, processor, dry, wet, gain, limiter, sources: new Set(), reading: false,
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
    channel.input.disconnect()
    channel.processor.dispose()
  }

  private tick() {
    const now = this.context!.currentTime
    const position = this.start + now - this.origin
    if (position >= this.end + END_TAIL) {
      this.onPosition(this.end)
      this.pause()
      return
    }
    this.onPosition(clamp(position, this.start, this.end))
    for (const voice of this.voices.values()) {
      if (position >= endOf(voice.track) + END_TAIL) this.removeVoice(voice)
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
    const shifted = points.length ? points.some(point => point.semitones !== 0) : effects.semitones !== 0
    const pitchTime = track.start + position - track.offset + channel.processor.latencySeconds
    const ramp = (parameter: AudioParam, value: number) => {
      if (entering) parameter.setValueAtTime(value, now)
      else parameter.setTargetAtTime(value, now, .012)
    }
    ramp(channel.dry.gain, shifted ? 0 : 1)
    ramp(channel.wet.gain, shifted ? 1 : 0)
    ramp(channel.limiter.ratio, effects.limiter ? 20 : 1)
    ramp(channel.processor.formantStrength, effects.preserveFormants ? 1 : 0)
    pitch.cancelAndHoldAtTime(now)
    const pitchLead = entering ? 0 : .025
    pitch.linearRampToValueAtTime(pitchAt(points, pitchTime + pitchLead, effects.semitones), now + pitchLead)
    for (const point of points) {
      const delay = point.time - pitchTime
      if (delay > pitchLead) pitch.linearRampToValueAtTime(point.semitones, now + delay)
    }

    const gain = channel.gain.gain
    gain.cancelAndHoldAtTime(now)
    const gainLead = entering ? 0 : .012
    const initial = track.start + position - track.offset + gainLead
    gain.linearRampToValueAtTime(previewGain(initial, track), now + gainLead)
    const bounds = fadeBounds(effects, track.start, track.end)
    for (const [start, end] of [[bounds.start, bounds.start + effects.fadeIn], [bounds.end - effects.fadeOut, bounds.end]]) {
      if (end <= start || end <= initial) continue
      for (let i = 0; i <= 16; i++) {
        const time = start + (end - start) * i / 16
        if (time > initial) gain.linearRampToValueAtTime(previewGain(time, track), now + gainLead + time - initial)
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
    if (first >= last || time > position + LOOKAHEAD) return
    const context = this.context!
    const block = wave.blockStart(first)
    channel.reading = true
    void wave.readBlock(context, block, track.reversed).then(buffer => {
      if (!this.playing || this.voices.get(track.id) !== voice) return
      const count = Math.min(last - first, buffer.length - (first - block))
      channel.nextFrame += count
      const when = this.origin + time - this.start - channel.processor.latencySeconds
      const scheduled = Math.max(when, context.currentTime + .003)
      const late = scheduled - when
      const duration = count / wave.sampleRate - late
      if (duration <= 0) return
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(channel.input)
      channel.sources.add(source)
      source.onended = () => { source.disconnect(); channel.sources.delete(source) }
      source.start(scheduled, (first - block) / wave.sampleRate + late, duration)
    }).catch(error => {
      if (this.voices.get(track.id) === voice) this.fail(error)
    }).finally(() => { channel.reading = false })
  }
}
