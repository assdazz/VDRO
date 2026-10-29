import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PeaksResult } from '../../shared/types'
import { computePeaks } from './peaks'

interface CachePayload extends PeaksResult {
  sourcePath: string
  audioStreamIndex: number
  mtimeMs: number
  size: number
}

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'peaks')
}

function keyFor(filePath: string, audioIndex: number, mtimeMs: number, size: number): string {
  return createHash('sha1')
    .update(`${path.resolve(filePath)}|${audioIndex}|${mtimeMs}|${size}`)
    .digest('hex')
}

function cacheFile(key: string): string {
  return path.join(cacheDir(), `${key}.json`)
}

export async function trimPeaksCache(limitMB: number): Promise<void> {
  if (limitMB <= 0) return

  const entries = await fs.readdir(cacheDir(), { withFileTypes: true }).catch(() => [])
  const files: Array<{ filePath: string; size: number; mtimeMs: number }> = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const filePath = path.join(cacheDir(), entry.name)
    try {
      const stat = await fs.stat(filePath)
      files.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs })
    } catch {
      // Ignore files removed by a concurrent cleanup.
    }
  }

  let total = files.reduce((sum, file) => sum + file.size, 0)
  const limit = limitMB * 1024 * 1024
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const file of files) {
    if (total <= limit) break
    await fs.rm(file.filePath, { force: true })
    total -= file.size
  }
}

export async function getCachedPeaks(
  filePath: string,
  audioIndex: number,
  duration: number,
  limitMB: number,
): Promise<PeaksResult> {
  const stat = await fs.stat(filePath)
  const key = keyFor(filePath, audioIndex, stat.mtimeMs, stat.size)

  try {
    const raw = await fs.readFile(cacheFile(key), 'utf8')
    const payload = JSON.parse(raw) as CachePayload
    if (
      payload.sourcePath === path.resolve(filePath) &&
      payload.audioStreamIndex === audioIndex &&
      payload.mtimeMs === stat.mtimeMs &&
      payload.size === stat.size &&
      Array.isArray(payload.peaks) &&
      payload.peaks.length > 0
    ) {
      return {
        peaks: payload.peaks,
        duration: payload.duration,
        peaksPerSecond: payload.peaksPerSecond,
      }
    }
  } catch {
    // Cache miss or malformed cache entry.
  }

  const result = await computePeaks(filePath, audioIndex, duration)
  const payload: CachePayload = {
    ...result,
    sourcePath: path.resolve(filePath),
    audioStreamIndex: audioIndex,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  }

  try {
    await fs.mkdir(cacheDir(), { recursive: true })
    await fs.writeFile(cacheFile(key), JSON.stringify(payload), 'utf8')
    await trimPeaksCache(limitMB)
  } catch {
    // A cache write failure must not fail waveform generation.
  }

  return result
}

export async function clearPeaksCache(): Promise<void> {
  await fs.rm(cacheDir(), { recursive: true, force: true })
}

export async function getPeaksCacheInfo(): Promise<{ bytes: number; files: number }> {
  const entries = await fs.readdir(cacheDir(), { withFileTypes: true }).catch(() => [])
  let bytes = 0
  let files = 0

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const stat = await fs.stat(path.join(cacheDir(), entry.name))
      bytes += stat.size
      files += 1
    } catch {
      // Ignore disappearing entries.
    }
  }

  return { bytes, files }
}
