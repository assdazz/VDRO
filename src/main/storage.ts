import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExtractedClip, StoredLibraryEntry } from '../shared/types'

function libraryPath(): string {
  return path.join(app.getPath('userData'), 'library.json')
}

function isInsideExtractedRoot(filePath: string): boolean {
  const root = path.resolve(extractedRoot())
  const resolved = path.resolve(filePath)
  return resolved.startsWith(root + path.sep)
}

function extractedMetaPath(): string {
  return path.join(app.getPath('userData'), 'extracted.json')
}

export function extractedRoot(): string {
  return path.join(app.getPath('userData'), 'extracted')
}

export async function loadStoredLibrary(): Promise<StoredLibraryEntry[]> {
  try {
    const raw = await fs.readFile(libraryPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is StoredLibraryEntry =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as StoredLibraryEntry).filePath === 'string' &&
          typeof (item as StoredLibraryEntry).fileName === 'string',
      )
      .map((item) => ({ filePath: item.filePath, fileName: item.fileName }))
  } catch {
    return []
  }
}

export async function saveStoredLibrary(entries: StoredLibraryEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(libraryPath()), { recursive: true })
  await fs.writeFile(
    libraryPath(),
    JSON.stringify(
      entries.map((entry) => ({ filePath: entry.filePath, fileName: entry.fileName })),
      null,
      2,
    ),
    'utf8',
  )
}

export async function loadStoredExtracted(): Promise<ExtractedClip[]> {
  try {
    const raw = await fs.readFile(extractedMetaPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (clip): clip is ExtractedClip =>
        Boolean(clip) &&
        typeof clip === 'object' &&
        typeof (clip as ExtractedClip).id === 'string' &&
        typeof (clip as ExtractedClip).filePath === 'string' &&
        typeof (clip as ExtractedClip).fileName === 'string' &&
        isInsideExtractedRoot((clip as ExtractedClip).filePath),
    )
  } catch {
    return []
  }
}

export async function saveStoredExtracted(clips: ExtractedClip[]): Promise<void> {
  await fs.mkdir(path.dirname(extractedMetaPath()), { recursive: true })
  await fs.writeFile(
    extractedMetaPath(),
    JSON.stringify(
      clips
        .filter((clip) => isInsideExtractedRoot(clip.filePath))
        .map((clip) => ({
          id: clip.id,
          filePath: clip.filePath,
          fileName: clip.fileName,
          start: clip.start,
          end: clip.end,
          duration: clip.duration,
          size: clip.size,
          format: clip.format,
          sourceMediaId: clip.sourceMediaId,
          sourceName: clip.sourceName,
        })),
      null,
      2,
    ),
    'utf8',
  )
}

export async function cleanupExtractedOrphans(): Promise<void> {
  const clips = await loadStoredExtracted()
  const keep = new Set(clips.map((clip) => path.resolve(clip.filePath)))
  const entries = await fs.readdir(extractedRoot(), { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const filePath = path.join(extractedRoot(), entry.name)
    if (!keep.has(path.resolve(filePath))) {
      await fs.rm(filePath, { force: true })
    }
  }
}

export async function cleanupExtractedByPolicy(
  retentionDays: number,
  sizeLimitMB: number,
): Promise<void> {
  const clips = await loadStoredExtracted()
  const now = Date.now()
  const retentionMs = retentionDays > 0 ? retentionDays * 24 * 60 * 60 * 1000 : 0
  const candidates: Array<{ clip: ExtractedClip; mtimeMs: number; size: number }> = []

  for (const clip of clips) {
    try {
      const stat = await fs.stat(clip.filePath)
      if (!stat.isFile()) continue
      if (retentionMs > 0 && now - stat.mtimeMs > retentionMs) {
        await fs.rm(clip.filePath, { force: true })
        continue
      }
      candidates.push({ clip, mtimeMs: stat.mtimeMs, size: stat.size })
    } catch {
      // Missing clips are dropped from metadata.
    }
  }

  const limitBytes = sizeLimitMB > 0 ? sizeLimitMB * 1024 * 1024 : 0
  let total = candidates.reduce((sum, item) => sum + item.size, 0)
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs)

  const keep = new Set<string>()
  for (const item of candidates) {
    if (limitBytes > 0 && total > limitBytes) {
      await fs.rm(item.clip.filePath, { force: true })
      total -= item.size
    } else {
      keep.add(item.clip.id)
    }
  }

  await saveStoredExtracted(clips.filter((clip) => keep.has(clip.id)))

  const entries = await fs.readdir(extractedRoot(), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.part')) continue
    const filePath = path.join(extractedRoot(), entry.name)
    try {
      const stat = await fs.stat(filePath)
      if (retentionMs === 0 || now - stat.mtimeMs > retentionMs) {
        await fs.rm(filePath, { force: true })
      }
    } catch {
      // Ignore disappearing files.
    }
  }
}

export async function clearExtractedFiles(): Promise<void> {
  await fs.rm(extractedRoot(), { recursive: true, force: true })
  await fs.rm(extractedMetaPath(), { force: true })
}
