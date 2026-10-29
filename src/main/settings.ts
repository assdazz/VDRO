import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AccentColor,
  AppSettings,
  ExportFormat,
  FontScaleSetting,
  Language,
  MaterialColor,
  OutputQualitySetting,
  PreviewFpsSetting,
  PreviewResolutionSetting,
  SaveMode,
  SkipSecondsSetting,
  TempRetentionDays,
  TempSizeLimitMB,
  ThemeMode,
} from '../shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  outputFormat: 'mp3',
  outputQuality: 192,
  sampleRate: 48000,
  channels: 2,
  saveMode: 'ask',
  saveDirectory: '',
  autoSelectExtracted: true,
  skipSeconds: 5,
  customSkipSeconds: 7,
  confirmDelete: true,
  filenameTemplate: '{source}_{start}-{end}',
  waveformCacheLimitMB: 500,
  previewResolution: 'follow',
  previewFps: 'follow',
  previewLoop: false,
  previewVolume: 100,
  previewMuted: false,
  syncExtractedVideo: true,
  restoreLayout: true,
  sidebarCollapsed: false,
  theme: 'dark',
  materialColor: 'blue',
  translucent: false,
  accent: 'yellow',
  uiScale: 100,
  fontScale: 100,
  language: 'zh-CN',
  rememberWindowState: true,
  startMaximized: false,
  alwaysOnTop: false,
  cleanTempOnStartup: true,
  tempRetentionDays: 7,
  tempSizeLimitMB: 2048,
  persistLibrary: false,
  persistExtracted: false,
  shortcuts: {
    play: 'Space',
    setIn: 'I',
    setOut: 'O',
    seekBack: 'ArrowLeft',
    seekForward: 'ArrowRight',
  },
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function oneOf<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function clampScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.uiScale
  return Math.round(Math.min(125, Math.max(90, numeric)) / 5) * 5
}

