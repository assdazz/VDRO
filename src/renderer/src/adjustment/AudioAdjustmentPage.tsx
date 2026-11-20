import type { AppSettings } from '@shared/types'
import { AudioMixWorkspace } from './AudioMixWorkspace'
import './adjustment-desk.css'

export default function AudioAdjustmentPage({ active, incoming, settings, projectId }: {
  settings: AppSettings
  projectId?: string
  active: boolean
  incoming: { path: string; key: number } | null
}) {
  return <div className={`app adjustment-app theme-${settings.theme} material-${settings.materialColor} accent-${settings.accent}`}>
    <AudioMixWorkspace projectId={projectId} settings={settings} active={active} incoming={incoming}/>
  </div>
}
