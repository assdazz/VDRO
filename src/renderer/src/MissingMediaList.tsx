export function MissingMediaList({ paths, disabled, onRelink }: {
  paths: string[]
  disabled: boolean
  onRelink: (path: string, choose: boolean) => void
}) {
  if (!paths.length) return null
  return <div className="missing-media">
    <strong>待恢复素材</strong>
    <p>重新选择源文件可恢复片段、位置和调整参数。</p>
    {paths.map(path => <div key={path}>
      <p translate="no" title={path}>{path}</p>
      <div className="missing-actions">
        <button className="btn btn-ghost btn-small" disabled={disabled} onClick={() => onRelink(path, false)}>重试</button>
        <button className="btn btn-secondary btn-small" disabled={disabled} onClick={() => onRelink(path, true)}>重新定位</button>
      </div>
    </div>)}
  </div>
}
