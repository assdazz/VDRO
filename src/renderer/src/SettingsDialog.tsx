import { useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { translateUiText } from './i18n'
import type {
  AccentColor,
  AppInfo,
  AppSettings,
  ExportFormat,
  FontScaleSetting,
  Language,
  MaterialColor,
  OutputQualitySetting,
  PreviewFpsSetting,
  PreviewResolutionSetting,
  SaveMode,
  ShortcutSettings,
  SkipSecondsSetting,
  TempRetentionDays,
  TempSizeLimitMB,
  ThemeMode,
} from '@shared/types'

type SettingsTab = 'output' | 'preview' | 'interface' | 'data' | 'shortcuts' | 'about'

interface SettingsDialogProps {
  settings: AppSettings
  appInfo: AppInfo | null
  onUpdate: (patch: Partial<AppSettings>) => void
  onClose: () => void
  onResetAll: () => void
  onResetLayout: () => void
  onClearTemp: () => Promise<void>
  onClearWaveformCache: () => Promise<void>
  onChooseDirectory: () => Promise<string | null>
  onOpenDataFolder: () => Promise<void>
}

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'output', label: '输出' },
  { id: 'preview', label: '预览' },
  { id: 'interface', label: '界面' },
  { id: 'data', label: '数据' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'about', label: '关于' },
]

const QUALITY_OPTIONS: OutputQualitySetting[] = ['native', 96, 128, 192, 256, 320]
const RESOLUTION_OPTIONS: PreviewResolutionSetting[] = ['follow', 360, 480, 720, 1080, 1440, 2160]
const FPS_OPTIONS: PreviewFpsSetting[] = ['follow', 30, 60, 120, 144]
const FILENAME_TOKENS: Array<{ token: string; label: string }> = [
  { token: '{source}', label: '源文件名' },
  { token: '{start}', label: '起始时间' },
  { token: '{end}', label: '结束时间' },
  { token: '{duration}', label: '时长' },
  { token: '{date}', label: '日期' },
  { token: '{time}', label: '时间' },
  { token: '{ext}', label: '扩展名' },
]

const SHORTCUT_LABELS: Array<{ key: keyof ShortcutSettings; label: string }> = [
  { key: 'play', label: '播放 / 暂停' },
  { key: 'setIn', label: '设为起始点' },
  { key: 'setOut', label: '设为结束点' },
  { key: 'seekBack', label: '后退' },
  { key: 'seekForward', label: '前进' },
]

function resolutionLabel(value: PreviewResolutionSetting): string {
  if (value === 'follow') return '跟随源'
  if (value === 1440) return '2K'
  if (value === 2160) return '4K'
  return `${value}P`
}

function fpsLabel(value: PreviewFpsSetting): string {
  return value === 'follow' ? '跟随源' : `${value}帧`
}

function qualityLabel(value: OutputQualitySetting): string {
  return value === 'native' ? '原生' : `${value} kbps`
}

function shortcutLabel(value: string): string {
  if (value === 'ArrowLeft') return '←'
  if (value === 'ArrowRight') return '→'
  if (value === 'Space') return 'Space'
  return value
}

