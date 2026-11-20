export const MIN_VIDEO_PREVIEW_HEIGHT = 180
export const MIN_TIMELINE_HEIGHT = 184
export const MIN_CLIP_TIME_HEIGHT = 108
export const MIN_RESULTS_HEIGHT = 164
export const PANEL_RESIZER_HEIGHT = 8
export const LAYOUT_STORAGE_KEY = 'vdro.layout.v3'

export interface LayoutSettings {
  inspectorWidth: number
  timelineHeight: number
  clipTimeHeight: number | null
  previewCollapsed: boolean
  timelineCollapsed: boolean
  extractedCollapsed: boolean
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  inspectorWidth: 340,
  timelineHeight: 256,
  clipTimeHeight: null,
  previewCollapsed: false,
  timelineCollapsed: false,
  extractedCollapsed: false,
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, max), Math.max(min, value))
}

function savedSize(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback
}

export function loadLayout(): LayoutSettings {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? window.localStorage.getItem('vdro.layout.v2')
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<LayoutSettings>
    return {
      inspectorWidth: savedSize(parsed.inspectorWidth, DEFAULT_LAYOUT.inspectorWidth, 220, 560),
      timelineHeight: savedSize(parsed.timelineHeight, DEFAULT_LAYOUT.timelineHeight, MIN_TIMELINE_HEIGHT, 660),
      clipTimeHeight: typeof parsed.clipTimeHeight === 'number' && Number.isFinite(parsed.clipTimeHeight)
        ? clamp(parsed.clipTimeHeight, MIN_CLIP_TIME_HEIGHT, 600)
        : null,
      previewCollapsed: parsed.previewCollapsed === true,
      timelineCollapsed: parsed.timelineCollapsed === true,
      extractedCollapsed: parsed.extractedCollapsed === true,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}
