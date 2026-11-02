import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '../shared/types'
import { DEFAULT_APP_SETTINGS as DEFAULT_SETTINGS } from '../shared/defaults'
import { sanitizeSettings } from '../shared/settings'
import { writeJson } from './files'
export { sanitizeSettings } from '../shared/settings'
export { DEFAULT_SETTINGS }

function settingsPath(): string { return path.join(app.getPath('userData'), 'settings.json') }

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return sanitizeSettings(DEFAULT_SETTINGS)
  }
}

export async function saveSettings(settings: unknown): Promise<AppSettings> {
  const sanitized = sanitizeSettings(settings)
  await writeJson(settingsPath(), sanitized)
  return sanitized
}

export function getSettingsPath(): string {
  return settingsPath()
}
