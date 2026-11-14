export function PageTabs({ page, onNavigate }: { page: 'clip' | 'adjust'; onNavigate: (page: 'clip' | 'adjust') => void }) {
return <nav className="page-tabs" aria-label="工作页面"><button type="button" aria-pressed={page === 'clip'} onClick={() => onNavigate('clip')}>音频剪辑</button><button type="button" aria-pressed={page === 'adjust'} onClick={() => onNavigate('adjust')}>音频调整</button></nav>
}
