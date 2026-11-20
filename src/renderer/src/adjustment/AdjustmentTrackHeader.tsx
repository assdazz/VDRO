import { useRef } from 'react'
import { VolumeIcon } from '../VolumeIcon'

export const DEFAULT_TRACK_APPEARANCE = { name: '', ignored: false, locked: false, muted: false }
export type TrackAppearance = typeof DEFAULT_TRACK_APPEARANCE

type TrackHeaderProps = TrackAppearance & {
  defaultName: string
  selected?: boolean
  disabled?: boolean
  onIgnore: () => void
  onLock: () => void
  onMute: () => void
  onName: (name: string, group?: object) => void
  onSelect?: () => void
}

export function AdjustmentTrackHeader({
  name, defaultName, selected, ignored, locked, muted, disabled, onIgnore, onLock, onMute, onName, onSelect,
}: TrackHeaderProps) {
  const nameEdit = useRef<object | undefined>(undefined)
  const ignoreLabel = ignored ? '恢复音轨' : '忽略音轨'
  const lockLabel = locked ? '解锁轨道' : '锁定轨道'
  const muteLabel = muted ? '取消整轨静音' : '静音整条轨道'
  return <div className="adjustment-track-header" data-selected={selected}>
    <button type="button" className="track-state-button track-ignore-button" title={ignoreLabel} aria-label={ignoreLabel}
      aria-pressed={ignored} disabled={disabled} onClick={onIgnore}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M2 10s2.8-5 8-5 8 5 8 5-2.8 5-8 5-8-5-8-5Z"/>
        <circle cx="10" cy="10" r="2"/>
        {ignored && <path d="m3 3 14 14"/>}
      </svg>
    </button>
    <button type="button" className="track-state-button" title={lockLabel} aria-label={lockLabel}
      aria-pressed={locked} disabled={disabled} onClick={onLock}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="4.5" y="9" width="11" height="8" rx="1"/>
        <path d={locked ? 'M7 9V6a3 3 0 0 1 6 0v3' : 'M7 9V6a3 3 0 0 1 6-.1'}/>
        <path d="M10 12v2"/>
      </svg>
    </button>
    <button type="button" className="track-state-button track-mute-button" title={muteLabel} aria-label={muteLabel}
      aria-pressed={muted} disabled={disabled} onClick={onMute}>
      <VolumeIcon muted={muted}/>
    </button>
    <input type="text" className="adjustment-track-name" aria-label="轨道名称" value={name}
      placeholder={defaultName} maxLength={80} disabled={disabled} onFocus={() => {
        nameEdit.current = {}
        onSelect?.()
      }}
      onChange={event => onName(event.currentTarget.value, nameEdit.current)}
      onBlur={event => {
        onName(event.currentTarget.value.trim(), nameEdit.current)
        nameEdit.current = undefined
      }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/>
  </div>
}
