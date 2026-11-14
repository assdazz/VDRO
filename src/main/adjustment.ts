import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AdjustmentRequest, ExtractedClip, MediaInfo } from '../shared/types'
import { extractedRoot } from './storage'
import { loadSettings } from './settings'
import { buildFileName } from './filename'
import { exportToFile } from './media/export'
import { probeMedia } from './media/probe'
import { registerMediaFile, mediaUrl } from './media/protocol'

export function registerAdjustmentIpc(getEntry: (id: string) => { filePath: string; info: MediaInfo }): void {
  const jobs = new Map<string, AbortController>()
  ipcMain.handle('adjustment:cancel', (event, jobId: string) => jobs.get(`${event.sender.id}:${jobId}`)?.abort())
  ipcMain.handle('adjustment:render', async (event, request: AdjustmentRequest) => {
    if (!request || typeof request.jobId !== 'string' || request.jobId.length > 100) throw new Error('调整任务无效')
    const key = `${event.sender.id}:${request.jobId}`
    if (jobs.has(key)) throw new Error('任务已在运行')
    const entry = getEntry(request.mediaId)
    if (!request.effects) throw new Error('缺少音频调整参数')
    if (Array.isArray(request.effects.pitchPoints) && request.effects.pitchPoints.some(point => point && point.time > entry.info.duration + 0.001)) throw new Error('音高标记超出音频范围')
    if (!Number.isFinite(request.start) || !Number.isFinite(request.end) || request.start < 0 || request.end > entry.info.duration + 0.001 || request.end - request.start < 0.02) throw new Error('处理范围无效')
    if (!['wav', 'mp3', 'm4a', 'flac'].includes(request.format) || ![44100, 48000].includes(request.sampleRate) || ![1, 2].includes(request.channels) || (!Number.isFinite(request.bitrate) || request.bitrate < 32 || request.bitrate > 10000)) throw new Error('输出参数无效')
    if (!entry.info.audioStreams.some((stream) => stream.index === request.audioStreamIndex)) throw new Error('找不到音轨')
    const id = randomUUID()
    const stem = path.parse(entry.filePath).name.replace(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i, '')
    const settings = await loadSettings()
    const fileName = buildFileName(settings.filenameTemplate, `${stem}${path.extname(entry.filePath)}`, request.start, request.end, request.format)
    const filePath = path.join(extractedRoot(), `${id}-${fileName}`)
    const controller = new AbortController()
    const abort = () => controller.abort()
    event.sender.once('destroyed', abort)
    jobs.set(key, controller)
    try {
      await exportToFile(entry.filePath, filePath, request, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('adjustment:progress', { jobId: request.jobId, progress })
      }, controller.signal)
      const info = await probeMedia(filePath)
      registerMediaFile(id, filePath)
      return { id, url: mediaUrl(id), filePath, fileName, start: request.start, end: request.end,
        duration: info.duration, size: info.size, format: request.format, sourceMediaId: request.mediaId,
        sourceName: path.basename(entry.filePath), sourceFilePath: entry.filePath } satisfies ExtractedClip
    } catch (error) {
      await fs.rm(filePath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      jobs.delete(key)
      if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', abort)
    }
  })
}
