import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MAX_MIX_OFFSET, MAX_MIX_CLIPS } from '../shared/types'
import type { AdjustmentRequest, ExtractedClip, MediaInfo, MixRequest, MixTrackRequest } from '../shared/types'
import { extractedRoot } from './storage'
import { loadSettings } from './settings'
import { buildFileName } from './filename'
import { exportMixToFile, exportToFile } from './media/export'
import { probeMedia } from './media/probe'
import { registerMediaFile, mediaUrl } from './media/protocol'

type Source = { mediaId: string; filePath: string; info: MediaInfo }
type Encoding = Omit<MixRequest, 'tracks'>

function validateTrack(track: Omit<MixTrackRequest, 'offset'>, info: MediaInfo) {
  if (!track.effects) throw new Error('缺少音频调整参数')
  if (track.effects.fadeRange && track.effects.fadeRange.end > info.duration + 0.001) throw new Error('渐变范围无效')
  if (track.reversed !== undefined && typeof track.reversed !== 'boolean') throw new Error('倒放参数无效')
  if (Array.isArray(track.effects.pitchPoints) && track.effects.pitchPoints.some(point => point && point.time > info.duration + 0.001)) throw new Error('音高标记超出音频范围')
  if (!Number.isFinite(track.start) || !Number.isFinite(track.end) || track.start < 0 || track.end > info.duration + 0.001 || track.end - track.start < 0.02 - 0.000001) throw new Error('处理范围无效')
  if (!info.audioStreams.some(stream => stream.index === track.audioStreamIndex)) throw new Error('找不到音轨')
}

function sourceStart(track: Pick<MixTrackRequest, 'start' | 'end' | 'reversed'>, info: MediaInfo) {
  return track.reversed ? Math.max(0, info.duration - track.end) : track.start
}

export function registerAdjustmentIpc(getEntry: (id: string) => { filePath: string; info: MediaInfo }): void {
  const jobs = new Map<string, AbortController>()

  async function render(
    event: IpcMainInvokeEvent,
    request: Encoding,
    source: Source | null,
    start: number,
    end: number,
    write: (filePath: string, onProgress: (progress: number) => void, signal: AbortSignal) => Promise<void>,
  ): Promise<ExtractedClip> {
    if (typeof request.jobId !== 'string' || !request.jobId || request.jobId.length > 100) throw new Error('调整任务无效')
    if (!['wav', 'mp3', 'm4a', 'flac'].includes(request.format) || ![44100, 48000].includes(request.sampleRate) || ![1, 2].includes(request.channels) || (!Number.isFinite(request.bitrate) || request.bitrate < 32 || request.bitrate > 10000)) throw new Error('输出参数无效')
    const key = `${event.sender.id}:${request.jobId}`
    if (jobs.has(key)) throw new Error('任务已在运行')
    const controller = new AbortController()
    const abort = () => controller.abort()
    event.sender.once('destroyed', abort)
    jobs.set(key, controller)
    const id = randomUUID()
    let filePath: string | undefined
    try {
      const settings = await loadSettings()
      const sourceName = source ? path.basename(source.filePath) : settings.language === 'en-US' ? 'Mix' : '混音'
      const templateSource = sourceName.replace(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i, '')
      const fileName = buildFileName(settings.filenameTemplate, templateSource, start, end, request.format)
      filePath = path.join(extractedRoot(), `${id}-${fileName}`)
      await write(filePath, progress => {
        if (!event.sender.isDestroyed()) event.sender.send('adjustment:progress', { jobId: request.jobId, progress })
      }, controller.signal)
      if (controller.signal.aborted) throw new Error('CANCELLED')
      const info = await probeMedia(filePath)
      if (controller.signal.aborted) throw new Error('CANCELLED')
      registerMediaFile(id, filePath)
      return { id, url: mediaUrl(id), filePath, fileName, start, end,
        duration: info.duration, size: info.size, format: request.format, sourceMediaId: source?.mediaId ?? '',
        sourceName, sourceFilePath: source?.filePath }
    } catch (error) {
      if (filePath) await fs.rm(filePath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      jobs.delete(key)
      if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', abort)
    }
  }

  ipcMain.handle('adjustment:cancel', (event, jobId: string) => jobs.get(`${event.sender.id}:${jobId}`)?.abort())
  ipcMain.handle('adjustment:render', async (event, request: AdjustmentRequest) => {
    if (!request) throw new Error('调整任务无效')
    const entry = getEntry(request.mediaId)
    validateTrack(request, entry.info)
    return render(event, request, { mediaId: request.mediaId, ...entry }, request.start, request.end,
      (filePath, progress, signal) => exportToFile(entry.filePath, filePath, {
        ...request, inputStart: sourceStart(request, entry.info),
      }, progress, signal))
  })
  ipcMain.handle('adjustment:mix', async (event, request: MixRequest) => {
    if (!request || !Array.isArray(request.tracks) || !request.tracks.length || request.tracks.length > MAX_MIX_CLIPS) throw new Error('混音轨道数量无效')
    const tracks = request.tracks.map(track => {
      if (!track || !Number.isFinite(track.offset) || track.offset < 0 || track.offset > MAX_MIX_OFFSET) throw new Error('轨道位置无效')
      const entry = getEntry(track.mediaId)
      validateTrack(track, entry.info)
      return { ...track, filePath: entry.filePath, inputStart: sourceStart(track, entry.info) }
    })
    const end = Math.max(...tracks.map(track => track.offset + track.end - track.start))
    return render(event, request, null, 0, end,
      (filePath, progress, signal) => exportMixToFile(tracks, filePath, request, progress, signal))
  })
}
