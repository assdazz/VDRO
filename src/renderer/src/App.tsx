import { lazy, Suspense, useState, useEffect, useRef } from 'react'
import { translateDom } from './i18n'
import ClipEditor, { IconSettings } from './ClipEditor'
import { DEFAULT_APP_SETTINGS } from '@shared/defaults'
import type { ExtractedClip } from '@shared/types'
const AudioAdjustmentPage = lazy(() => import('./adjustment/AudioAdjustmentPage'))
export default function App() {
 const shell = useRef<HTMLDivElement>(null)
 const [page,setPage]=useState<'clip'|'adjust'>('clip')
 const [settings,setSettings]=useState(DEFAULT_APP_SETTINGS)
 const [settingsRequest,requestSettings]=useState(0)
 const [incoming,setIncoming]=useState<{path:string;key:number}|null>(null)
 useEffect(()=>{
  document.documentElement.style.setProperty('--vd-font-scale', String(settings.fontScale/100))
 },[settings.fontScale])
 useEffect(()=>{
  const root=shell.current
  if(!root)return
  document.documentElement.lang=settings.language
  const options={subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder']}
  const apply=()=>{observer.disconnect();translateDom(root,settings.language);observer.observe(root,options)}
  const observer=new MutationObserver(apply)
  apply()
  return ()=>observer.disconnect()
 },[settings.language])
 const navigate=(next:'clip'|'adjust')=>{document.querySelectorAll<HTMLMediaElement>('video,audio').forEach(element=>element.pause());setPage(next)}
 const adjustClip=(clip:ExtractedClip)=>{setIncoming({path:clip.filePath,key:Date.now()});navigate('adjust')}
 return <div ref={shell} className="page-shell"><div className="page-frame" hidden={page!=='clip'}><ClipEditor active={page==='clip'} onNavigate={navigate} onAdjustClip={adjustClip} settingsRequest={settingsRequest} onSettingsChange={setSettings}/></div><div className="page-frame" hidden={page!=='adjust'}><Suspense fallback={null}><AudioAdjustmentPage active={page==='adjust'} incoming={incoming} onNavigate={navigate} settings={settings}/></Suspense></div><div id="settings-root" className={`app theme-${settings.theme} material-${settings.materialColor} accent-${settings.accent}`} style={{display:'contents'}}><button className="topbar-settings-btn shared-settings-btn" type="button" title="设置" aria-label="打开设置" onClick={()=>requestSettings(value=>value+1)}><IconSettings /></button></div></div>
}
