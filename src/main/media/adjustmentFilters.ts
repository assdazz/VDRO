import type { AudioAdjustment } from '../../shared/types'
import { pitchAt, sortedPitchPoints } from '../../shared/pitch'

export function adjustmentFilters(effects: AudioAdjustment, duration: number, start = 0, commandFile?: string): string[] {
  if (!effects || !Number.isFinite(duration) || duration < 0.02) throw new Error('调整参数无效')
  if (typeof effects.preserveFormants !== 'boolean' || typeof effects.limiter !== 'boolean') throw new Error('调整开关无效')
  for (const [value, min, max] of [[effects.semitones, -12, 12], [effects.gainDb, -24, 12],
    [effects.fadeIn, 0, duration], [effects.fadeOut, 0, duration]]) {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error('音频调整参数超出范围')
  }
  if (effects.fadeIn + effects.fadeOut > duration + 0.000001) throw new Error('渐入与渐出总时长不能超过处理范围')
  if (!['tri', 'qsin', 'exp'].includes(effects.curve)) throw new Error('渐变曲线无效')
  const points = validatedPoints(effects)
  const filters: string[] = []
  const initialPitch = pitchAt(points, start, effects.semitones)
  if (commandFile) filters.push('asetpts=PTS-STARTPTS', `asendcmd=f=${commandFile}`)
  if (initialPitch !== 0 || points.length) filters.push(`rubberband=tempo=1:pitch=${2 ** (initialPitch / 12)}:formant=${effects.preserveFormants ? 'preserved' : 'shifted'}`)
  if (effects.gainDb !== 0) filters.push(`volume=${effects.gainDb}dB`)
  filters.push('apad', `atrim=duration=${duration}`)
  if (effects.fadeIn > 0) filters.push(`afade=t=in:st=0:d=${effects.fadeIn}:curve=${effects.curve}`)
  if (effects.fadeOut > 0) filters.push(`afade=t=out:st=${duration - effects.fadeOut}:d=${effects.fadeOut}:curve=${effects.curve}`)
  if (effects.limiter) filters.push('alimiter=limit=0.97:level=false:latency=true')
  return filters
}

function validatedPoints(effects: AudioAdjustment) {
  if (effects.pitchPoints !== undefined && (!Array.isArray(effects.pitchPoints) || effects.pitchPoints.length > 128)) throw new Error('最多支持 128 个音高标记')
  if (effects.pitchPoints?.some(point => !point || !Number.isFinite(point.time) || point.time < 0 || !Number.isFinite(point.semitones) || Math.abs(point.semitones) > 12)) throw new Error('音高标记参数无效')
  const points = sortedPitchPoints(effects.pitchPoints)
  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    if (index > 0 && point.time - points[index - 1].time < 0.01 - 0.000001) throw new Error('标记间隔至少 0.01 秒')
  }
  return points
}

export function pitchCommands(effects: AudioAdjustment, start: number, duration: number): string {
  const points = validatedPoints(effects)
  if (!points.length) return ''
  const times = new Set([0, duration, ...points.map(point => point.time - start).filter(time => time >= 0 && time <= duration)])
  const step = Math.max(0.02, duration / 60000)
  for (let time = step; time < duration; time += step) times.add(time)
  let previous: number | null = null
  const commands: string[] = []
  for (const time of [...times].sort((a, b) => a - b)) {
    const pitch = pitchAt(points, start + time, effects.semitones)
    if (previous !== null && Math.abs(previous - pitch) < 0.000001) continue
    commands.push(`${time.toFixed(6)} rubberband pitch ${(2 ** (pitch / 12)).toFixed(9)};`)
    previous = pitch
  }
  return commands.join('\n')
}
