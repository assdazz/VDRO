export function snapTimelineTime(value: number, anchors: number[], tolerance: number, min = 0, max = Infinity) {
  let time = Math.max(min, Math.min(max, value))
  let distance = tolerance + Number.EPSILON
  let guide: number | undefined
  for (const anchor of anchors) {
    if (!Number.isFinite(anchor) || anchor < min || anchor > max) continue
    const delta = Math.abs(anchor - value)
    if (delta > tolerance || delta >= distance) continue
    time = anchor
    distance = delta
    guide = anchor
  }
  return { time, guide }
}
