import type { PitchPoint } from './types'

export function pitchAt(points: PitchPoint[], time: number, fallback: number): number {
  if (!points.length) return fallback
  if (time <= points[0].time) return points[0].semitones
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1], after = points[index]
    if (time <= after.time) {
      const fraction = (time - before.time) / (after.time - before.time)
      return before.semitones + (after.semitones - before.semitones) * fraction
    }
  }
  return points[points.length - 1].semitones
}

export function sortedPitchPoints(points: PitchPoint[] = []): PitchPoint[] {
  return [...points].sort((a, b) => a.time - b.time)
}
