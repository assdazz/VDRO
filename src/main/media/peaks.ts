import { spawn } from 'node:child_process'
import type { PeaksResult } from '../../shared/types'
import { ffmpegPath } from './binaries'

const SAMPLE_RATE = 8000

function choosePeaksPerSecond(duration: number): number {
  if (duration > 7200) return 8
  if (duration > 1800) return 20
  return 40
}

export async function computePeaks(
  filePath: string,
  audioStreamIndex: number,
  duration: number,
): Promise<PeaksResult> {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('无法读取媒体时长')
  }

  const peaksPerSecond = choosePeaksPerSecond(duration)
  const samplesPerBucket = Math.max(1, Math.round(SAMPLE_RATE / peaksPerSecond))

  const args = [
    '-v',
    'error',
    '-i',
    filePath,
    '-map',
    `0:${audioStreamIndex}`,
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    '-f',
    's16le',
    'pipe:1',
  ]

  return await new Promise<PeaksResult>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const peaks: number[] = []
    let remainder = Buffer.alloc(0)
    let bucketMin = 0
    let bucketMax = 0
    let bucketCount = 0
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      const buffer = remainder.length ? Buffer.concat([remainder, chunk]) : chunk
      const usable = buffer.length - (buffer.length % 2)

      for (let i = 0; i < usable; i += 2) {
        const value = buffer.readInt16LE(i) / 32768
        if (value < bucketMin) bucketMin = value
        if (value > bucketMax) bucketMax = value
        bucketCount += 1

        if (bucketCount >= samplesPerBucket) {
          peaks.push(bucketMin, bucketMax)
          bucketMin = 0
          bucketMax = 0
          bucketCount = 0
        }
      }

      remainder = Buffer.from(buffer.subarray(usable))
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8000) stderr += chunk.toString()
    })

    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `FFmpeg 退出码 ${code}`))
        return
      }
      if (bucketCount > 0) peaks.push(bucketMin, bucketMax)
      resolve({ peaks, duration, peaksPerSecond })
    })
  })
}
