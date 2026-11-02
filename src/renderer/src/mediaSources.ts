import type { ExtractedClip, ImportedMedia } from '@shared/types'

const pathKey = (value: string): string => value.replace(/\//g, '\\').toLowerCase()

export function findClipSource(clip: ExtractedClip, library: ImportedMedia[]): ImportedMedia | undefined {
  if (typeof clip.sourceFilePath === 'string' && clip.sourceFilePath) {
    return library.find((item) => pathKey(item.filePath) === pathKey(clip.sourceFilePath!))
  }
  const liveSource = library.find((item) => item.id === clip.sourceMediaId)
  if (liveSource) return liveSource
  // Legacy metadata had no full source path. Only migrate an unambiguous name.
  const candidates = library.filter((item) => item.fileName === clip.sourceName)
  return candidates.length === 1 ? candidates[0] : undefined
}

export function bindClipSource(clip: ExtractedClip, source?: ImportedMedia): ExtractedClip {
  if (!source || (clip.sourceMediaId === source.id && clip.sourceFilePath === source.filePath)) return clip
  return { ...clip, sourceMediaId: source.id, sourceFilePath: source.filePath }
}
