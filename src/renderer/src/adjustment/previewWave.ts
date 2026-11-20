const HEADER_BYTES = 16 * 1024
const FRAMES_PER_BLOCK = 48_000

async function readRange(url: string, offset: number, count: number) {
  const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + count - 1}` } })
  if (response.status !== 206) {
    await response.body?.cancel()
    throw new Error('无法读取混音试听素材。')
  }
  return new DataView(await response.arrayBuffer())
}

export async function openPreviewWave(url: string) {
  const header = await readRange(url, 0, HEADER_BYTES)
  // Read the format and data chunks without loading the rest of the file.
  if (header.byteLength < 12 || header.getUint32(0) !== 0x52494646 || header.getUint32(8) !== 0x57415645) return null
  let channels = 0, sampleRate = 0
  for (let offset = 12; offset + 8 <= header.byteLength;) {
    const tag = header.getUint32(offset)
    const bytes = header.getUint32(offset + 4, true)
    const start = offset + 8
    if (tag === 0x666d7420 && bytes >= 16 && start + 16 <= header.byteLength) {
      const format = header.getUint16(start, true)
      const pcm = format === 1 || (format === 0xfffe && bytes >= 40 && start + 40 <= header.byteLength && header.getUint32(start + 24, true) === 1)
      channels = header.getUint16(start + 2, true)
      sampleRate = header.getUint32(start + 4, true)
      if (!pcm || ![1, 2].includes(channels) || header.getUint16(start + 14, true) !== 16 ||
        header.getUint16(start + 12, true) !== channels * 2 || sampleRate < 8000 || sampleRate > 96000) return null
    }
    if (tag === 0x64617461 && channels && sampleRate) {
      const frames = Math.floor(bytes / (channels * 2))
      const cache = new Map<number, Promise<AudioBuffer>>()
      return {
        frames,
        sampleRate,
        blockStart: (frame: number) => Math.floor(frame / FRAMES_PER_BLOCK) * FRAMES_PER_BLOCK,
        readBlock(context: AudioContext, firstFrame: number, reversed = false) {
          const key = reversed ? -firstFrame - 1 : firstFrame
          const cached = cache.get(key)
          if (cached) return cached
          const count = Math.min(frames - firstFrame, FRAMES_PER_BLOCK)
          const sourceFrame = reversed ? frames - firstFrame - count : firstFrame
          const pending = readRange(url, start + sourceFrame * channels * 2, count * channels * 2).then(data => {
            if (data.byteLength !== count * channels * 2) throw new Error('无法读取混音试听素材。')
            const buffer = context.createBuffer(channels, count, sampleRate)
            for (let channel = 0; channel < channels; channel++) {
              const samples = buffer.getChannelData(channel)
              for (let frame = 0; frame < count; frame++) {
                const index = reversed ? count - 1 - frame : frame
                samples[frame] = data.getInt16((index * channels + channel) * 2, true) / 32768
              }
            }
            return buffer
          }).catch(error => { cache.delete(key); throw error })
          cache.set(key, pending)
          if (cache.size > 3) cache.delete(cache.keys().next().value!)
          return pending
        },
      }
    }
    offset = start + bytes + (bytes % 2)
  }
  return null
}

export type PreviewWave = NonNullable<Awaited<ReturnType<typeof openPreviewWave>>>
