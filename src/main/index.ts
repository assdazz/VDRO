import { app, BrowserWindow, Menu, protocol } from 'electron'
import { existsSync, mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { importMedia, registerIpc } from './ipc'
import { computePeaks } from './media/peaks'
import { probeMedia } from './media/probe'
import { exportToFile } from './media/export'
import { ffmpegPath, ffprobePath } from './media/binaries'
import { registerMediaProtocol } from './media/protocol'
import { loadSettings } from './settings'
import { cleanupExtractedByPolicy, cleanupExtractedOrphans, clearExtractedFiles } from './storage'
import { attachWindowStatePersistence, loadWindowState } from './windowState'
import type { AppSettings } from '../shared/types'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vdro-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

// Development keeps its portable data beside the checkout. The installed
// build uses the standard per-user location so Program Files remains read-only.
const isInstalled =
  app.isPackaged || existsSync(path.join(process.resourcesPath, 'app.asar'))
const appRoot = isInstalled ? null : app.getAppPath()
const userDataPath =
  process.env.VDRO_USER_DATA ||
  (isInstalled
    ? path.join(app.getPath('appData'), 'VDRO')
    : path.join(appRoot as string, '.userdata'))
mkdirSync(userDataPath, { recursive: true })
app.setPath('userData', userDataPath)

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

const isDev = !app.isPackaged
const screenshotArg = process.argv.find((arg) => arg.startsWith('--screenshot='))
const openArg = process.argv.find((arg) => arg.startsWith('--open='))
const smokeIndex = process.argv.indexOf('--smoke')

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
})

function createWindow(settings: AppSettings): BrowserWindow {
  const windowState = loadWindowState(settings.rememberWindowState)
  const window = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: '#000000',
    show: !screenshotArg,
    autoHideMenuBar: true,
    title: 'VDRO',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.setAlwaysOnTop(settings.alwaysOnTop)
  attachWindowStatePersistence(window, settings.rememberWindowState)
  if (settings.startMaximized && !screenshotArg) {
    window.maximize()
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (openArg) {
    const filePath = openArg.slice('--open='.length)
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void (async () => {
          try {
            const imported = await importMedia(filePath)
            window.webContents.send('app:open-media', imported)
          } catch (error) {
            console.error('Unable to open media from command line', error)
          }
        })()
      }, 300)
    })
  }

  if (screenshotArg) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void (async () => {
          const image = await window.webContents.capturePage()
          const target = screenshotArg.slice('--screenshot='.length)
          await fs.writeFile(target, image.toPNG())
          app.quit()
        })()
      }, openArg ? 8000 : 1200)
    })
  }

  return window
}

async function runSmoke(filePath: string): Promise<void> {
  const info = await probeMedia(filePath)
  const audio = info.audioStreams.find((stream) => stream.isDefault) ?? info.audioStreams[0]
  if (!audio) throw new Error('SMOKE: no audio stream')

  const peaks = await computePeaks(filePath, audio.index, info.duration)
  const outputPath = path.join(app.getPath('temp'), `vdro-smoke-${Date.now()}.wav`)

  await exportToFile(filePath, outputPath, {
    start: 0.5,
    end: Math.min(2.5, Math.max(0.7, info.duration - 0.1)),
    format: 'wav',
    sampleRate: 48000,
    channels: 2,
    bitrate: 192,
    audioStreamIndex: audio.index,
  })

  const outputInfo = await probeMedia(outputPath)
  console.log(
    'SMOKE_OK',
    JSON.stringify({
      ffmpegPath,
      ffprobePath,
      sourceDuration: info.duration,
      peaks: peaks.peaks.length,
      peaksPerSecond: peaks.peaksPerSecond,
      outputDuration: outputInfo.duration,
      outputSize: outputInfo.size,
    }),
  )
  await fs.rm(outputPath, { force: true })
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  app.setAppUserModelId('top.vdro.app')
  Menu.setApplicationMenu(null)
  const settings = await loadSettings()
  if (!settings.persistExtracted) {
    // Extracted clips are session-scoped here: the metadata index is deleted,
    // so any leftover files would become untracked orphans that can never be
    // listed or deleted from the UI. Clear the index and the files together.
    await clearExtractedFiles()
  } else if (settings.cleanTempOnStartup) {
    await cleanupExtractedOrphans()
    await cleanupExtractedByPolicy(
      settings.tempRetentionDays,
      settings.tempSizeLimitMB,
    )
  }
  registerMediaProtocol()
  registerIpc()

  if (smokeIndex >= 0) {
    const filePath = process.argv[smokeIndex + 1]
    if (!filePath) {
      console.error('SMOKE_ERROR missing input file')
      app.exit(1)
      return
    }
    try {
      await runSmoke(filePath)
      app.quit()
    } catch (error) {
      console.error('SMOKE_ERROR', error)
      app.exit(1)
    }
    return
  }

  createWindow(settings)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings)
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
