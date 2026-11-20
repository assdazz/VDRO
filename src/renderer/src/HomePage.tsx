import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppSettings, ImportedMedia } from '@shared/types'
import { IconFileAudio, IconFileVideo, IconLibrary, IconPlus } from './MediaLibrary'
import { SHORTCUT_LABELS, shortcutLabel } from './shortcutLabels'
import { readDraft } from './projectDraft'
import './home.css'

const WORKSPACES = { clip: '音频剪辑', adjust: '音频调整' } as const
type Workspace = keyof typeof WORKSPACES
type Project = { id: string; name: string; workspace: Workspace; openedAt: number }
type Activity = { id: string; kind: 'created' | 'opened'; name: string; time: number }
type HomeData = { projects: Project[]; activity: Activity[] }
const HOME_STORAGE_KEY = 'vdro.home-projects.v1'
const validTime = (time: number) => Number.isFinite(time) && Math.abs(time) <= 8.64e15

function readHomeData(): HomeData {
  try {
    const data = JSON.parse(localStorage.getItem(HOME_STORAGE_KEY) ?? '{}') as Partial<HomeData>
    return {
      projects: Array.isArray(data.projects) ? data.projects.filter(project =>
        project && typeof project.id === 'string' && typeof project.name === 'string' &&
        Object.hasOwn(WORKSPACES, project.workspace) && validTime(project.openedAt)) : [],
      activity: Array.isArray(data.activity) ? data.activity.filter(item =>
        item && typeof item.id === 'string' && typeof item.name === 'string' &&
        (item.kind === 'created' || item.kind === 'opened') && validTime(item.time)) : [],
    }
  } catch {
    return { projects: [], activity: [] }
  }
}

