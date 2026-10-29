import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AppSettings,
  ExportRequest,
  ExportStartResult,
  ExtractedClip,
  ImportedMedia,
  MediaInfo,
  SaveExtractedResult,
  StoredLibraryEntry,
} from '../shared/types'
import {
  clearPeaksCache,
  getCachedPeaks,
  getPeaksCacheInfo,
  trimPeaksCache,
} from './media/peaksCache'
import { probeMedia } from './media/probe'
import { mediaUrl, registerMediaFile, unregisterMediaFile } from './media/protocol'
import { EXTENSIONS, exportToFile } from './media/export'
import { buildFileName } from './filename'
import { loadSettings, saveSettings } from './settings'
import {
  clearExtractedFiles,
  extractedRoot,
  loadStoredExtracted,
  loadStoredLibrary,
  saveStoredExtracted,
  saveStoredLibrary,
} from './storage'

interface MediaEntry {
  filePath: string
  info: MediaInfo
}

interface ActiveJob {
  controller: AbortController
  outputPath: string
}

const mediaEntries = new Map<string, MediaEntry>()
const activeJobs = new Map<string, ActiveJob>()

async function dialogTitle(zh: string, en: string): Promise<string> {
  const settings = await loadSettings()
  return settings.language === 'en-US' ? en : zh
}

function isExtractedPath(filePath: string): boolean {
  const root = path.resolve(extractedRoot())
  const resolved = path.resolve(filePath)
  return resolved.startsWith(root + path.sep)
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

const MEDIA_FILTERS = [
  {
    name: 'Audio and video',
    extensions: [
      'mp3',
      'wav',
      'flac',
      'm4a',
      'aac',
      'ogg',
      'opus',
      'mp4',
      'm4v',
      'mov',
      'mkv',
      'webm',
    ],
  },
  { name: 'All files', extensions: ['*'] },
]

function sanitizeFileName(input: string): string {
  return input
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function timestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const s = totalSeconds % 60
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  return `${String(h).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(s).padStart(2, '0')}-${String(ms).padStart(3, '0')}`
}

export async function importMedia(filePath: string): Promise<ImportedMedia> {
  if (!path.isAbsolute(filePath)) {
    throw new Error('文件路径必须是绝对路径')
  }

  const fileStat = await fs.stat(filePath)
  if (!fileStat.isFile()) {
    throw new Error('请选择一个文件')
  }

  const info = await probeMedia(filePath)
  const id = randomUUID()
  registerMediaFile(id, filePath)
  mediaEntries.set(id, { filePath, info })

  return {
    id,
    url: mediaUrl(id),
    info,
    fileName: path.basename(filePath),
    filePath,
  }
}

function getMediaEntry(id: string): MediaEntry {
  const entry = mediaEntries.get(id)
  if (!entry) throw new Error('媒体文件已失效，请重新导入')
  return entry
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0] ?? null
}

function sendToWindow(
  window: BrowserWindow | null,
  channel: string,
  payload: unknown,
): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, payload)
  }
}

function validateExport(request: ExportRequest, info: MediaInfo): void {
  if (!Number.isFinite(request.start) || !Number.isFinite(request.end)) {
    throw new Error('片段起止时间无效')
  }
  if (request.start < 0 || request.end <= request.start) {
    throw new Error('片段终点必须大于起点')
  }
  if (request.end > info.duration + 0.001) {
    throw new Error('片段终点超出媒体时长')
  }
  if (request.end - request.start < 0.02) {
    throw new Error('片段太短，至少需要 20ms')
  }
  if (request.sampleRate !== 44100 && request.sampleRate !== 48000) {
    throw new Error('采样率无效')
  }
  if (![1, 2].includes(request.channels)) {
    throw new Error('声道数无效')
  }
  if (!Number.isFinite(request.bitrate) || request.bitrate < 32) {
    throw new Error('码率无效')
  }
}

