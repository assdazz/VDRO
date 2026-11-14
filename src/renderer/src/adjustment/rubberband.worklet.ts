import { RubberBandInterface, RubberBandOption as O } from 'rubberband-wasm'

declare const sampleRate: number
declare class AudioWorkletProcessor {
  port: MessagePort
  constructor(options?: unknown)
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

/** Streaming R3 processor. Keep a reserve rather than assuming one input block
 * produces one output block. All WASM buffers are allocated before playback. */
class RubberBandProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitchSemitones', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'formantStrength', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'playbackRate', defaultValue: 1, minValue: .25, maxValue: 4, automationRate: 'k-rate' },
    ]
  }
  rb?: RubberBandInterface
  state = 0
  input = 0
  output = 0
  buffers: number[] = []
  zero = new Float32Array(128)
  reserve = Math.ceil(sampleRate * .085 / 128) * 128
  discard = 0
  primed = false
  started = false
  pendingReset = true
  disposed = false
  pitch = NaN
  formant = -1
  blocks = 0
  underruns = 0
  constructor(options: { processorOptions: { module: WebAssembly.Module } }) {
    super()
    this.port.onmessage = ({ data }) => {
      if (data.type === 'reset') this.pendingReset = true
      if (data.type === 'dispose') { this.disposed = true; this.release() }
    }
    void RubberBandInterface.initialize(options.processorOptions.module).then(rb => {
      if (this.disposed) return
      this.rb = rb
      this.state = rb.rubberband_new(sampleRate, 2, O.RubberBandOptionProcessRealTime |
        O.RubberBandOptionEngineFiner | O.RubberBandOptionWindowShort |
        O.RubberBandOptionThreadingNever | O.RubberBandOptionChannelsTogether |
        O.RubberBandOptionPitchHighConsistency, 1, 1)
      if (!this.state) throw new Error('Rubber Band initialization failed')
      rb.rubberband_set_max_process_size(this.state, 128)
      this.input = rb.malloc(8); this.output = rb.malloc(8)
      this.buffers = [rb.malloc(512), rb.malloc(512), rb.malloc(512), rb.malloc(512)]
      for (let channel = 0; channel < 2; channel++) {
        rb.memWritePtr(this.input + channel * 4, this.buffers[channel])
        rb.memWritePtr(this.output + channel * 4, this.buffers[channel + 2])
      }
      this.port.postMessage({ type: 'ready', engine: 'Rubber Band 3.3.0 R3', latency: this.reserve / sampleRate + rb.rubberband_get_start_delay(this.state) / sampleRate })
    }).catch(error => { this.release(); this.port.postMessage({ type: 'error', message: String(error) }) })
  }
  release() {
    if (!this.rb) return
    if (this.state) this.rb.rubberband_delete(this.state)
    for (const ptr of [this.input, this.output, ...this.buffers]) if (ptr) this.rb.free(ptr)
    this.state = 0; this.rb = undefined
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    if (this.disposed) return false
    const rb = this.rb, output = outputs[0]
    if (!rb || !this.state || !output?.[0]) return true
    const frames = output[0].length
    if (frames !== 128) return true
    const pitch = 2 ** (parameters.pitchSemitones[0] / 12) / parameters.playbackRate[0]
    const formant = parameters.formantStrength[0] >= .5 ? O.RubberBandOptionFormantPreserved : O.RubberBandOptionFormantShifted
    if (this.pendingReset) {
      rb.rubberband_reset(this.state); this.started = false; this.primed = false; this.discard = 0; this.pendingReset = false
      this.pitch = NaN; this.formant = -1
    }
    if (pitch !== this.pitch) { rb.rubberband_set_pitch_scale(this.state, pitch); this.pitch = pitch }
    if (formant !== this.formant) { rb.rubberband_set_formant_option(this.state, formant); this.formant = formant }
    // Prime after reset, using Rubber Band's preferred pad and discard count.
    if (!this.primed) {
      this.primed = true
      rb.memWrite(this.buffers[0], this.zero); rb.memWrite(this.buffers[1], this.zero)
      let pad = rb.rubberband_get_preferred_start_pad(this.state)
      this.discard = rb.rubberband_get_start_delay(this.state)
      while (pad > 0) { const count = Math.min(128, pad); rb.rubberband_process(this.state, this.input, count, 0); pad -= count }
    }
    const input = inputs[0]
    rb.memWrite(this.buffers[0], input?.[0] ?? this.zero)
    rb.memWrite(this.buffers[1], input?.[1] ?? input?.[0] ?? this.zero)
    rb.rubberband_process(this.state, this.input, frames, 0)
    while (this.discard > 0 && rb.rubberband_available(this.state) > 0) {
      const count = Math.min(128, this.discard, rb.rubberband_available(this.state))
      this.discard -= rb.rubberband_retrieve(this.state, this.output, count)
    }
    const available = rb.rubberband_available(this.state)
    if (!this.started && available >= this.reserve) this.started = true
    if (this.started) {
      const count = rb.rubberband_retrieve(this.state, this.output, Math.min(frames, Math.max(0, available)))
      for (let channel = 0; channel < output.length; channel++) output[channel].set(rb.memReadF32(this.buffers[2 + Math.min(channel, 1)], count))
      if (count < frames) { this.underruns++; this.started = false }
    }
    if (++this.blocks % 200 === 0) this.port.postMessage({ type: 'metrics', underruns: this.underruns, buffered: rb.rubberband_available(this.state), blocks: this.blocks })
    return true
  }
}
registerProcessor('vdro-rubberband', RubberBandProcessor)