function normalizeShortcut(event: ReactKeyboardEvent): string {
  if (event.code === 'Space') return 'Space'
  if (event.key.length === 1) return event.key.toUpperCase()
  return event.key
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <label className="settings-toggle-row">
      <span className="settings-label-block">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

function SelectRow({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  children: ReactNode
}): JSX.Element {
  return (
    <label className="settings-select-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}

export function SettingsDialog({
  settings,
  appInfo,
  onUpdate,
  onClose,
  onResetAll,
  onResetLayout,
  onClearTemp,
  onClearWaveformCache,
  onChooseDirectory,
  onOpenDataFolder,
}: SettingsDialogProps): JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('output')
  const [capturing, setCapturing] = useState<keyof ShortcutSettings | null>(null)
  const [clearing, setClearing] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [shortcutError, setShortcutError] = useState<string | null>(null)

  const updateShortcut = (key: keyof ShortcutSettings, value: string): void => {
    const conflict = SHORTCUT_LABELS.find(
      (item) => item.key !== key && settings.shortcuts[item.key] === value,
    )
    if (conflict) {
      setShortcutError(`该按键已被“${conflict.label}”使用`)
      return
    }
    setShortcutError(null)
    onUpdate({
      shortcuts: {
        ...settings.shortcuts,
        [key]: value,
      },
    })
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!capturing) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setCapturing(null)
      setShortcutError(null)
      return
    }
    const normalized = normalizeShortcut(event)
    if (!normalized || normalized === 'Shift' || normalized === 'Control' || normalized === 'Alt') {
      return
    }
    updateShortcut(capturing, normalized)
    setCapturing(null)
  }

  const appendFilenameToken = (token: string): void => {
    const current = settings.filenameTemplate
    const separator = current && !/[_-]$/.test(current) ? '_' : ''
    onUpdate({
      filenameTemplate: `${current}${separator}${token}`.slice(0, 160),
    })
  }

  const chooseDirectory = async (): Promise<void> => {
    const directory = await onChooseDirectory()
    if (directory) {
      onUpdate({ saveDirectory: directory, saveMode: 'fixed' })
    }
  }

  const clearTemp = async (): Promise<void> => {
    setClearing(true)
    try {
      await onClearTemp()
    } finally {
      setClearing(false)
    }
  }

  const clearWaveformCache = async (): Promise<void> => {
    setClearingCache(true)
    try {
      await onClearWaveformCache()
    } finally {
      setClearingCache(false)
    }
  }

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div
        className="settings-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="settings-header">
          <div>
            <span className="eyebrow">PREFERENCES</span>
            <h2>设置</h2>
          </div>
          <button className="settings-close" type="button" onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? 'is-active' : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {tab === 'output' && (
              <section>
                <h3>输出默认值</h3>
                <p className="settings-hint">影响下一次提取；当前已提取片段不会改变。</p>
                <SelectRow
                  label="默认输出格式"
                  value={settings.outputFormat}
                  onChange={(value) => onUpdate({ outputFormat: value as ExportFormat })}
                >
                  <option value="mp3">MP3</option>
                  <option value="wav">WAV</option>
                  <option value="m4a">M4A</option>
                  <option value="flac">FLAC</option>
                </SelectRow>
                <SelectRow
                  label="默认输出音质"
                  value={settings.outputQuality}
                  onChange={(value) =>
                    onUpdate({
                      outputQuality:
                        value === 'native' ? 'native' : (Number(value) as OutputQualitySetting),
                    })
                  }
                >
                  {QUALITY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {qualityLabel(value)}
                    </option>
                  ))}
                </SelectRow>
                <SelectRow
                  label="采样率"
                  value={settings.sampleRate}
                  onChange={(value) =>
                    onUpdate({ sampleRate: Number(value) as 44100 | 48000 })
                  }
                >
                  <option value="44100">44.1 kHz</option>
                  <option value="48000">48 kHz</option>
                </SelectRow>
                <SelectRow
                  label="声道"
                  value={settings.channels}
                  onChange={(value) => onUpdate({ channels: Number(value) as 1 | 2 })}
                >
                  <option value="1">单声道</option>
                  <option value="2">立体声</option>
                </SelectRow>
                <SelectRow
                  label="保存方式"
                  value={settings.saveMode}
                  onChange={(value) => onUpdate({ saveMode: value as SaveMode })}
                >
                  <option value="ask">每次询问</option>
                  <option value="fixed">固定目录</option>
                </SelectRow>
                <div className="settings-directory">
                  <strong className="settings-directory-label">默认保存文件夹</strong>
                  <div
                    className={`settings-path-box${settings.saveDirectory ? '' : ' is-empty'}`}
                    title={settings.saveDirectory || '尚未选择目录'}
                  >
                    {settings.saveDirectory || '尚未选择目录'}
                  </div>
                  <div className="settings-directory-actions">
                    <button className="btn btn-ghost btn-small" type="button" onClick={() => void chooseDirectory()}>
                      选择文件夹
                    </button>
                    {settings.saveDirectory && (
                      <button
                        className="btn btn-ghost btn-small"
                        type="button"
                        onClick={() => onUpdate({ saveDirectory: '', saveMode: 'ask' })}
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
                <ToggleRow
                  label="提取后自动选中新片段"
                  checked={settings.autoSelectExtracted}
                  onChange={(checked) => onUpdate({ autoSelectExtracted: checked })}
                />
                <div className="settings-template">
                  <span className="settings-label-block">
                    <strong>文件名模板</strong>
                    <small>点击下方按钮追加到模板末尾，按点击顺序组合，自动用 _ 分隔。</small>
                  </span>
                  <div className="settings-template-edit">
                    <input
                      className="settings-text-input"
                      value={settings.filenameTemplate}
                      maxLength={160}
                      onChange={(event) => onUpdate({ filenameTemplate: event.target.value })}
                    />
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={() => onUpdate({ filenameTemplate: '' })}
                    >
                      清空
                    </button>
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={() => onUpdate({ filenameTemplate: '{source}_{start}-{end}' })}
                    >
                      恢复默认
                    </button>
                  </div>
                  <div className="settings-template-tokens">
                    {FILENAME_TOKENS.map((item) => (
                      <button
                        key={item.token}
                        className="template-token"
                        type="button"
                        title={`追加 ${item.token}`}
                        onClick={() => appendFilenameToken(item.token)}
                      >
                        <span>{item.label}</span>
                        <code>{item.token}</code>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {tab === 'preview' && (
              <section>
                <h3>预览与播放</h3>
                <p className="settings-hint">新建预览时使用；也可在预览菜单中临时切换。</p>
                <SelectRow
                  label="默认预览分辨率"
                  value={settings.previewResolution}
                  onChange={(value) =>
                    onUpdate({
                      previewResolution:
                        value === 'follow'
                          ? 'follow'
                          : (Number(value) as PreviewResolutionSetting),
                    })
                  }
                >
                  {RESOLUTION_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {resolutionLabel(value)}
                    </option>
                  ))}
                </SelectRow>
                <SelectRow
                  label="默认帧率"
                  value={settings.previewFps}
                  onChange={(value) =>
                    onUpdate({
                      previewFps:
                        value === 'follow' ? 'follow' : (Number(value) as PreviewFpsSetting),
                    })
                  }
                >
                  {FPS_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {fpsLabel(value)}
                    </option>
                  ))}
                </SelectRow>
                <SelectRow
                  label="前后快进时长"
                  value={settings.skipSeconds}
                  onChange={(value) =>
                    onUpdate({
                      skipSeconds:
                        value === 'custom'
                          ? 'custom'
                          : (Number(value) as SkipSecondsSetting),
                    })
                  }
                >
                  <option value="1">1 秒</option>
                  <option value="3">3 秒</option>
                  <option value="5">5 秒</option>
                  <option value="10">10 秒</option>
                  <option value="15">15 秒</option>
                  <option value="custom">自定义</option>
                </SelectRow>
                {settings.skipSeconds === 'custom' && (
                  <label className="settings-select-row">
                    <span>自定义时长（秒）</span>
                    <input
                      className="settings-number-input"
                      type="number"
                      min={1}
                      max={600}
                      step={1}
                      value={settings.customSkipSeconds}
                      onChange={(event) =>
                        onUpdate({
                          customSkipSeconds: Math.min(
                            600,
                            Math.max(1, Math.round(Number(event.target.value) || 1)),
                          ),
                        })
                      }
                    />
                  </label>
                )}
                <label className="settings-range-row">
                  <span className="settings-label-block">
                    <strong>默认预览音量</strong>
                    <small className="settings-scale-value">{settings.previewVolume}%</small>
                  </span>
                  <div className="settings-range-control">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={settings.previewVolume}
                      onChange={(event) =>
                        onUpdate({
                          previewVolume: Number(event.target.value),
                          previewMuted: false,
                        })
                      }
                    />
                  </div>
                </label>
                <ToggleRow
                  label="默认静音"
                  description="启动时预览不播放声音，仍可在音频预览栏临时取消。"
                  checked={settings.previewMuted}
                  onChange={(checked) => onUpdate({ previewMuted: checked })}
                />
                <ToggleRow
                  label="预览选区默认循环"
                  checked={settings.previewLoop}
                  onChange={(checked) => onUpdate({ previewLoop: checked })}
                />
                <ToggleRow
                  label="提取音频播放时同步视频"
                  description="关闭后只播放提取音频。"
                  checked={settings.syncExtractedVideo}
                  onChange={(checked) => onUpdate({ syncExtractedVideo: checked })}
                />
              </section>
            )}

            {tab === 'interface' && (
              <section>
                <h3>界面与布局</h3>
                <SelectRow
                  label="主题"
                  value={settings.theme}
                  onChange={(value) => onUpdate({ theme: value as ThemeMode })}
                >
                  <option value="dark">深色</option>
                  <option value="oled">纯黑</option>
                  <option value="light">白天</option>
                  <option value="acrylic">亚克力</option>
                </SelectRow>
                {settings.theme === 'acrylic' && (
                  <>
                    <SelectRow
                      label="主题颜色"
                      value={settings.materialColor}
                      onChange={(value) =>
                        onUpdate({ materialColor: value as MaterialColor })
                      }
                    >
                      <option value="blue">冰蓝</option>
                      <option value="violet">紫罗兰</option>
                      <option value="teal">青绿</option>
                      <option value="rose">玫瑰</option>
                      <option value="amber">琥珀</option>
                      <option value="graphite">石墨</option>
                    </SelectRow>
                    <ToggleRow
                      label="半透明"
                      description="让窗口透出桌面或后方软件的颜色；需要 Windows 透明窗口支持。"
                      checked={settings.translucent}
                      onChange={(checked) => onUpdate({ translucent: checked })}
                    />
                  </>
                )}
                <SelectRow
                  label="强调色"
                  value={settings.accent}
                  onChange={(value) => onUpdate({ accent: value as AccentColor })}
                >
                  <option value="yellow">霓虹黄</option>
                  <option value="blue">冰蓝</option>
                  <option value="green">荧光绿</option>
                  <option value="purple">电光紫</option>
                </SelectRow>
                <SelectRow
                  label="语言 / Language"
                  value={settings.language}
                  onChange={(value) => onUpdate({ language: value as Language })}
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </SelectRow>
                <SelectRow
                  label="字体大小 / Font size"
                  value={settings.fontScale}
                  onChange={(value) =>
                    onUpdate({ fontScale: Number(value) as FontScaleSetting })
                  }
                >
                  <option value="90">小 / Small</option>
                  <option value="100">标准 / Normal</option>
                  <option value="110">大 / Large</option>
                  <option value="120">特大 / Extra large</option>
                </SelectRow>
                <label className="settings-range-row">
                  <span className="settings-label-block">
                    <strong>界面缩放</strong>
                    <small className="settings-scale-value">{settings.uiScale}%</small>
                  </span>
                  <div className="settings-range-control">
                    <button
                      className="settings-step"
                      type="button"
                      aria-label="缩小界面"
                      disabled={settings.uiScale <= 90}
                      onClick={() =>
                        onUpdate({ uiScale: Math.max(90, settings.uiScale - 5) })
                      }
                    >
                      −
                    </button>
                    <input
                      type="range"
                      min={90}
                      max={125}
                      step={5}
                      value={settings.uiScale}
                      onChange={(event) =>
                        onUpdate({ uiScale: Number(event.target.value) })
                      }
                    />
                    <button
                      className="settings-step"
                      type="button"
                      aria-label="放大界面"
                      disabled={settings.uiScale >= 125}
                      onClick={() =>
                        onUpdate({ uiScale: Math.min(125, settings.uiScale + 5) })
                      }
                    >
                      +
                    </button>
                  </div>
                </label>
                <ToggleRow
                  label="启动时恢复拖动布局"
                  checked={settings.restoreLayout}
                  onChange={(checked) => onUpdate({ restoreLayout: checked })}
                />
                <ToggleRow
                  label="素材栏默认收起"
                  checked={settings.sidebarCollapsed}
                  onChange={(checked) => onUpdate({ sidebarCollapsed: checked })}
                />
                <button className="btn btn-ghost btn-small settings-action" type="button" onClick={onResetLayout}>
                  重置界面布局
                </button>
                <div className="settings-subsection">
                  <h4>窗口行为</h4>
                  <ToggleRow
                    label="记住窗口大小和位置"
                    description="下次启动时恢复上次的位置；副屏移除后会自动回退到可用屏幕。"
                    checked={settings.rememberWindowState}
                    onChange={(checked) => onUpdate({ rememberWindowState: checked })}
                  />
                  <ToggleRow
                    label="启动时最大化"
                    checked={settings.startMaximized}
                    onChange={(checked) => onUpdate({ startMaximized: checked })}
                  />
                  <ToggleRow
                    label="窗口置顶"
                    checked={settings.alwaysOnTop}
                    onChange={(checked) => onUpdate({ alwaysOnTop: checked })}
                  />
                </div>
              </section>
            )}

            {tab === 'data' && (
              <section>
                <h3>临时文件与数据</h3>
                <div className="settings-directory">
                  <span className="settings-label-block">
                    <strong>数据目录</strong>
                    <small>{appInfo?.userDataPath ?? '—'}</small>
                  </span>
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    onClick={() => void onOpenDataFolder()}
                  >
                    打开数据目录
                  </button>
                </div>
                <ToggleRow
                  label="启动时清理临时提取文件"
                  description="只处理临时提取目录；不会删除你通过“保存”另存到其他目录的文件。"
                  checked={settings.cleanTempOnStartup}
                  onChange={(checked) => onUpdate({ cleanTempOnStartup: checked })}
                />
                <SelectRow
                  label="临时文件保留时间"
                  value={settings.tempRetentionDays}
                  onChange={(value) =>
                    onUpdate({
                      tempRetentionDays: Number(value) as TempRetentionDays,
                    })
                  }
                >
                  <option value="0">不按时间删除</option>
                  <option value="1">1 天</option>
                  <option value="7">7 天</option>
                  <option value="30">30 天</option>
                </SelectRow>
                <SelectRow
                  label="临时文件总大小上限"
                  value={settings.tempSizeLimitMB}
                  onChange={(value) =>
                    onUpdate({
                      tempSizeLimitMB: Number(value) as TempSizeLimitMB,
                    })
                  }
                >
                  <option value="0">不限制</option>
                  <option value="500">500 MB</option>
                  <option value="2048">2 GB</option>
                  <option value="5120">5 GB</option>
                </SelectRow>
                <ToggleRow
                  label="素材库跨启动保留"
                  description="只记录文件路径，不复制源文件；已提取音频跨启动保留依赖此项。"
                  checked={settings.persistLibrary}
                  onChange={(checked) =>
                    onUpdate({
                      persistLibrary: checked,
                      ...(checked ? {} : { persistExtracted: false }),
                    })
                  }
                />
                {settings.persistLibrary ? (
                  <ToggleRow
                    label="已提取音频跨启动保留"
                    description="需要素材库保留源文件路径；否则重启后会清空提取列表。"
                    checked={settings.persistExtracted}
                    onChange={(checked) => onUpdate({ persistExtracted: checked })}
                  />
                ) : (
                  <div className="settings-dependency">
                    未开启素材库跨启动保留时，重启后已提取音频列表会自动清空。
                  </div>
                )}
                <ToggleRow
                  label="删除操作前确认"
                  description="删除已提取音频、移除素材或清理文件时询问。"
                  checked={settings.confirmDelete}
                  onChange={(checked) => onUpdate({ confirmDelete: checked })}
                />
                <SelectRow
                  label="波形缓存上限"
                  value={settings.waveformCacheLimitMB}
                  onChange={(value) =>
                    onUpdate({
                      waveformCacheLimitMB: Number(value) as 100 | 500 | 1024 | 0,
                    })
                  }
                >
                  <option value="100">100 MB</option>
                  <option value="500">500 MB</option>
                  <option value="1024">1 GB</option>
                  <option value="0">不限制</option>
                </SelectRow>
                <div className="settings-danger-zone">
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    disabled={clearing}
                    onClick={() => void clearTemp()}
                  >
                    {clearing ? '清理中…' : '清理临时提取文件'}
                  </button>
                  <small>会删除所有已提取音频临时文件和记录。</small>
                  <button
                    className="btn btn-ghost btn-small"
                    type="button"
                    disabled={clearingCache}
                    onClick={() => void clearWaveformCache()}
                  >
                    {clearingCache ? '清理中…' : '清理波形缓存'}
                  </button>
                  <small>会删除磁盘上的波形缓存，下次重新生成。</small>
                </div>
              </section>
            )}

            {tab === 'shortcuts' && (
              <section>
                <h3>快捷键</h3>
                <p className="settings-hint">点击按键框后按下新按键，Esc 取消。</p>
                <div className="shortcut-list">
                  {SHORTCUT_LABELS.map((item) => (
                    <div className="shortcut-row" key={item.key}>
                      <span>{item.label}</span>
                      <button
                        type="button"
                        className={`shortcut-key${capturing === item.key ? ' is-capturing' : ''}`}
                        onClick={() => setCapturing(item.key)}
                      >
                        {capturing === item.key
                          ? '按下按键…'
                          : shortcutLabel(settings.shortcuts[item.key])}
                      </button>
                    </div>
                  ))}
                </div>
                {shortcutError && <p className="settings-error">{shortcutError}</p>}
                <button
                  className="btn btn-ghost btn-small settings-action"
                  type="button"
                  onClick={() => {
                    setShortcutError(null)
                    onUpdate({ shortcuts: DEFAULT_SHORTCUTS })
                  }}
                >
                  恢复默认快捷键
                </button>
              </section>
            )}

            {tab === 'about' && (
              <section>
                <h3>关于 VDRO</h3>
                <div className="about-grid">
                  <span>版本</span>
                  <strong>{appInfo?.version ?? '—'}</strong>
                  <span>数据目录</span>
                  <strong className="about-path">{appInfo?.userDataPath ?? '—'}</strong>
                </div>
                <button
                  className="btn btn-ghost btn-small settings-action is-danger"
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        translateUiText(
                          '确定要恢复所有设置为默认值吗？',
                          settings.language,
                        ),
                      )
                    ) {
                      onResetAll()
                    }
                  }}
                >
                  恢复全部默认设置
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const DEFAULT_SHORTCUTS: ShortcutSettings = {
  play: 'Space',
  setIn: 'I',
  setOut: 'O',
  seekBack: 'ArrowLeft',
  seekForward: 'ArrowRight',
}
