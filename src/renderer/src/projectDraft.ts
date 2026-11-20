export function readDraft<T>(projectId: string, workspace: string): T | null {
  const text = localStorage.getItem('vdro.project.v1.' + projectId + '.' + workspace)
  return text ? JSON.parse(text) as T : null
}

export type ProjectSaveState = 'saved' | 'error'
export function reportProjectState(projectId: string, workspace: string, state: ProjectSaveState) {
  window.dispatchEvent(new CustomEvent('vdro:project-state', { detail: { projectId, workspace, state } }))
}

export function saveDraft(projectId: string, workspace: string, draft: unknown) {
  try {
    localStorage.setItem('vdro.project.v1.' + projectId + '.' + workspace, JSON.stringify(draft))
    reportProjectState(projectId, workspace, 'saved')
  } catch (error) {
    reportProjectState(projectId, workspace, 'error')
    throw error
  }
}
