import { promises as fs } from 'node:fs'
import path from 'node:path'
import { probeMedia } from '../src/main/media/probe'
import { computePeaks } from '../src/main/media/peaks'
import { exportToFile } from '../src/main/media/export'
import { ffmpegPath, ffprobePath } from '../src/main/media/binaries'
import type { ExportFormat } from '../src/shared/types'

async function main(): Promise<void> {
  const filePath = process.argv[2]
  if (!filePath) throw new Error('usage: media-smoke <file>')

  const info = await probeMedia(filePath)
  const audio = info.audioStreams.find((stream) => stream.isDefault) ?? info.audioStreams[0]
  if (!audio) throw new Error('no audio stream')

  const peaks = await computePeaks(filePath, audio.index, info.duration)
  const end = Math.min(2.5, Math.max(0.7, info.duration - 0.1))
  const formats: ExportFormat[] = ['wav', 'mp3', 'm4a', 'flac']
  const outputs: Array<{
    format: ExportFormat
    duration: number
    size: number
    codec: string | undefined
  }> = []

  for (const format of formats) {
    const outputPath = path.join(process.cwd(), '.fixtures', `vdro-smoke-${format}.${format}`)
    await exportToFile(filePath, outputPath, {
      start: 0.5,
      end,
      format,
      sampleRate: 48000,
      channels: 2,
      bitrate: 192,
      audioStreamIndex: audio.index,
    })
    const outputInfo = await probeMedia(outputPath)
    outputs.push({
      format,
      duration: outputInfo.duration,
      size: outputInfo.size,
      codec: outputInfo.audioStreams[0]?.codec,
    })
    await fs.rm(outputPath, { force: true })
  }

  console.log(
    'MEDIA_SMOKE_OK',
    JSON.stringify({
      ffmpegPath,
      ffprobePath,
      sourceDuration: info.duration,
      audioIndex: audio.index,
      audioCodec: audio.codec,
      peaks: peaks.peaks.length,
      peaksPerSecond: peaks.peaksPerSecond,
      outputs,
    }),
  )
}

main().catch((error) => {
  console.error('MEDIA_SMOKE_ERROR', error)
  process.exitCode = 1
})
