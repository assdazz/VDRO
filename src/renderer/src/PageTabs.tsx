export type AppPage = 'home' | 'clip' | 'adjust'

export function PageTabs({
  page,
  onNavigate,
}: {
  page: AppPage
  onNavigate: (page: AppPage) => void
}) {
  return (
    <nav className="page-tabs" aria-label="工作页面">
      <button type="button" aria-pressed={page === 'home'} onClick={() => onNavigate('home')}>首页</button>
      <button type="button" aria-pressed={page === 'clip'} onClick={() => onNavigate('clip')}>
        音频剪辑
      </button>
      <button type="button" aria-pressed={page === 'adjust'} onClick={() => onNavigate('adjust')}>
        音频调整
      </button>
    </nav>
  )
}