export function sanitizeSettings(input: unknown): AppSettings {
  const value = input && typeof input === 'object' ? (input as Partial<AppSettings>) : {}
  const shortcuts =
    value.shortcuts && typeof value.shortcuts === 'object'
      ? (value.shortcuts as Partial<AppSettings['shortcuts']>)
      : {}
  const persistLibrary =
    typeof value.persistLibrary === 'boolean'
      ? value.persistLibrary
      : DEFAULT_SETTINGS.persistLibrary
  const persistExtracted =
    persistLibrary &&
    (typeof value.persistExtracted === 'boolean'
      ? value.persistExtracted
      : DEFAULT_SETTINGS.persistExtracted)

  return {
    outputFormat: oneOf<ExportFormat>(
      value.outputFormat,
      ['mp3', 'wav', 'm4a', 'flac'],
      DEFAULT_SETTINGS.outputFormat,
    ),
    outputQuality: oneOf<OutputQualitySetting>(
      value.outputQuality,
      ['native', 96, 128, 192, 256, 320],
      DEFAULT_SETTINGS.outputQuality,
    ),
    sampleRate: oneOf<44100 | 48000>(
      value.sampleRate,
      [44100, 48000],
      DEFAULT_SETTINGS.sampleRate,
    ),
    channels: value.channels === 1 ? 1 : 2,
    saveMode: oneOf<SaveMode>(value.saveMode, ['ask', 'fixed'], DEFAULT_SETTINGS.saveMode),
    saveDirectory: asString(value.saveDirectory, ''),
    autoSelectExtracted:
      typeof value.autoSelectExtracted === 'boolean'
        ? value.autoSelectExtracted
        : DEFAULT_SETTINGS.autoSelectExtracted,
    skipSeconds: oneOf<SkipSecondsSetting>(
      value.skipSeconds,
      [1, 3, 5, 10, 15, 'custom'],
      DEFAULT_SETTINGS.skipSeconds,
    ),
    customSkipSeconds: Number.isFinite(Number(value.customSkipSeconds))
      ? Math.min(600, Math.max(1, Math.round(Number(value.customSkipSeconds))))
      : DEFAULT_SETTINGS.customSkipSeconds,
    confirmDelete:
      typeof value.confirmDelete === 'boolean'
        ? value.confirmDelete
        : DEFAULT_SETTINGS.confirmDelete,
    filenameTemplate: asString(
      value.filenameTemplate,
      DEFAULT_SETTINGS.filenameTemplate,
    ).slice(0, 160),
    waveformCacheLimitMB: oneOf<100 | 500 | 1024 | 0>(
      value.waveformCacheLimitMB,
      [100, 500, 1024, 0],
      DEFAULT_SETTINGS.waveformCacheLimitMB,
    ),
    previewResolution: oneOf<PreviewResolutionSetting>(
      value.previewResolution,
      ['follow', 360, 480, 720, 1080, 1440, 2160],
      DEFAULT_SETTINGS.previewResolution,
    ),
    previewFps: oneOf<PreviewFpsSetting>(
      value.previewFps,
      ['follow', 30, 60, 120, 144],
      DEFAULT_SETTINGS.previewFps,
    ),
    previewLoop:
      typeof value.previewLoop === 'boolean' ? value.previewLoop : DEFAULT_SETTINGS.previewLoop,
    previewVolume: Number.isFinite(Number(value.previewVolume))
      ? Math.min(100, Math.max(0, Math.round(Number(value.previewVolume))))
      : DEFAULT_SETTINGS.previewVolume,
    previewMuted:
      typeof value.previewMuted === 'boolean'
        ? value.previewMuted
        : DEFAULT_SETTINGS.previewMuted,
    syncExtractedVideo:
      typeof value.syncExtractedVideo === 'boolean'
        ? value.syncExtractedVideo
        : DEFAULT_SETTINGS.syncExtractedVideo,
    restoreLayout:
      typeof value.restoreLayout === 'boolean'
        ? value.restoreLayout
        : DEFAULT_SETTINGS.restoreLayout,
    sidebarCollapsed:
      typeof value.sidebarCollapsed === 'boolean'
        ? value.sidebarCollapsed
        : DEFAULT_SETTINGS.sidebarCollapsed,
    theme: oneOf<ThemeMode>(
      value.theme,
      ['dark', 'oled', 'light', 'acrylic'],
      DEFAULT_SETTINGS.theme,
    ),
    materialColor: oneOf<MaterialColor>(
      value.materialColor,
      ['blue', 'violet', 'teal', 'rose', 'amber', 'graphite'],
      DEFAULT_SETTINGS.materialColor,
    ),
    translucent:
      typeof value.translucent === 'boolean'
        ? value.translucent
        : DEFAULT_SETTINGS.translucent,
    accent: oneOf<AccentColor>(
      value.accent,
      ['yellow', 'blue', 'green', 'purple'],
      DEFAULT_SETTINGS.accent,
    ),
    uiScale: clampScale(value.uiScale),
    fontScale: oneOf<FontScaleSetting>(
      value.fontScale,
      [90, 100, 110, 120],
      DEFAULT_SETTINGS.fontScale,
    ),
    language: oneOf<Language>(
      value.language,
      ['zh-CN', 'en-US'],
      DEFAULT_SETTINGS.language,
    ),
    rememberWindowState:
      typeof value.rememberWindowState === 'boolean'
        ? value.rememberWindowState
        : DEFAULT_SETTINGS.rememberWindowState,
    startMaximized:
      typeof value.startMaximized === 'boolean'
        ? value.startMaximized
        : DEFAULT_SETTINGS.startMaximized,
    alwaysOnTop:
      typeof value.alwaysOnTop === 'boolean'
        ? value.alwaysOnTop
        : DEFAULT_SETTINGS.alwaysOnTop,
    cleanTempOnStartup:
      typeof value.cleanTempOnStartup === 'boolean'
        ? value.cleanTempOnStartup
        : DEFAULT_SETTINGS.cleanTempOnStartup,
    tempRetentionDays: oneOf<TempRetentionDays>(
      value.tempRetentionDays,
      [0, 1, 7, 30],
      DEFAULT_SETTINGS.tempRetentionDays,
    ),
    tempSizeLimitMB: oneOf<TempSizeLimitMB>(
      value.tempSizeLimitMB,
      [0, 500, 2048, 5120],
      DEFAULT_SETTINGS.tempSizeLimitMB,
    ),
    persistLibrary,
    persistExtracted,
    shortcuts: {
      play: asString(shortcuts.play, DEFAULT_SETTINGS.shortcuts.play),
      setIn: asString(shortcuts.setIn, DEFAULT_SETTINGS.shortcuts.setIn),
      setOut: asString(shortcuts.setOut, DEFAULT_SETTINGS.shortcuts.setOut),
      seekBack: asString(shortcuts.seekBack, DEFAULT_SETTINGS.shortcuts.seekBack),
      seekForward: asString(
        shortcuts.seekForward,
        DEFAULT_SETTINGS.shortcuts.seekForward,
      ),
    },
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(settings: unknown): Promise<AppSettings> {
  const sanitized = sanitizeSettings(settings)
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(sanitized, null, 2), 'utf8')
  return sanitized
}

export function getSettingsPath(): string {
  return settingsPath()
}
