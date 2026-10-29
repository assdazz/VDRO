import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'

const mediaFiles = new Map<string, string>()

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
}

export function registerMediaFile(id: string, filePath: string): void {
  mediaFiles.set(id, filePath)
}

export function getMediaPath(id: string): string | undefined {
  return mediaFiles.get(id)
}

export function unregisterMediaFile(id: string): void {
  mediaFiles.delete(id)
}

export function mediaUrl(id: string): string {
  return `vdro-media://media/${encodeURIComponent(id)}`
}

function contentType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

interface ByteRange {
  start: number
  end: number
}

function parseRange(header: string | null, size: number): ByteRange | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  let start: number
  let end: number

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  start = Math.max(0, Math.min(start, size - 1))
  end = Math.max(start, Math.min(end, size - 1))
  return { start, end }
}

async function serveFile(filePath: string, request: Request): Promise<Response> {
  const fileStat = await fs.stat(filePath).catch(() => null)
  if (!fileStat || !fileStat.isFile()) {
    return new Response('Not found', { status: 404 })
  }

  const size = fileStat.size
  const range = parseRange(request.headers.get('range'), size)
  const headers = new Headers({
    'Content-Type': contentType(filePath),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  })

  if (request.method === 'HEAD') {
    if (range) {
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
      headers.set('Content-Length', String(range.end - range.start + 1))
      return new Response(null, { status: 206, headers })
    }
    headers.set('Content-Length', String(size))
    return new Response(null, { status: 200, headers })
  }

  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    headers.set('Content-Length', String(range.end - range.start + 1))
    const stream = createReadStream(filePath, { start: range.start, end: range.end })
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers,
    })
  }

  headers.set('Content-Length', String(size))
  const stream = createReadStream(filePath)
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers,
  })
}

export function registerMediaProtocol(): void {
  protocol.handle('vdro-media', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'media') {
      return new Response('Not found', { status: 404 })
    }

    let id: string
    try {
      id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {
      return new Response('Invalid media id', { status: 400 })
    }
    const filePath = mediaFiles.get(id)
    if (!filePath) {
      return new Response('Not found', { status: 404 })
    }

    try {
      return await serveFile(filePath, request)
    } catch {
      return new Response('Unable to read media', { status: 500 })
    }
  })
}
