import { TimelineContextMenu } from '../TimelineContextMenu'
import { TimelineEditIcon } from '../TimelineEditControls'
import { VolumeIcon } from '../VolumeIcon'

const items = [
  { action: 'copy', label: '复制', shortcut: 'Ctrl+C' },
  { action: 'cut', label: '剪切', shortcut: 'Ctrl+X' },
  { action: 'reverse', label: '倒放', shortcut: '' },
  { action: 'mute', label: '静音片段', shortcut: '' },
  { action: 'delete', label: '删除', shortcut: 'Delete' },
] as const

export type ClipMenuAction = (typeof items)[number]['action']

export function ClipContextMenu({ x, y, locked, reversed, muted, onAction, onDismiss }: {
  x: number
  y: number
  locked: boolean
  reversed: boolean
  muted: boolean
  onAction: (action: ClipMenuAction) => void
  onDismiss: () => void
}) {
  return <TimelineContextMenu x={x} y={y} label="片段操作" className="mix-clip-menu" onDismiss={onDismiss}>
    {items.map(({ action, label, shortcut }) => {
      const checked = action === 'reverse' ? reversed : action === 'mute' ? muted : undefined
      return <button key={action} type="button" data-action={action}
        role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked}
        disabled={locked && action !== 'copy'} aria-keyshortcuts={shortcut || undefined} onClick={() => onAction(action)}>
        {action === 'mute' ? <VolumeIcon muted={muted} /> : <TimelineEditIcon action={action} />}
        <span>{label}</span>
        {shortcut && <kbd translate="no">{shortcut}</kbd>}
      </button>
    })}
  </TimelineContextMenu>
}
