export const MIN_VIDEO_PREVIEW_HEIGHT = 180
export const WORKSPACE_VERTICAL_PADDING = 16
export const MIN_VIDEO_AREA_HEIGHT =
  MIN_VIDEO_PREVIEW_HEIGHT + WORKSPACE_VERTICAL_PADDING
export const PANEL_RESIZER_HEIGHT = 18
export const FIXED_AUDIO_HEIGHT = 268
export const AUDIO_COLLAPSED_HEIGHT = 48
export const AUDIO_EXPAND_DELTA = FIXED_AUDIO_HEIGHT - AUDIO_COLLAPSED_HEIGHT
export const PREVIEW_COLLAPSED_HEIGHT = 60
export const MIN_EDITOR_TOP_HEIGHT =
  MIN_VIDEO_AREA_HEIGHT + FIXED_AUDIO_HEIGHT + PANEL_RESIZER_HEIGHT

export function containedPanelHeight(panel: HTMLElement, main: HTMLElement): number {
  const margin = (element: Element): number => {
    const style = getComputedStyle(element)
    return (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0)
  }
  // Reserve every following sibling, including the handle and export status bar.
  let reserved = parseFloat(getComputedStyle(panel).marginBottom) || 0
  for (let sibling = panel.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    reserved += sibling.getBoundingClientRect().height + margin(sibling)
  }
  const bottom = Math.min(main.getBoundingClientRect().bottom, window.innerHeight)
  return Math.max(120, Math.floor(bottom - panel.getBoundingClientRect().top - reserved - 2))
}

export const LAYOUT_STORAGE_KEY = 'vdro.layout.v1'

export interface LayoutSettings {
  inspectorWidth: number
  extractedRatio: number
  previewCollapsed: boolean
  timelineCollapsed: boolean
  extractedCollapsed: boolean
  soloHeight: number | null
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  inspectorWidth: 340,
  extractedRatio: 1 / 3,
  previewCollapsed: false,
  timelineCollapsed: false,
  extractedCollapsed: false,
  soloHeight: null,
}

export function loadLayout(): LayoutSettings {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<LayoutSettings>
    return {
      inspectorWidth: clamp(
        Number(parsed.inspectorWidth) || DEFAULT_LAYOUT.inspectorWidth,
        240,
        560,
      ),
      extractedRatio: clamp(
        Number(parsed.extractedRatio) || DEFAULT_LAYOUT.extractedRatio,
        0.18,
        0.55,
      ),
      previewCollapsed: parsed.previewCollapsed === true,
      timelineCollapsed: parsed.timelineCollapsed === true,
      extractedCollapsed: parsed.extractedCollapsed === true,
      soloHeight:
        typeof parsed.soloHeight === 'number' && Number.isFinite(parsed.soloHeight)
          ? clamp(parsed.soloHeight, 120, 760)
          : null,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}


export function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }

export function editorMinimum(previewCollapsed: boolean, timelineCollapsed: boolean): number {
  return (previewCollapsed ? PREVIEW_COLLAPSED_HEIGHT : MIN_VIDEO_AREA_HEIGHT) +
    (timelineCollapsed ? AUDIO_COLLAPSED_HEIGHT : FIXED_AUDIO_HEIGHT) +
    (previewCollapsed ? 0 : PANEL_RESIZER_HEIGHT)
}

export const PANEL_CSS = {
  '--panel-audio-height': FIXED_AUDIO_HEIGHT + 'px',
  '--panel-audio-collapsed': AUDIO_COLLAPSED_HEIGHT + 'px',
  '--panel-video-min': MIN_VIDEO_PREVIEW_HEIGHT + 'px',
  '--panel-workspace-min': MIN_VIDEO_AREA_HEIGHT + 'px',
  '--panel-preview-collapsed': PREVIEW_COLLAPSED_HEIGHT + 'px',
  '--panel-folded-top': (PREVIEW_COLLAPSED_HEIGHT + AUDIO_COLLAPSED_HEIGHT) + 'px',
}
