import { app, type WebContents } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { DecoderInfo } from '../shared/types'

let mode: DecoderInfo['mode'] = 'auto'
const playersByWindow = new Map<number, Map<string, Record<string, string>>>()

// Observe the same player properties exposed by Chromium's Media diagnostics.
// Failure or DevTools taking over the debugger must not prevent playback.
export function monitorDecoders(contents: WebContents): void {
  const players = new Map<string, Record<string, string>>()
  playersByWindow.set(contents.id, players)
  contents.on('destroyed', () => playersByWindow.delete(contents.id))
  contents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) players.clear()
  })
  const debuggerClient = contents.debugger
  debuggerClient.on('detach', () => players.clear())
  debuggerClient.on('message', (_event, method, params) => {
    if (typeof params.playerId !== 'string') return
    let properties = players.get(params.playerId) ?? {}
    if (method === 'Media.playerEventsAdded') {
      for (const event of params.events ?? []) {
        try {
          const value = JSON.parse(event.value)
          if (value.event === 'kWebMediaPlayerDestroyed') {
            players.delete(params.playerId)
            return
          }
          // Recent Chromium versions report the URL in kLoad, not kUrl properties.
          if (value.event === 'kLoad' && typeof value.url === 'string') properties = { kUrl: value.url }
        } catch { /* Ignore an unrecognized diagnostic event. */ }
      }
    } else if (method === 'Media.playerPropertiesChanged') {
      for (const property of params.properties ?? []) {
        if (typeof property.name === 'string' && typeof property.value === 'string') {
          properties[property.name] = property.value
        }
      }
    } else return
    players.delete(params.playerId)
    players.set(params.playerId, properties)
    while (players.size > 16) players.delete(players.keys().next().value!)
  })
  try {
    if (debuggerClient.isAttached()) return
    debuggerClient.attach('1.3')
    void debuggerClient.sendCommand('Media.enable').catch(() => players.clear())
  } catch { players.clear() }
}

// This must run before app.ready. Keep a safe default for legacy or damaged settings.
export function configureDecoder(): void {
  try {
    const settings = JSON.parse(readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'))
    mode = settings.decoderMode === 'software' ? 'software' : 'auto'
  } catch { /* Older installations use automatic decoding. */ }
  if (mode === 'software') {
    // Disable video decode only; retain GPU compositing for the window and waveform.
    app.commandLine.appendSwitch('disable-accelerated-video-decode')
  }
}

export async function getDecoderInfo(contentsId?: number, mediaUrl?: string): Promise<DecoderInfo> {
  const info = await app.getGPUInfo('basic').catch(() => ({})) as {
    gpuDevice?: Array<{ vendorId?: number; deviceId?: number; deviceString?: string; active?: boolean }>
  }
  const vendors: Record<number, string> = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel' }
  const gpuVendors = new Set((info.gpuDevice ?? []).map((device) => vendors[device.vendorId ?? 0]).filter(Boolean))
  // Match the actual video URL so extracted-audio players and old sources cannot win.
  const properties = mediaUrl && contentsId !== undefined
    ? [...(playersByWindow.get(contentsId)?.values() ?? [])].reverse().find((player) => player.kUrl === mediaUrl)
    : undefined
  const decoderName = properties?.kVideoDecoderName ?? null
  const decoding: DecoderInfo['decoding'] = !decoderName ? 'unknown'
    : /^(D3D11VideoDecoder|D3D12VideoDecoder|DXVAVideoDecoder)$/.test(decoderName) ? 'hardware'
      : /^(FFmpegVideoDecoder|VpxVideoDecoder|Dav1dVideoDecoder|AomVideoDecoder)$/.test(decoderName) ? 'software'
        : 'unknown'
  return {
    mode,
    videoDecode: app.getGPUFeatureStatus().video_decode ?? 'unknown',
    decoderName,
    decoding,
    gpuVendor: gpuVendors.size === 1 ? [...gpuVendors][0] : null,
    adapters: (info.gpuDevice ?? []).map((device) => {
      const name = device.deviceString || vendors[device.vendorId ?? 0] || 'GPU'
      return `${name} (0x${(device.deviceId ?? 0).toString(16)})${device.active ? ' *' : ''}`
    }),
  }
}
