import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from 'electron'
import type {
  AppInfo,
  AppSettings,
  ExportCancelled,
  ExportDone,
  ExportError,
  ExportProgress,
  ExportRequest,
  ExportStartResult,
  ExtractedClip,
  ImportedMedia,
  PeaksResult,
  SaveExtractedResult,
  StoredLibraryEntry,
  VdroApi,
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: VdroApi = {
  renderAdjustment: (request) => ipcRenderer.invoke('adjustment:render', request),
  pickMixTracks: (defaultPath) => ipcRenderer.invoke('adjustment:pick-tracks', defaultPath),
  renderMix: (request) => ipcRenderer.invoke('adjustment:mix', request),
  cancelAdjustment: (jobId) => ipcRenderer.invoke('adjustment:cancel', jobId),
  onAdjustmentProgress: (callback) => subscribe('adjustment:progress', callback),
  getDecoderInfo: (mediaUrl) => ipcRenderer.invoke('app:decoder-info', mediaUrl),
  restartApp: (settings) => ipcRenderer.invoke('app:restart', settings),
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke('settings:save', settings) as Promise<void>,
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  chooseDirectory: (defaultPath, purpose) =>
    ipcRenderer.invoke('app:choose-directory', defaultPath, purpose) as Promise<string | null>,
  loadLibrary: () =>
    ipcRenderer.invoke('library:load') as Promise<{
      media: ImportedMedia[]
      missing: string[]
    }>,
  saveLibrary: (entries: StoredLibraryEntry[]) =>
    ipcRenderer.invoke('library:save', entries) as Promise<void>,
  deleteProject: projectId => ipcRenderer.invoke('project:delete', projectId) as Promise<void>,
  loadExtracted: projectId => ipcRenderer.invoke('extracted:load', projectId) as Promise<ExtractedClip[]>,
  saveExtractedClips: (clips: ExtractedClip[], projectId?: string) =>
    ipcRenderer.invoke('extracted:save', clips, projectId) as Promise<void>,
  clearTempFiles: () => ipcRenderer.invoke('app:clear-temp') as Promise<void>,
  clearPeaksCache: () => ipcRenderer.invoke('app:clear-peaks-cache') as Promise<void>,
  getPeaksCacheInfo: () =>
    ipcRenderer.invoke('app:peaks-cache-info') as Promise<{ bytes: number; files: number }>,
  setWindowTranslucent: (enabled: boolean) =>
    ipcRenderer.invoke('window:set-translucent', enabled) as Promise<void>,
  setZoomFactor: (factor: number) =>
    ipcRenderer.invoke('window:set-zoom', factor) as Promise<void>,
  setAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke('window:set-always-on-top', enabled) as Promise<void>,
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder') as Promise<void>,
  openFile: (defaultPath) => ipcRenderer.invoke('media:open', defaultPath) as Promise<ImportedMedia | null>,
  importPath: (filePath: string, projectId?: string) =>
    ipcRenderer.invoke('media:import-path', filePath, projectId) as Promise<ImportedMedia>,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onOpenMedia: (callback: (media: ImportedMedia) => void) =>
    subscribe('app:open-media', callback),
  readPreviewBlock: (id, stream, first, frames) => ipcRenderer.invoke('media:preview-block', id, stream, first, frames),
  getPeaks: (mediaId: string, audioStreamIndex: number) =>
    ipcRenderer.invoke('media:peaks', mediaId, audioStreamIndex) as Promise<PeaksResult>,
  extractAudio: (request: ExportRequest) =>
    ipcRenderer.invoke('media:extract', request) as Promise<ExtractedClip>,
  saveExtracted: (filePath: string, fileName: string) =>
    ipcRenderer.invoke('media:save-extracted', filePath, fileName) as Promise<SaveExtractedResult>,
  deleteExtracted: (clipId: string, filePath: string) =>
    ipcRenderer.invoke('media:delete-extracted', clipId, filePath) as Promise<void>,
  exportAudio: (request: ExportRequest) =>
    ipcRenderer.invoke('media:export', request) as Promise<ExportStartResult>,
  cancelExport: (jobId: string) =>
    ipcRenderer.invoke('media:cancel-export', jobId) as Promise<void>,
  revealFile: (filePath: string) =>
    ipcRenderer.invoke('media:reveal', filePath) as Promise<void>,
  releaseMedia: (mediaId: string) =>
    ipcRenderer.invoke('media:release', mediaId) as Promise<void>,
  onExportProgress: (callback: (payload: ExportProgress) => void) =>
    subscribe('export:progress', callback),
  onExportDone: (callback: (payload: ExportDone) => void) =>
    subscribe('export:done', callback),
  onExportError: (callback: (payload: ExportError) => void) =>
    subscribe('export:error', callback),
  onExportCancelled: (callback: (payload: ExportCancelled) => void) =>
    subscribe('export:cancelled', callback),
}

contextBridge.exposeInMainWorld('vdro', api)
