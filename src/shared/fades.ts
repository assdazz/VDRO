import type { AudioAdjustment } from './types'

export function fadeBounds(effects: AudioAdjustment, start: number, end: number) {
  return effects.fadeRange ?? { start, end }
}

export function fadeLevel(time: number, effects: AudioAdjustment, start: number, end: number) {
  const bounds = fadeBounds(effects, start, end)
  const curve = (value: number) => {
    const x = Math.max(0, Math.min(1, value))
    if (effects.curve === 'qsin') return Math.sin(x * Math.PI / 2)
    if (effects.curve === 'exp') return x === 0 ? 0 : Math.exp(11.512925 * (x - 1))
    return x
  }
  return (effects.fadeIn > 0 ? curve((time - bounds.start) / effects.fadeIn) : 1) *
    (effects.fadeOut > 0 ? curve((bounds.end - time) / effects.fadeOut) : 1)
}
