import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { MediaInfo } from '../../shared/types'
import { ffprobePath } from './binaries'

const execFileAsync = promisify(execFile)

interface FfprobeStream {
  index: number
  codec_type?: string
  codec_name?: string
  channels?: number
  sample_rate?: string
  bit_rate?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  disposition?: Record<string, number>
  tags?: Record<string, string>
}

interface FfprobeFormat {
  duration?: string
  size?: string
  format_name?: string
  format_long_name?: string
}

interface FfprobeJson {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

function parseRate(value?: string): number | null {
  if (!value) return null
  const [num, den] = value.split('/').map(Number)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  return num / den
}

export async function probeMedia(filePath: string): Promise<MediaInfo> {
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      filePath,
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  )

  const parsed = JSON.parse(stdout) as FfprobeJson
  const streams = parsed.streams ?? []
  const format = parsed.format ?? {}

  const audioStreams = streams
    .filter((stream) => stream.codec_type === 'audio')
    .map((stream) => ({
      index: stream.index,
      codec: stream.codec_name ?? 'unknown',
      channels: stream.channels ?? 0,
      sampleRate: Number(stream.sample_rate ?? 0),
      bitRate: stream.bit_rate ? Number(stream.bit_rate) : null,
      language: stream.tags?.language ?? null,
      isDefault: stream.disposition?.default === 1,
    }))

  const videoStreams = streams
    .filter((stream) => stream.codec_type === 'video')
    .map((stream) => ({
      index: stream.index,
      codec: stream.codec_name ?? 'unknown',
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      frameRate: parseRate(stream.avg_frame_rate),
    }))

  const fileStat = await stat(filePath)
  const duration = Number(format.duration ?? 0)

  return {
    duration: Number.isFinite(duration) ? duration : 0,
    formatName: format.format_long_name ?? format.format_name ?? path.extname(filePath),
    size: Number(format.size ?? fileStat.size),
    audioStreams,
    videoStreams,
  }
}
