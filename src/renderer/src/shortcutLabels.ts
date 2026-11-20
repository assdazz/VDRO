import type { ShortcutSettings } from '@shared/types'

export const SHORTCUT_LABELS: { key: keyof ShortcutSettings; label: string }[] = [
  { key: 'play', label: '播放 / 暂停' },
  { key: 'setIn', label: '设为起始点' },
  { key: 'setOut', label: '设为结束点' },
  { key: 'seekBack', label: '后退' },
  { key: 'seekForward', label: '前进' },
  { key: 'selectTool', label: '选择工具' },
  { key: 'splitTool', label: '分割工具' },
]

export function shortcutLabel(value: string): string {
  if (!value) return '—'
  if (value === 'ArrowLeft') return '←'
  if (value === 'ArrowRight') return '→'
  return value
}
