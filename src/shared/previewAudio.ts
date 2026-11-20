import type { AudioStreamInfo } from './types'

export const MAX_PREVIEW_BLOCK_FRAMES = 96000

export function previewSampleRate(stream: AudioStreamInfo) {
  return stream.codec === 'pcm_s16le' && stream.sampleRate >= 8000 && stream.sampleRate <= 96000
    ? stream.sampleRate : 48000
}
