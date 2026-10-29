export interface AudioStreamInfo {
  index: number
  codec: string
  channels: number
  sampleRate: number
  bitRate: number | null
  language: string | null
  isDefault: boolean
}

export interface VideoStreamInfo {
  index: number
  codec: string
  width: number
  height: number
  frameRate: number | null
}

export interface MediaInfo {
  duration: number
  formatName: string
  size: number
  audioStreams: AudioStreamInfo[]
  videoStreams: VideoStreamInfo[]
}

export interface ImportedMedia {
  id: string
  url: string
  info: MediaInfo
  fileName: string
  filePath: string
}

export interface RegionRange {
  start: number
  end: number
}

export interface PeaksResult {
  peaks: number[]
  duration: number
  peaksPerSecond: number
}

export type ExportFormat = 'wav' | 'mp3' | 'm4a' | 'flac'

export interface ExportRequest {
  mediaId: string
  start: number
  end: number
  format: ExportFormat
  sampleRate: number
  channels: 1 | 2
  bitrate: number
  audioStreamIndex: number
}

export interface ExportStartResult {
  canceled: boolean
  jobId?: string
  outputPath?: string
}

export interface ExtractedClip {
  id: string
  url: string
  filePath: string
  fileName: string
  start: number
  end: number
  duration: number
  size: number
  format: ExportFormat
  sourceMediaId: string
  sourceName: string
}

export interface SaveExtractedResult {
  canceled: boolean
  filePath?: string
}

export interface ExportProgress {
  jobId: string
  progress: number
  outputPath: string
}

export interface ExportDone {
  jobId: string
  outputPath: string
}

export interface ExportError {
  jobId: string
  message: string
}

export interface ExportCancelled {
  jobId: string
}

export type AccentColor = 'yellow' | 'blue' | 'green' | 'purple'
export type ThemeMode = 'dark' | 'oled' | 'light' | 'acrylic'
export type MaterialColor = 'blue' | 'violet' | 'teal' | 'rose' | 'amber' | 'graphite'
export type SaveMode = 'ask' | 'fixed'
export type PreviewResolutionSetting = 'follow' | 360 | 480 | 720 | 1080 | 1440 | 2160
export type PreviewFpsSetting = 'follow' | 30 | 60 | 120 | 144
export type OutputQualitySetting = 'native' | 96 | 128 | 192 | 256 | 320
export type SkipSecondsSetting = 1 | 3 | 5 | 10 | 15 | 'custom'
export type FontScaleSetting = 90 | 100 | 110 | 120
export type Language = 'zh-CN' | 'en-US'
export type TempRetentionDays = 0 | 1 | 7 | 30
export type TempSizeLimitMB = 0 | 500 | 2048 | 5120

export interface ShortcutSettings {
  play: string
  setIn: string
  setOut: string
  seekBack: string
  seekForward: string
}

export interface AppSettings {
  outputFormat: ExportFormat
  outputQuality: OutputQualitySetting
  sampleRate: 44100 | 48000
  channels: 1 | 2
  saveMode: SaveMode
  saveDirectory: string
  autoSelectExtracted: boolean
  skipSeconds: SkipSecondsSetting
  customSkipSeconds: number
  confirmDelete: boolean
  filenameTemplate: string
  waveformCacheLimitMB: 100 | 500 | 1024 | 0
  previewResolution: PreviewResolutionSetting
  previewFps: PreviewFpsSetting
  previewLoop: boolean
  previewVolume: number
  previewMuted: boolean
  syncExtractedVideo: boolean
  restoreLayout: boolean
  sidebarCollapsed: boolean
  theme: ThemeMode
  materialColor: MaterialColor
  translucent: boolean
  accent: AccentColor
  uiScale: number
  fontScale: FontScaleSetting
  language: Language
  rememberWindowState: boolean
  startMaximized: boolean
  alwaysOnTop: boolean
  cleanTempOnStartup: boolean
  tempRetentionDays: TempRetentionDays
  tempSizeLimitMB: TempSizeLimitMB
  persistLibrary: boolean
  persistExtracted: boolean
  shortcuts: ShortcutSettings
}

export interface StoredLibraryEntry {
  filePath: string
  fileName: string
}

export interface AppInfo {
  version: string
  userDataPath: string
}

export interface VdroApi {
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<void>
  getAppInfo: () => Promise<AppInfo>
  chooseDirectory: (defaultPath?: string) => Promise<string | null>
  loadLibrary: () => Promise<{ media: ImportedMedia[]; missing: string[] }>
  saveLibrary: (entries: StoredLibraryEntry[]) => Promise<void>
  loadExtracted: () => Promise<ExtractedClip[]>
  saveExtractedClips: (clips: ExtractedClip[]) => Promise<void>
  clearTempFiles: () => Promise<void>
  clearPeaksCache: () => Promise<void>
  getPeaksCacheInfo: () => Promise<{ bytes: number; files: number }>
  setWindowTranslucent: (enabled: boolean) => Promise<void>
  setZoomFactor: (factor: number) => Promise<void>
  setAlwaysOnTop: (enabled: boolean) => Promise<void>
  openDataFolder: () => Promise<void>
  openFile: () => Promise<ImportedMedia | null>
  importPath: (filePath: string) => Promise<ImportedMedia>
  getPathForFile: (file: File) => string
  onOpenMedia: (callback: (media: ImportedMedia) => void) => () => void
  getPeaks: (mediaId: string, audioStreamIndex: number) => Promise<PeaksResult>
  extractAudio: (request: ExportRequest) => Promise<ExtractedClip>
  saveExtracted: (filePath: string, fileName: string) => Promise<SaveExtractedResult>
  deleteExtracted: (clipId: string, filePath: string) => Promise<void>
  exportAudio: (request: ExportRequest) => Promise<ExportStartResult>
  cancelExport: (jobId: string) => Promise<void>
  revealFile: (filePath: string) => Promise<void>
  releaseMedia: (mediaId: string) => Promise<void>
  onExportProgress: (callback: (payload: ExportProgress) => void) => () => void
  onExportDone: (callback: (payload: ExportDone) => void) => () => void
  onExportError: (callback: (payload: ExportError) => void) => () => void
  onExportCancelled: (callback: (payload: ExportCancelled) => void) => () => void
}
