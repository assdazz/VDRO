import wasmUrl from 'rubberband-wasm/dist/rubberband.wasm?url'
import processorUrl from './rubberband.worklet.ts?worker&url'

let modulePromise: Promise<WebAssembly.Module> | undefined
const worklets = new WeakMap<AudioContext, Promise<void>>()
export class RubberBandNode extends AudioWorkletNode {
  latencySeconds = .15
  metrics = { underruns: 0, buffered: 0, blocks: 0 }
  static async create(context: AudioContext) {
    modulePromise ??= fetch(wasmUrl).then(response => {
      if (!response.ok) throw new Error('无法读取本地 Rubber Band 组件')
      return response.arrayBuffer()
    }).then(bytes => WebAssembly.compile(bytes)).catch(error => { modulePromise = undefined; throw error })
    let worklet = worklets.get(context)
    if (!worklet) {
      worklet = context.audioWorklet.addModule(processorUrl).catch(error => { worklets.delete(context); throw error })
      worklets.set(context, worklet)
    }
    const [module] = await Promise.all([modulePromise, worklet])
    const node = new RubberBandNode(context, 'vdro-rubberband', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { module } })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { node.dispose(); reject(new Error('Rubber Band 初始化超时')) }, 10000)
      node.onprocessorerror = () => { clearTimeout(timer); reject(new Error('Rubber Band 音频线程初始化失败')) }
      node.port.onmessage = ({ data }) => {
        if (data.type === 'ready') { clearTimeout(timer); node.latencySeconds = data.latency; resolve() }
        if (data.type === 'error') { clearTimeout(timer); node.dispose(); reject(new Error(data.message)) }
        if (data.type === 'metrics') node.metrics = data
      }
    })
    return node
  }
  get pitchSemitones() { return this.parameters.get('pitchSemitones')! }
  get formantStrength() { return this.parameters.get('formantStrength')! }
  get playbackRate() { return this.parameters.get('playbackRate')! }
  reset() { this.port.postMessage({ type: 'reset' }) }
  dispose() { this.port.postMessage({ type: 'dispose' }); this.disconnect(); this.port.close() }
}
