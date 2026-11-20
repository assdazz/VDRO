import type { ExtractedClip, ImportedMedia } from '@shared/types'

import { projectMediaId } from './projectDraft'

const pathKey = (value: string): string => value.replace(/\//g, '\\').toLowerCase()

export function findClipSource(clip: ExtractedClip, library: ImportedMedia[]): ImportedMedia | undefined {
  const liveSource = library.find(item => item.id === clip.sourceMediaId)
  if (liveSource) return liveSource
  if (clip.sourceProjectMediaId) {
    return library.find(item => projectMediaId(item) === clip.sourceProjectMediaId)
  }
  // Old results can be linked by path or name only when the match is unique.
  const candidates = clip.sourceFilePath
    ? library.filter(item => pathKey(item.filePath) === pathKey(clip.sourceFilePath!))
    : library.filter(item => item.fileName === clip.sourceName)
  return candidates.length === 1 ? candidates[0] : undefined
}

export function bindClipSource(clip: ExtractedClip, source?: ImportedMedia): ExtractedClip {
  if (!source) return clip
  const sourceProjectMediaId = projectMediaId(source)
  if (clip.sourceMediaId === source.id && clip.sourceFilePath === source.filePath &&
    clip.sourceProjectMediaId === sourceProjectMediaId) return clip
  return { ...clip, sourceMediaId: source.id, sourceFilePath: source.filePath, sourceProjectMediaId }
}
