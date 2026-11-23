import type { Language } from '@shared/types'
import { translateUiText } from './i18n'

export type MarkerLabel = { number: number; name?: string; color?: string }
export type MarkerLabelEdit = Pick<MarkerLabel, 'name' | 'color'>
export type MarkerLabels = { nextNumber: number; byId: Record<string, MarkerLabel> }

export const DEFAULT_MARKER_COLOR = '#00b8cc'

// Old drafts only recorded positions. Use their saved ordering for the first labels.
export function labelMarkers(ids: readonly string[], previous?: MarkerLabels): MarkerLabels {
  let nextNumber = previous?.nextNumber ?? 1
  const byId = Object.fromEntries(ids.map(id => [id,
    previous && Object.hasOwn(previous.byId, id) ? previous.byId[id] : { number: nextNumber++ },
  ]))
  return { nextNumber, byId }
}

export function updateMarkerLabel(labels: MarkerLabels, id: string, edit: MarkerLabelEdit): MarkerLabels {
  const label = labels.byId[id]
  if (label.name === edit.name && label.color === edit.color) return labels
  return { ...labels, byId: { ...labels.byId, [id]: { ...label, ...edit } } }
}

export function markerName(marker: MarkerLabel, language: Language) {
  return marker.name ?? translateUiText(`标记 ${marker.number}`, language)
}
