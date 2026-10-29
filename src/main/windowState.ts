import { app, BrowserWindow, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
}

const DEFAULT_STATE: WindowState = {
  width: 1440,
  height: 920,
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function isValidPosition(x: number, y: number, width: number, height: number): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const left = Math.max(x, area.x)
    const top = Math.max(y, area.y)
    const right = Math.min(x + width, area.x + area.width)
    const bottom = Math.min(y + height, area.y + area.height)
    return right - left >= 80 && bottom - top >= 80
  })
}

export function loadWindowState(enabled: boolean): WindowState {
  if (!enabled) return DEFAULT_STATE
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<WindowState>
    const width = Math.max(1040, Math.min(4000, Number(parsed.width) || DEFAULT_STATE.width))
    const height = Math.max(720, Math.min(3000, Number(parsed.height) || DEFAULT_STATE.height))
    const x = Number.isFinite(parsed.x) ? Number(parsed.x) : undefined
    const y = Number.isFinite(parsed.y) ? Number(parsed.y) : undefined
    if (x === undefined || y === undefined || !isValidPosition(x, y, width, height)) {
      return { width, height }
    }
    return { x, y, width, height }
  } catch {
    return DEFAULT_STATE
  }
}

export function attachWindowStatePersistence(
  window: BrowserWindow,
  enabled: boolean,
): void {
  if (!enabled) return
  let timer: NodeJS.Timeout | null = null

  const save = (): void => {
    if (window.isDestroyed()) return
    const bounds = window.getNormalBounds()
    try {
      mkdirSync(path.dirname(statePath()), { recursive: true })
      writeFileSync(
        statePath(),
        JSON.stringify({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }),
        'utf8',
      )
    } catch {
      // Window state persistence is non-critical.
    }
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 300)
  }

  window.on('resize', schedule)
  window.on('move', schedule)
  window.on('maximize', schedule)
  window.on('unmaximize', schedule)
  window.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}

export function hasSavedWindowState(): boolean {
  return existsSync(statePath())
}
