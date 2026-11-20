import type { Language } from '@shared/types'
import { translateUiText } from './i18n'
import type { ProjectMediaEntry } from './projectDraft'

export function MissingMediaList({ entries, disabled, confirmDelete, language, onRelink, onRemove }: {
  entries: ProjectMediaEntry[]
  disabled: boolean
  confirmDelete: boolean
  language: Language
  onRelink: (entry: ProjectMediaEntry, choose: boolean) => void
  onRemove: (entry: ProjectMediaEntry) => void
}) {
  if (!entries.length) return null
  return <div className="missing-media">
    <strong>待恢复素材</strong>
    <p>重新选择源文件可恢复片段、位置和调整参数。</p>
    {entries.map(entry => <div key={entry.id}>
      <p translate="no" title={entry.filePath}>{entry.filePath}</p>
      <div className="missing-actions">
        <button className="btn btn-ghost btn-small" disabled={disabled} onClick={() => onRelink(entry, false)}>重试</button>
        <button className="btn btn-secondary btn-small" disabled={disabled} onClick={() => onRelink(entry, true)}>重新定位</button>
        <button className="btn btn-ghost btn-small" disabled={disabled} onClick={() => {
          if (confirmDelete && !window.confirm(translateUiText('确定移除此素材及其编辑记录吗？', language))) return
          onRemove(entry)
        }}>移除</button>
      </div>
    </div>)}
  </div>
}
