import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AudioAdjustment, ExportFormat, MixTrackRequest } from '../../shared/types'
import { ffmpegPath } from './binaries'
import { replaceFile } from '../files'
import { adjustmentFilters, pitchCommands } from './adjustmentFilters'

export interface ExportFileOptions {
  effects?: AudioAdjustment
  reversed?: boolean
  inputStart?: number
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

type AudioEncoding = Pick<ExportFileOptions, 'format' | 'sampleRate' | 'channels' | 'bitrate'>

function reverseFilters(duration: number) {
  return [`apad=whole_dur=${duration}`, `atrim=duration=${duration}`, 'areverse', 'asetpts=PTS-STARTPTS']
}

function codecArgs(options: AudioEncoding): string[] {
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
  sourcePath = path.resolve(sourcePath)
  outputPath = path.resolve(outputPath)
  const commands = options.effects ? pitchCommands(options.effects, options.start, duration) : ''
  const commandName = commands ? `${randomUUID()}.pitch` : undefined
  const filters = options.effects ? adjustmentFilters(options.effects, duration, options.start, commandName) : []
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('片段时长无效')
  }
  if (options.reversed) filters.unshift(...reverseFilters(duration), 'apad=pad_dur=0.25')

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const commandPath = commandName ? path.join(path.dirname(outputPath), commandName) : undefined
  const inputArgs = [
    '-ss',
    (options.inputStart ?? options.start).toFixed(6),
    ...(options.reversed ? ['-t', duration.toFixed(6)] : []),
    '-i',
    sourcePath,
    '-t',
    duration.toFixed(6),
    '-map',
    `0:${options.audioStreamIndex}`,
    '-vn',
    ...(filters.length ? ['-af', filters.join(',')] : []),
  ]
  try {
    if (commandPath) await fs.writeFile(commandPath, commands, 'utf8')
    await runAudioExport(inputArgs, outputPath, options, duration, onProgress, signal)
  } finally {
    if (commandPath) await fs.rm(commandPath, { force: true }).catch(() => undefined)
  }
}

export async function exportMixToFile(
  tracks: (MixTrackRequest & { filePath: string; inputStart: number })[],
  outputPath: string,
  options: AudioEncoding,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  outputPath = path.resolve(outputPath)
  const directory = path.dirname(outputPath)
  await fs.mkdir(directory, { recursive: true })
  const commandFiles: string[] = []
  try {
    const inputs: string[] = []
    const graph: string[] = []
    const layout = options.channels === 1 ? 'mono' : 'stereo'
    const audioFormat = `aformat=sample_fmts=fltp:sample_rates=${options.sampleRate}:channel_layouts=${layout}`
    for (const [index, track] of tracks.entries()) {
      const duration = +(track.end - track.start).toFixed(6)
      const offset = +track.offset.toFixed(6)
      const pitchFilter = `rubberband@track${index}`
      const commands = pitchCommands(track.effects, track.start, duration, pitchFilter)
      const commandName = commands ? `${randomUUID()}.pitch` : undefined
      const filters = adjustmentFilters(track.effects, duration, track.start, commandName, pitchFilter)
      if (commandName) {
        const commandFile = path.join(directory, commandName)
        commandFiles.push(commandFile)
        await fs.writeFile(commandFile, commands, 'utf8')
      }
      inputs.push('-ss', track.inputStart.toFixed(6), '-t', duration.toFixed(6), '-i', path.resolve(track.filePath))
      const trackOutput = offset > 0 ? `clip${index}` : `track${index}`
      // Supply lookahead after the trim so Rubber Band can emit the last samples of the clip.
      const inputFilters = track.reversed ? reverseFilters(duration).join(',') : `atrim=duration=${duration}`
      graph.push(`[${index}:${track.audioStreamIndex}]asetpts=PTS-STARTPTS,${inputFilters},apad=pad_dur=0.25,${filters.join(',')},${audioFormat},apad,atrim=duration=${duration},asetpts=N/SR/TB[${trackOutput}]`)
      if (offset > 0) {
        graph.push(`anullsrc=r=${options.sampleRate}:cl=${layout}:d=${offset},${audioFormat}[delay${index}]`)
        graph.push(`[delay${index}][${trackOutput}]concat=n=2:v=0:a=1[track${index}]`)
      }
    }
    const streams = tracks.map((_, index) => `[track${index}]`).join('')
    graph.push(`${streams}amix=inputs=${tracks.length}:duration=longest:normalize=0,alimiter=limit=0.97:level=false:latency=true[mix]`)
    const duration = Math.max(...tracks.map(track => track.offset + track.end - track.start))
    const graphPath = path.join(directory, randomUUID() + '.filters')
    commandFiles.push(graphPath)
    await fs.writeFile(graphPath, graph.join(';'), 'utf8')
    await runAudioExport([...inputs, '-filter_complex_script', graphPath, '-map', '[mix]'], outputPath, options, duration, onProgress, signal)
  } finally {
    await Promise.all(commandFiles.map(file => fs.rm(file, { force: true }).catch(() => undefined)))
  }
}

function runAudioExport(
  inputArgs: string[],
  outputPath: string,
  options: AudioEncoding,
  duration: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('CANCELLED'))
  const tempPath = `${outputPath}.${randomUUID()}.part`
  const args = [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    ...inputArgs,
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

  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      cwd: path.dirname(outputPath),
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
          await replaceFile(tempPath, outputPath)
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
