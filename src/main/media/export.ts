import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExportFormat } from '../../shared/types'
import { ffmpegPath } from './binaries'

export interface ExportFileOptions {
  start: number
  end: number
  format: ExportFormat
  sampleRate: number
  channels: 1 | 2
  bitrate: number
  audioStreamIndex: number
}

const MUXERS: Record<ExportFormat, string> = {
  wav: 'wav',
  mp3: 'mp3',
  m4a: 'mp4',
  flac: 'flac',
}

export const EXTENSIONS: Record<ExportFormat, string> = {
  wav: 'wav',
  mp3: 'mp3',
  m4a: 'm4a',
  flac: 'flac',
}

function codecArgs(options: ExportFileOptions): string[] {
  switch (options.format) {
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${options.bitrate}k`]
    case 'm4a':
      return [
        '-c:a',
        'aac',
        '-b:a',
        `${options.bitrate}k`,
        '-movflags',
        '+faststart',
      ]
    case 'flac':
      return ['-c:a', 'flac', '-compression_level', '8']
  }
}

export async function exportToFile(
  sourcePath: string,
  outputPath: string,
  options: ExportFileOptions,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const duration = options.end - options.start
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('片段时长无效')
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const tempPath = `${outputPath}.${randomUUID()}.part`

  const args = [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-ss',
    options.start.toFixed(6),
    '-i',
    sourcePath,
    '-t',
    duration.toFixed(6),
    '-map',
    `0:${options.audioStreamIndex}`,
    '-vn',
    '-ac',
    String(options.channels),
    '-ar',
    String(options.sampleRate),
    ...codecArgs(options),
    '-f',
    MUXERS[options.format],
    '-progress',
    'pipe:1',
    '-nostats',
    '-y',
    tempPath,
  ]

  return await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    let progressBuffer = ''
    let aborted = false

    const cleanup = async (): Promise<void> => {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }

    const onAbort = (): void => {
      aborted = true
      child.kill()
    }

    if (signal?.aborted) {
      onAbort()
    } else {
      signal?.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (text: string) => {
      progressBuffer += text
      const lines = progressBuffer.split('\n')
      progressBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('out_time_us=')) continue
        const microseconds = Number(line.slice('out_time_us='.length))
        if (!Number.isFinite(microseconds)) continue
        const percent = Math.min(
          99,
          Math.max(0, Math.round((microseconds / 1_000_000 / duration) * 100)),
        )
        onProgress?.(percent)
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 12000) stderr += chunk.toString()
    })

    child.once('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      void cleanup().finally(() => reject(error))
    })

    child.once('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      void (async () => {
        if (aborted) {
          await cleanup()
          reject(new Error('CANCELLED'))
          return
        }

        if (code !== 0) {
          await cleanup()
          reject(new Error(stderr.trim() || `FFmpeg 退出码 ${code}`))
          return
        }

        try {
          await fs.rm(outputPath, { force: true })
          await fs.rename(tempPath, outputPath)
          onProgress?.(100)
          resolve()
        } catch (error) {
          await cleanup()
          reject(error)
        }
      })()
    })
  })
}