export function registerIpc(): void {
  ipcMain.handle('media:open', async (event) => {
    const window = senderWindow(event)
    const options: Electron.OpenDialogOptions = {
      title: await dialogTitle('打开音频或视频', 'Open audio or video'),
      properties: ['openFile'],
      filters: MEDIA_FILTERS,
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return await importMedia(result.filePaths[0])
  })

  ipcMain.handle('media:import-path', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('文件路径无效')
    }
    return await importMedia(filePath)
  })

  ipcMain.handle(
    'media:peaks',
    async (_event, mediaId: unknown, audioStreamIndex: unknown) => {
      if (typeof mediaId !== 'string' || typeof audioStreamIndex !== 'number') {
        throw new Error('波形参数无效')
      }
      const entry = getMediaEntry(mediaId)
      const stream = entry.info.audioStreams.find((item) => item.index === audioStreamIndex)
      if (!stream) throw new Error('找不到指定的音频轨道')
      const settings = await loadSettings()
      return await getCachedPeaks(
        entry.filePath,
        stream.index,
        entry.info.duration,
        settings.waveformCacheLimitMB,
      )
    },
  )

  ipcMain.handle('media:extract', async (_event, request: ExportRequest) => {
    if (!request || typeof request !== 'object') {
      throw new Error('提取参数无效')
    }

    const entry = getMediaEntry(request.mediaId)
    validateExport(request, entry.info)

    const extension = EXTENSIONS[request.format]
    if (!extension) throw new Error('不支持的提取格式')

    const root = extractedRoot()
    await fs.mkdir(root, { recursive: true })

    const clipId = randomUUID()
    const settings = await loadSettings()
    const clipFileName = buildFileName(
      settings.filenameTemplate,
      entry.filePath,
      request.start,
      request.end,
      extension,
    )
    const filePath = path.join(root, `${clipId}-${clipFileName}`)

    await exportToFile(entry.filePath, filePath, {
      start: request.start,
      end: request.end,
      format: request.format,
      sampleRate: request.sampleRate,
      channels: request.channels,
      bitrate: request.bitrate,
      audioStreamIndex: request.audioStreamIndex,
    })

    const fileStat = await fs.stat(filePath)
    registerMediaFile(clipId, filePath)

    const clip: ExtractedClip = {
      id: clipId,
      url: mediaUrl(clipId),
      filePath,
      fileName: clipFileName,
      start: request.start,
      end: request.end,
      duration: request.end - request.start,
      size: fileStat.size,
      format: request.format,
      sourceMediaId: request.mediaId,
      sourceName: path.basename(entry.filePath),
    }
    return clip
  })

  ipcMain.handle(
    'media:save-extracted',
    async (event, filePath: unknown, fileName: unknown) => {
      if (typeof filePath !== 'string' || !isExtractedPath(filePath)) {
        throw new Error('提取文件路径无效')
      }
      if (typeof fileName !== 'string' || !fileName) {
        throw new Error('文件名无效')
      }

      const safeFileName = sanitizeFileName(path.basename(fileName))
      if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
        throw new Error('文件名无效')
      }

      const fileStat = await fs.stat(filePath).catch(() => null)
      if (!fileStat?.isFile()) throw new Error('提取文件已不存在')

      const extension = path.extname(safeFileName).replace('.', '') || 'wav'
      const saveFileName = path.extname(safeFileName)
        ? safeFileName
        : `${safeFileName}.${extension}`
      const settings = await loadSettings()
      if (settings.saveMode === 'fixed' && settings.saveDirectory) {
        try {
          const directoryStat = await fs.stat(settings.saveDirectory)
          if (directoryStat.isDirectory()) {
            let targetPath = path.join(settings.saveDirectory, saveFileName)
            let index = 1
            while (await fs.stat(targetPath).catch(() => null)) {
              const stem = path.basename(saveFileName, path.extname(saveFileName))
              targetPath = path.join(
                settings.saveDirectory,
                `${stem} (${index})${path.extname(saveFileName)}`,
              )
              index += 1
            }
            await fs.copyFile(filePath, targetPath)
            return { canceled: false, filePath: targetPath } satisfies SaveExtractedResult
          }
        } catch {
          // Invalid fixed directory: fall back to the save dialog.
        }
      }

      const window = senderWindow(event)
      const options: Electron.SaveDialogOptions = {
        title: await dialogTitle('保存已提取音频', 'Save extracted audio'),
        defaultPath: path.join(settings.saveDirectory || app.getPath('downloads'), saveFileName),
        filters: [{ name: `${extension.toUpperCase()} audio`, extensions: [extension] }],
      }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)

      if (result.canceled || !result.filePath) {
        return { canceled: true } satisfies SaveExtractedResult
      }

      const targetPath = result.filePath.toLowerCase().endsWith(`.${extension}`)
        ? result.filePath
        : `${result.filePath}.${extension}`
      await fs.copyFile(filePath, targetPath)
      return { canceled: false, filePath: targetPath } satisfies SaveExtractedResult
    },
  )

  ipcMain.handle(
    'media:delete-extracted',
    async (_event, clipId: unknown, filePath: unknown) => {
      if (typeof clipId !== 'string' || typeof filePath !== 'string') {
        throw new Error('删除参数无效')
      }
      if (!isExtractedPath(filePath)) {
        throw new Error('提取文件路径无效')
      }
      await fs.rm(filePath, { force: true })
      unregisterMediaFile(clipId)
    },
  )

  ipcMain.handle('media:export', async (event, request: ExportRequest) => {
    if (!request || typeof request !== 'object') {
      throw new Error('导出参数无效')
    }

    const entry = getMediaEntry(request.mediaId)
    validateExport(request, entry.info)

    const format = request.format
    const extension = EXTENSIONS[format]
    if (!extension) throw new Error('不支持的导出格式')

    const window = senderWindow(event)
    const exportSettings = await loadSettings()
    const defaultName = buildFileName(
      exportSettings.filenameTemplate,
      entry.filePath,
      request.start,
      request.end,
      extension,
    )
    const defaultPath = path.join(
      exportSettings.saveDirectory || path.dirname(entry.filePath),
      defaultName,
    )

    const options: Electron.SaveDialogOptions = {
      title: await dialogTitle('导出音频片段', 'Export audio clip'),
      defaultPath,
      filters: [
        {
          name: `${format.toUpperCase()} audio`,
          extensions: [extension],
        },
      ],
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return { canceled: true } satisfies ExportStartResult
    }

    const outputPath = result.filePath.toLowerCase().endsWith(`.${extension}`)
      ? result.filePath
      : `${result.filePath}.${extension}`

    if (samePath(outputPath, entry.filePath)) {
      throw new Error('输出文件不能覆盖源文件，请换一个文件名')
    }

    const jobId = randomUUID()
    const controller = new AbortController()
    activeJobs.set(jobId, { controller, outputPath })

    void exportToFile(
      entry.filePath,
      outputPath,
      {
        start: request.start,
        end: request.end,
        format,
        sampleRate: request.sampleRate,
        channels: request.channels,
        bitrate: request.bitrate,
        audioStreamIndex: request.audioStreamIndex,
      },
      (progress) => {
        sendToWindow(window, 'export:progress', { jobId, progress, outputPath })
      },
      controller.signal,
    )
      .then(() => {
        sendToWindow(window, 'export:done', { jobId, outputPath })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (message === 'CANCELLED') {
          sendToWindow(window, 'export:cancelled', { jobId })
        } else {
          sendToWindow(window, 'export:error', {
            jobId,
            message: message.slice(0, 600),
          })
        }
      })
      .finally(() => {
        activeJobs.delete(jobId)
      })

    return { canceled: false, jobId, outputPath } satisfies ExportStartResult
  })

  ipcMain.handle('media:cancel-export', async (_event, jobId: unknown) => {
    if (typeof jobId !== 'string') return
    activeJobs.get(jobId)?.controller.abort()
  })

  ipcMain.handle('media:release', (_event, mediaId: unknown) => {
    if (typeof mediaId !== 'string' || !mediaId) return
    mediaEntries.delete(mediaId)
    unregisterMediaFile(mediaId)
  })

  ipcMain.handle('media:reveal', async (_event, filePath: unknown) => {
    if (typeof filePath === 'string' && filePath) {
      shell.showItemInFolder(filePath)
    }
  })

  ipcMain.handle('settings:get', async () => loadSettings())

  ipcMain.handle('settings:save', async (_event, settings: unknown) => {
    const saved = await saveSettings(settings)
    await trimPeaksCache(saved.waveformCacheLimitMB)
  })

  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    userDataPath: app.getPath('userData'),
  }))

  ipcMain.handle('app:choose-directory', async (event, defaultPath: unknown) => {
    const window = senderWindow(event)
    const options: Electron.OpenDialogOptions = {
      title: await dialogTitle('选择默认保存目录', 'Choose default save folder'),
      defaultPath: typeof defaultPath === 'string' && defaultPath ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('library:load', async () => {
    const entries = await loadStoredLibrary()
    const media: ImportedMedia[] = []
    const missing: string[] = []

    for (const entry of entries) {
      try {
        const stat = await fs.stat(entry.filePath)
        if (!stat.isFile()) throw new Error('missing')
        media.push(await importMedia(entry.filePath))
      } catch {
        missing.push(entry.filePath)
      }
    }

    return { media, missing }
  })

  ipcMain.handle('library:save', async (_event, entries: unknown) => {
    if (!Array.isArray(entries)) return
    const sanitized: StoredLibraryEntry[] = entries
      .filter(
        (entry): entry is StoredLibraryEntry =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as StoredLibraryEntry).filePath === 'string' &&
          typeof (entry as StoredLibraryEntry).fileName === 'string',
      )
      .map((entry) => ({ filePath: entry.filePath, fileName: entry.fileName }))
    await saveStoredLibrary(sanitized)
  })

  ipcMain.handle('extracted:load', async () => {
    const stored = await loadStoredExtracted()
    const clips: ExtractedClip[] = []

    for (const clip of stored) {
      try {
        const stat = await fs.stat(clip.filePath)
        if (!stat.isFile()) continue
        registerMediaFile(clip.id, clip.filePath)
        clips.push({ ...clip, url: mediaUrl(clip.id), size: stat.size })
      } catch {
        // Ignore clips whose temporary file disappeared.
      }
    }

    return clips
  })

  ipcMain.handle('extracted:save', async (_event, clips: unknown) => {
    if (!Array.isArray(clips)) return
    await saveStoredExtracted(clips as ExtractedClip[])
  })

  ipcMain.handle('app:clear-temp', async () => {
    const stored = await loadStoredExtracted()
    for (const clip of stored) {
      unregisterMediaFile(clip.id)
    }
    await clearExtractedFiles()
  })

  ipcMain.handle('app:clear-peaks-cache', async () => {
    await clearPeaksCache()
  })

  ipcMain.handle('app:peaks-cache-info', async () => getPeaksCacheInfo())

  ipcMain.handle('window:set-zoom', async (event, factor: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return
    const numeric = typeof factor === 'number' ? factor : Number(factor)
    if (!Number.isFinite(numeric)) return
    window.webContents.setZoomFactor(Math.min(1.5, Math.max(0.75, numeric)))
  })

  ipcMain.handle('window:set-always-on-top', async (event, enabled: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return
    window.setAlwaysOnTop(enabled === true)
  })

  ipcMain.handle('app:open-data-folder', async () => {
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new Error(error)
  })

  ipcMain.handle('window:set-translucent', async (_event, enabled: unknown) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window || window.isDestroyed()) return
    const on = enabled === true
    try {
      window.setOpacity(on ? 0.88 : 1)
    } catch {
      // Opacity is not supported by every window manager.
    }
    try {
      window.setBackgroundMaterial('none')
    } catch {
      // Native materials are only available on Windows 11.
    }
  })
}
