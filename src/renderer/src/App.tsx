import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { DEFAULT_APP_SETTINGS } from '@shared/defaults'
import type { AppSettings, ExtractedClip, ImportedMedia } from '@shared/types'
import { TITLE_BAR_HEIGHT } from '@shared/windowChrome'
import logo from '../../../assets/vdro-icon.png'
import ClipEditor, { IconSettings } from './ClipEditor'
import { HomePage } from './HomePage'
import { formatTime, summary } from './MediaLibrary'
import { translateDom } from './i18n'
import { deleteProjectDrafts, type ProjectSaveState } from './projectDraft'
import { PageTabs, type AppPage } from './PageTabs'
import { useStartupBrand } from './useStartupBrand'

const AudioAdjustmentPage = lazy(() => import('./adjustment/AudioAdjustmentPage'))

export default function App() {
  const shell = useRef<HTMLDivElement>(null)
  const [projectId, setProjectId] = useState<string>('__draft__')
  const [projectName, setProjectName] = useState<string | null>(null)
  const [projectStates, setProjectStates] = useState<Record<string, ProjectSaveState>>({})
  useEffect(() => {
    const listener = (event: Event) => {
      const { projectId, workspace, state } = (event as CustomEvent).detail
      setProjectStates(previous => ({ ...previous, [projectId + '.' + workspace]: state }))
    }
    window.addEventListener('vdro:project-state', listener)
    return () => window.removeEventListener('vdro:project-state', listener)
  }, [])
  const [page, setPage] = useState<AppPage>('home')
  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [startupSettingsRead, setStartupSettingsRead] = useState(false)
  const [startupZoomReady, setStartupZoomReady] = useState(false)
  const [library, setLibrary] = useState<ImportedMedia[]>([])
  const [requestedMedia, setRequestedMedia] = useState<{ media: ImportedMedia } | null>(null)
  const [clipTitle, setClipTitle] = useState<{ media: ImportedMedia | null; duration: number } | null>(null)
  const [settingsRequest, requestSettings] = useState(0)
  const [incoming, setIncoming] = useState<{ path: string; key: number } | null>(null)
  const appearance = `app theme-${settings.theme} material-${settings.materialColor} accent-${settings.accent}`
  const homeAppearance = settings.theme === 'acrylic' && settings.translucent
    ? `${appearance} is-translucent`
    : appearance

  useLayoutEffect(() => {
    document.documentElement.dataset.uiVersion = settings.uiVersion
  }, [settings.uiVersion])

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--vd-font-scale', String(settings.fontScale / 100))
  }, [settings.fontScale])

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--vd-topbar', TITLE_BAR_HEIGHT + 'px')
  }, [])

  const windowSettingsReady = startupSettingsRead || settingsLoaded
  useEffect(() => {
    if (!windowSettingsReady) return
    let cancelled = false
    let frame = 0
    void window.vdro.setZoomFactor(settings.uiScale / 100).catch(() => undefined).then(() => {
      if (cancelled) return
      frame = window.requestAnimationFrame(() => setStartupZoomReady(true))
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [settings.uiScale, windowSettingsReady])

  useStartupBrand(shell, startupZoomReady, page === 'home' && settings.uiVersion === 'modern' && settingsRequest === 0)

  const applyInitialSettings = useCallback((initial: AppSettings) => {
    setSettings(initial)
    setStartupSettingsRead(true)
  }, [])

  useEffect(() => {
    const root = shell.current
    if (!root) return
    document.documentElement.lang = settings.language
    const options = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder'],
    }
    const apply = () => {
      observer.disconnect()
      translateDom(root, settings.language)
      observer.observe(root, options)
    }
    const observer = new MutationObserver(apply)
    apply()
    return () => observer.disconnect()
  }, [settings.language])

  const navigate = useCallback((next: AppPage) => {
    shell.current?.querySelectorAll<HTMLMediaElement>('video, audio').forEach(element => element.pause())
    setPage(next)
  }, [])

  async function deleteProject(id: string) {
    if (id === projectId) {
      // Unmount the old editors before deleting their drafts and persisted results.
      flushSync(() => {
        setProjectId('__draft__')
        setProjectName(null)
        setIncoming(null)
        setRequestedMedia(null)
        requestSettings(0)
        navigate('home')
      })
    }
    await window.vdro.deleteProject(id)
    deleteProjectDrafts(id)
    setProjectStates(previous => {
      const next = { ...previous }
      delete next[id + '.clip']
      delete next[id + '.adjust']
      return next
    })
  }

  function openHomeMedia(media: ImportedMedia) {
    setRequestedMedia({ media })
    navigate('clip')
  }

  function openSettings() {
    requestSettings(value => value + 1)
  }

  function adjustClip(clip: ExtractedClip) {
    setIncoming({ path: clip.filePath, key: Date.now() })
    navigate('adjust')
  }

  return (
    <div ref={shell} className={`${homeAppearance} page-shell`}>
      <header className="topbar window-titlebar">
        <div className="brand">
          <img className="window-logo" src={logo} alt="" width="24" height="24" />
          <span className="brand-name">VDRO</span>
        </div>
        <PageTabs page={page} onNavigate={navigate} />
        {page !== 'home' && <div className="project-save-status" role="status">
          {projectName ? <span className="project-name" translate="no" title={projectName}>{projectName}</span> : <span>未命名草稿</span>}
          <small>{projectStates[projectId + '.' + page] === 'error' ? '保存失败' :
            projectStates[projectId + '.' + page] === 'saved' ? '已保存' : '正在恢复'}</small>
        </div>}
        {page === 'clip' && clipTitle?.media && <div className="topbar-file">
          <span className="file-name" title={clipTitle.media.fileName} translate="no">{clipTitle.media.fileName}</span>
          <span className="format-badge">{summary(clipTitle.media)}</span>
          <span className="file-duration">{formatTime(clipTitle.duration, false)}</span>
        </div>}
        <button className="topbar-settings-btn shared-settings-btn" type="button" title="设置" aria-label="打开设置"
          onClick={openSettings}><IconSettings /></button>
      </header>
      <div className="page-frame" hidden={page !== 'home'}>
        <HomePage active={page === 'home'} appearance={homeAppearance} settings={settings} settingsLoaded={settingsLoaded}
          library={library} onNavigate={(workspace, id, name) => {
            setProjectName(name)
            if (id !== projectId) {
              setIncoming(null)
              setRequestedMedia(null)
              setProjectId(id)
              requestSettings(0)
            }
            navigate(workspace)
          }} onDeleteProject={deleteProject} onSettings={openSettings} onOpenMedia={openHomeMedia}
          onMediaDirectory={mediaDirectory => setSettings(current => ({ ...current, mediaDirectory }))}
          settingsIcon={<IconSettings />} />
      </div>
      <div className="page-frame" hidden={page !== 'clip'}>
        <ClipEditor key={projectId} projectId={projectId}
          active={page === 'clip'}
          onNavigate={navigate}
          onAdjustClip={adjustClip}
          requestedMedia={requestedMedia}
          onLibraryChange={setLibrary}
          onTitleChange={setClipTitle}
          settingsRequest={settingsRequest}
          settings={settings}
          setSettings={setSettings}
          onSettingsRead={applyInitialSettings}
          settingsLoaded={settingsLoaded}
          setSettingsLoaded={setSettingsLoaded}
        />
      </div>
      <div className="page-frame" hidden={page !== 'adjust'}>
        <Suspense fallback={null}>
          <AudioAdjustmentPage key={projectId} projectId={projectId}
            active={page === 'adjust'}
            incoming={incoming}
            settings={settings}
          />
        </Suspense>
      </div>
      <div id="settings-root" style={{ display: 'contents' }} />
      {settings.uiVersion === 'modern' && <div className="startup-curtain" aria-hidden="true" />}
    </div>
  )
}
