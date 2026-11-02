import { useEffect, useState } from 'react'
import type { AppSettings, DecoderInfo } from '@shared/types'

export function DecoderSettings({ settings, onUpdate }: {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
}) {
  const [info, setInfo] = useState<DecoderInfo | null>(null)
  const [frames, setFrames] = useState({ total: 0, dropped: 0 })
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState(false)
  const en = settings.language === 'en-US'
  const t = (zh: string, english: string) => en ? english : zh

  useEffect(() => {
    let cancelled = false
    let reading = false
    const sample = () => {
      const video = document.querySelector('video')
      const quality = video?.getVideoPlaybackQuality()
      setFrames({ total: quality?.totalVideoFrames ?? 0, dropped: quality?.droppedVideoFrames ?? 0 })
      if (reading) return
      reading = true
      void window.vdro.getDecoderInfo(video?.currentSrc || undefined).then((value) => {
        if (!cancelled) setInfo(value)
      }).catch(() => {
        if (!cancelled) setError('GPU status unavailable / 无法读取 GPU 状态')
      }).finally(() => { reading = false })
    }
    sample()
    const timer = window.setInterval(sample, 1000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  const restart = async () => {
    setRestarting(true)
    setError('')
    try { await window.vdro.restartApp(settings) }
    catch (cause) { setError(String(cause)); setRestarting(false) }
  }
  const modeName = (mode: string) => mode === 'software'
    ? t('软件解码（CPU）', 'Software decoding (CPU)')
    : t('自动（硬件优先）', 'Automatic (prefer hardware)')
  const available = info?.videoDecode === 'enabled'
  const autoLabel = info?.mode === 'auto' && info.decoding === 'hardware' && info.gpuVendor
    ? t(`自动选择（${info.gpuVendor}）`, `Automatic (${info.gpuVendor})`)
    : info?.mode === 'auto' && info.decoding === 'software'
      ? t('自动选择（CPU）', 'Automatic (CPU)')
    : modeName('auto')
  const decodingLabel = info?.decoding === 'hardware' ? t('硬件解码', 'Hardware decoding')
    : info?.decoding === 'software' ? t('软件解码（CPU）', 'Software decoding (CPU)')
      : t('尚未确认（请先播放视频）', 'Not confirmed (play a video first)')
  return (
    <div className="decoder-settings">
      <label className="settings-select-row">
        <span>{t('视频解码模式', 'Video decoding mode')}</span>
        <select value={settings.decoderMode} onChange={(event) => onUpdate({ decoderMode: event.target.value as AppSettings['decoderMode'] })}>
          <option value="auto">{autoLabel}</option>
          <option value="software">{modeName('software')}</option>
        </select>
      </label>
      <p className="settings-hint">{t('自动模式支持 NVIDIA / AMD / Intel，由系统选择可用显卡，不支持的格式会尝试软件解码。修改后重启生效；遇到黑屏或驱动问题可切换软件解码。', 'Automatic mode supports NVIDIA / AMD / Intel, selects an available GPU and falls back to software for unsupported formats. Restart to apply changes. Use software decoding if you experience black screens or driver issues.')}</p>
      <div className="decoder-status" role="status">
        <div>{t('当前运行模式：', 'Current mode: ')}{info ? modeName(info.mode) : t('读取中…', 'Loading…')}</div>
        <div>{t('当前视频解码：', 'Current video decoding: ')}{decodingLabel}{info?.decoderName ? ` · ${info.decoderName}` : ''}</div>
        <div>{t('显卡：', 'GPU: ')}{info?.adapters.join(' / ') || t('未获取', 'Unavailable')}</div>
        <div>{t('硬件视频解码：', 'Hardware video decoding: ')}{!info ? '…' : available ? t('可用', 'Available') : t('未启用或不可用', 'Disabled or unavailable')}</div>
        <div>{t('当前媒体累计帧数：', 'Current media total frames: ')}{frames.total}</div>
        <div>{t('掉帧帧数：', 'Dropped frames: ')}{frames.dropped}</div>
      </div>
      <p className="settings-hint">{t('帧数包含已显示和被丢弃的帧；0 掉帧表示播放器未报告丢帧，不代表一定使用了硬件解码。自动选择的品牌依据本机唯一已识别硬件显卡品牌推定，多品牌显卡设备不标注具体品牌。', 'Frame counts include displayed and dropped frames. Zero dropped frames does not prove hardware decoding. The automatic vendor label is inferred only when one hardware GPU vendor is detected; multi-vendor systems leave it unspecified.')}</p>
      <p className="settings-hint">{t('可用性不代表当前视频正在硬解，具体取决于显卡、驱动和视频编码。音频提取和波形生成仍由 CPU 处理。', 'Availability does not confirm hardware decoding for the current video; GPU, driver and codec support determine usage. Audio extraction and waveform generation still use the CPU.')}</p>
      {info && info.mode !== settings.decoderMode && (
        <div>
          <p className="settings-hint">{t('解码模式已更改，重启后生效。请先保存需要保留的片段。', 'Decoding mode changed. Restart to apply. Save any clips you want to keep first.')}</p>
          <button type="button" className="btn btn-ghost btn-small" disabled={restarting} onClick={() => void restart()}>
            {t('保存设置并重启', 'Save settings and restart')}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
