import type { ImportedMedia } from '@shared/types'

export type ProjectMediaEntry = { id: string; filePath: string }

export function projectMediaId(media: ImportedMedia) {
  return media.projectMediaId ?? media.id
}

export function projectMediaEntry(media: ImportedMedia): ProjectMediaEntry {
  return { id: projectMediaId(media), filePath: media.filePath }
}

function draftKey(projectId: string, workspace: string) {
  return 'vdro.project.v1.' + projectId + '.' + workspace
}

export function deleteProjectDrafts(projectId: string) {
  localStorage.removeItem(draftKey(projectId, 'clip'))
  localStorage.removeItem(draftKey(projectId, 'adjust'))
}

export function readDraft<T>(projectId: string, workspace: string): T | null {
  const text = localStorage.getItem(draftKey(projectId, workspace))
  return text ? JSON.parse(text) as T : null
}

export type ProjectSaveState = 'saved' | 'error'
export function reportProjectState(projectId: string, workspace: string, state: ProjectSaveState) {
  window.dispatchEvent(new CustomEvent('vdro:project-state', { detail: { projectId, workspace, state } }))
}

export function saveDraft(projectId: string, workspace: string, draft: unknown) {
  try {
    localStorage.setItem(draftKey(projectId, workspace), JSON.stringify(draft))
    reportProjectState(projectId, workspace, 'saved')
  } catch (error) {
    reportProjectState(projectId, workspace, 'error')
    throw error
  }
}