export function HomePage({ active, appearance, settings, settingsLoaded, library, onNavigate, onSettings,
  onMediaDirectory, onOpenMedia, settingsIcon }: {
  active: boolean
  appearance: string
  settings: AppSettings
  settingsLoaded: boolean
  library: ImportedMedia[]
  onNavigate: (next: Workspace, projectId: string, name: string) => void
  onSettings: () => void
  onMediaDirectory: (path: string) => void
  onOpenMedia: (media: ImportedMedia) => void
  settingsIcon: ReactNode
}) {
  const [drafts, setDrafts] = useState<Workspace[]>([])
  useEffect(() => {
    if (!active) return
    setDrafts((['clip', 'adjust'] as const).filter(workspace => {
      try {
        const draft = readDraft<{ paths: string[]; tracks?: unknown[] }>('__draft__', workspace)
        return Boolean(draft?.paths.length || draft?.tracks?.length)
      } catch { return false }
    }))
  }, [active])
  const [data, setData] = useState(readHomeData)
  const [panel, setPanel] = useState<'create' | 'library' | null>(null)
  const [workspace, setWorkspace] = useState<Workspace>('clip')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const projectsHeading = useRef<HTMLHeadingElement>(null)
  const dates = new Intl.DateTimeFormat(settings.language, { dateStyle: 'short', timeStyle: 'short' })

  useEffect(() => {
    const visible = dialog.current
    if (!visible) return
    if (!active) visible.close()
    else if (!visible.open) visible.showModal()
  }, [active, panel])

  function showPanel(next: 'create' | 'library') {
    setError('')
    setName('')
    setWorkspace('clip')
    setPanel(next)
  }

  function enterProject(project: Project, kind: Activity['kind']) {
    if (!window.dispatchEvent(new Event('vdro:before-project-change', { cancelable: true }))) {
      setError('请在当前音频任务完成后切换项目。')
      return
    }
    const time = Date.now()
    const next = {
      projects: [{ ...project, openedAt: time }, ...data.projects.filter(item => item.id !== project.id)],
      activity: [{ id: crypto.randomUUID(), kind, name: project.name, time }, ...data.activity].slice(0, 30),
    }
    try {
      localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify(next))
      setData(next)
      dialog.current?.close()
      onNavigate(project.workspace, project.id, project.name)
    } catch {
      setError('无法保存项目，请重试。')
    }
  }

  async function chooseMediaDirectory() {
    setBusy(true)
    setError('')
    try {
      const folder = await window.vdro.chooseDirectory(settings.mediaDirectory, 'media')
      if (folder) onMediaDirectory(folder)
    } catch {
      setError('无法选择素材文件夹，请重试。')
    } finally {
      setBusy(false)
    }
  }

  async function addMedia() {
    setBusy(true)
    setError('')
    try {
      const media = await window.vdro.openFile(settings.mediaDirectory)
      if (media) openMedia(media)
    } catch {
      setError('无法打开素材，请重试。')
    } finally {
      setBusy(false)
    }
  }

  function openMedia(media: ImportedMedia) {
    dialog.current?.close()
    onOpenMedia(media)
  }

  function projectTime(timestamp: number) {
    const date = new Date(timestamp)
    return <time dateTime={date.toISOString()} translate="no">{dates.format(date)}</time>
  }

  return <div className={appearance + ' home-app'}>
    <main className="home-workspace" aria-label="工作页面">
      <aside className="home-sidebar">
        <nav className="home-nav" aria-label="首页导航">
          <button className="home-nav-new" type="button" onClick={() => showPanel('create')}>
            <IconPlus />新建项目
          </button>
          <button type="button" aria-current="page" onClick={() => { setError(''); projectsHeading.current?.focus() }}>
            <IconLibrary />我的项目
          </button>
          <button className="home-nav-library" type="button" onClick={() => showPanel('library')}>
            <IconFileAudio />素材库
          </button>
          <button className="home-nav-settings" type="button" onClick={onSettings}>
            {settingsIcon}设置
          </button>
        </nav>
      </aside>

      <section className="home-projects" aria-labelledby="home-projects-heading">
        <h1 id="home-projects-heading" ref={projectsHeading} tabIndex={-1}>我的项目</h1>
        {error && !panel && <p className="home-error" role="alert">{error}</p>}
        {drafts.map(workspace => <button key={workspace} type="button" className="btn btn-secondary resume-draft"
          onClick={() => {
            if (window.dispatchEvent(new Event('vdro:before-project-change', { cancelable: true }))) onNavigate(workspace, '__draft__', '')
            else setError('请在当前音频任务完成后切换项目。')
          }}><span>恢复未命名草稿</span> · <span>{WORKSPACES[workspace]}</span></button>)}
        {!data.projects.length ? <div className="home-empty">
          <IconLibrary />
          <strong>还没有项目</strong>
          <span>点击“新建项目”开始。</span>
        </div> : <ul className="home-project-list">
          {data.projects.map(project => <li key={project.id}>
            <button type="button" className="home-project" data-workspace={project.workspace}
              onClick={() => enterProject(project, 'opened')}>
              <span className="home-project-symbol"><IconFileAudio /></span>
              <span className="home-project-name" translate="no" title={project.name}>{project.name}</span>
              <span className="home-project-kind">{WORKSPACES[project.workspace]}</span>
              {projectTime(project.openedAt)}
            </button>
          </li>)}
        </ul>}
      </section>

      <aside className="home-details">
        <section className="home-panel" aria-labelledby="home-activity-heading">
          <h2 id="home-activity-heading">最近动态</h2>
          {!data.activity.length ? <p className="home-panel-empty">暂无动态</p> : <ul className="home-activity">
            {data.activity.slice(0, 6).map(item => <li key={item.id}>
              <span className="home-activity-icon">{item.kind === 'created' ? <IconPlus /> : <IconLibrary />}</span>
              <div>
                <span>{item.kind === 'created' ? '项目已创建' : '打开项目'}</span>
                <strong translate="no" title={item.name}>{item.name}</strong>
                {projectTime(item.time)}
              </div>
            </li>)}
          </ul>}
        </section>
        <section className="home-panel" aria-labelledby="home-shortcuts-heading">
          <h2 id="home-shortcuts-heading">快捷键提示</h2>
          <dl className="home-shortcuts">
            {SHORTCUT_LABELS.map(({ key, label }) => <div key={key}>
              <dt>{label}</dt><dd><kbd translate="no">{shortcutLabel(settings.shortcuts[key])}</kbd></dd>
            </div>)}
          </dl>
        </section>
      </aside>
    </main>

    {panel && <dialog ref={dialog} className="home-dialog" aria-labelledby="home-dialog-title"
      onCancel={event => { if (busy) event.preventDefault() }}
      onClose={() => { setPanel(null); setError('') }}>
      <header>
        <h2 id="home-dialog-title">{panel === 'create' ? '新建项目' : '素材库'}</h2>
        <button className="settings-close" type="button" aria-label="关闭" title="关闭" disabled={busy}
          onClick={() => dialog.current?.close()}>×</button>
      </header>
      {panel === 'create' ? <form className="home-project-form" onSubmit={event => {
        event.preventDefault()
        const title = name.trim()
        if (title) enterProject({ id: crypto.randomUUID(), name: title, workspace, openedAt: Date.now() }, 'created')
      }}>
        <label>项目名称<input className="settings-text-input home-project-input" autoFocus required maxLength={80}
          value={name} onChange={event => setName(event.currentTarget.value)} /></label>
        <label>工作区<select value={workspace} onChange={event => setWorkspace(event.currentTarget.value as Workspace)}>
          <option value="clip">音频剪辑</option>
          <option value="adjust">音频调整</option>
        </select></label>
        {error && <p className="home-error" role="alert">{error}</p>}
        <div className="home-dialog-actions">
          <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.close()}>取消</button>
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>创建项目</button>
        </div>
      </form> : <>
        <div className="home-library-folder">
          <strong>素材文件夹</strong>
          {settings.mediaDirectory ? <>
            <p className="home-folder-path" translate="no" title={settings.mediaDirectory}>{settings.mediaDirectory}</p>
            <div className="home-folder-actions">
              <button className="btn btn-secondary btn-small" type="button" aria-label="更改素材文件夹"
                disabled={!settingsLoaded || busy} onClick={() => void chooseMediaDirectory()}>更改</button>
              <button className="btn btn-ghost btn-small" type="button" aria-label="撤消素材文件夹选择"
                disabled={!settingsLoaded || busy} onClick={() => onMediaDirectory('')}>撤消</button>
            </div>
          </> : <button className="btn btn-secondary home-folder-add" type="button" aria-label="选择素材文件夹"
            title="选择素材文件夹" disabled={!settingsLoaded || busy} onClick={() => void chooseMediaDirectory()}>
            <span className="home-folder-symbol" aria-hidden="true"><IconLibrary /><span className="home-folder-plus"><IconPlus /></span></span>
          </button>}
        </div>
        <button className="btn btn-ghost home-library-add" type="button" disabled={!settingsLoaded || busy}
          onClick={() => void addMedia()}><IconPlus />添加素材</button>
        {!library.length ? <p className="home-panel-empty">素材库为空</p> : <ul className="home-media-list">
          {library.map(media => <li key={media.id}>
            <button type="button" disabled={busy} onClick={() => openMedia(media)}>
              {media.info.videoStreams.length ? <IconFileVideo /> : <IconFileAudio />}
              <span translate="no" title={media.fileName}>{media.fileName}</span>
            </button>
          </li>)}
        </ul>}
        {error && <p className="home-error" role="alert">{error}</p>}
      </>}
    </dialog>}
  </div>
}
