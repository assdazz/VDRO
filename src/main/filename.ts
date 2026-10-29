import path from 'node:path'

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

export function formatTimeToken(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const s = totalSeconds % 60
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  return `${pad(h)}-${pad(m)}-${pad(s)}-${pad(ms, 3)}`
}

function sanitizePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildFileName(
  template: string,
  sourcePath: string,
  start: number,
  end: number,
  extension: string,
): string {
  const now = new Date()
  const source = sanitizePart(path.basename(sourcePath, path.extname(sourcePath)))
  const duration = Math.max(0, end - start)
  const ext = extension.replace(/^\./, '')
  const normalizedTemplate = template.trim() || '{source}_{start}-{end}'

  let result = normalizedTemplate
    .replace(/\{source\}/g, source)
    .replace(/\{start\}/g, formatTimeToken(start))
    .replace(/\{end\}/g, formatTimeToken(end))
    .replace(/\{duration\}/g, duration.toFixed(3).replace('.', '_'))
    .replace(/\{date\}/g, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    .replace(/\{time\}/g, `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`)
    .replace(/\{ext\}/g, ext)

  result = sanitizePart(result).slice(0, 160)
  if (!result) result = `${source || 'audio'}_${formatTimeToken(start)}-${formatTimeToken(end)}`

  const lower = result.toLowerCase()
  if (!lower.endsWith(`.${ext.toLowerCase()}`)) {
    result = `${result}.${ext}`
  }
  return result
}
