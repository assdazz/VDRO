import { useEffect, useState } from 'react'
import type { AppSettings, AudioAdjustment, ExportFormat, OutputQualitySetting } from '@shared/types'

export function defaultAdjustment(settings: AppSettings): AudioAdjustment {
  return {
    semitones: 0,
    gainDb: 0,
    fadeIn: 0,
    fadeOut: 0,
    curve: 'tri',
    preserveFormants: settings.adjustmentPreserveFormants,
    limiter: settings.adjustmentLimiter,
  }
}

const formats: ExportFormat[] = ['wav', 'mp3', 'm4a', 'flac']
const bitrates = [96, 128, 192, 256, 320] as const

export function useAdjustmentOutput(settings: AppSettings, sourceBitrate?: number | null) {
  const [format, setFormat] = useState(settings.outputFormat)
  const [quality, setQuality] = useState(settings.outputQuality)
  useEffect(() => {
    setFormat(settings.outputFormat)
    setQuality(settings.outputQuality)
  }, [settings.outputFormat, settings.outputQuality])
  const adjustableQuality = format === 'mp3' || format === 'm4a'
  const bitrate = !adjustableQuality ? 192 : quality === 'native'
    ? (sourceBitrate ? Math.min(10000, Math.max(32, Math.round(sourceBitrate / 1000))) : 192)
    : quality
  return { format, setFormat, quality, setQuality, adjustableQuality, bitrate }
}

export function AdjustmentOutputFields({ output, disabled }: {
  output: ReturnType<typeof useAdjustmentOutput>
  disabled: boolean
}) {
  return <>
    <label>输出格式<select disabled={disabled} value={output.format} onChange={e => output.setFormat(e.target.value as ExportFormat)}>
      {formats.map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}
    </select></label>
    <label>输出音质<select aria-label="输出音质" disabled={disabled || !output.adjustableQuality}
      value={output.adjustableQuality ? output.quality : 'lossless'}
      title={output.adjustableQuality && output.quality === 'native' ? '原生码率（未获取时使用 192 kbps）' : undefined}
      onChange={e => output.setQuality(e.target.value === 'native' ? 'native' : Number(e.target.value) as OutputQualitySetting)}>
      {output.adjustableQuality ? <>
        <option value="native">原生</option>
        {bitrates.map(value => <option key={value} value={value}>{value} kbps</option>)}
      </> : <option value="lossless">无损</option>}
    </select></label>
  </>
}

export function TimeField({ label, value, disabled, max, onChange }: {
  label: string
  value: number
  disabled?: boolean
  max?: number
  onChange: (value: number, group?: object) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return <label>{label}<input aria-label={label} type="number" step="0.01" min={0} max={max}
    disabled={disabled} value={draft ?? value.toFixed(2)}
    onChange={event => setDraft(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
    onBlur={event => {
      const next = event.currentTarget.valueAsNumber
      if (draft !== null && Number.isFinite(next) && next !== value) onChange(next)
      setDraft(null)
    }}
  /></label>
}
