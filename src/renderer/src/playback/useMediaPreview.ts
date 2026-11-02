import { useEffect } from 'react'
import type { RefObject } from 'react'
import type { ImportedMedia } from '@shared/types'

interface PreviewOptions {
 media: ImportedMedia | null; hasVideo: boolean; nativePreview: boolean;
 videoRef: RefObject<HTMLVideoElement | null>; previewCanvasRef: RefObject<HTMLCanvasElement | null>;
 extractedAudioRef: RefObject<HTMLAudioElement | null>; extractedPlaybackRef: RefObject<boolean>;
 previewResolution: number; previewFps: number;
 setDuration: (value: number) => void; setCurrentTime: (value: number) => void;
 setPlaying: (value: boolean) => void; setPreviewing: (value: boolean) => void;
 setPlayingExtractedId: (value: string | null) => void;
}

export function useMediaPreview({ media, hasVideo, videoRef, previewCanvasRef, extractedAudioRef, extractedPlaybackRef, nativePreview, previewResolution, previewFps, setDuration, setCurrentTime, setPlaying, setPreviewing, setPlayingExtractedId }: PreviewOptions): void {
  useEffect(() => {
    const video = videoRef.current
    if (!video || !media) return

    const onLoadedMetadata = (): void => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration)
      }
    }
    const onTimeUpdate = (): void => {
      const mediaDuration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 0
      setCurrentTime(
        mediaDuration > 0 && video.currentTime >= mediaDuration - 0.03
          ? mediaDuration
          : video.currentTime,
      )
    }
    const onPlay = (): void => {
      if (extractedPlaybackRef.current) {
        setPlaying(true)
        return
      }
      extractedAudioRef.current?.pause()
      setPlayingExtractedId(null)
      setPlaying(true)
    }
    const onPause = (): void => {
      setPlaying(false)
      setPreviewing(false)
    }
    const onEnded = (): void => {
      // timeupdate often stops slightly before the real media duration, so
      // the preview progress bar never reaches 100% for audio-only media.
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration)
        setCurrentTime(video.duration)
      }
      setPlaying(false)
      setPreviewing(false)
    }

    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.load()

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
    }
  }, [media])

  useEffect(() => {
    const video = videoRef.current
    const canvas = previewCanvasRef.current
    if (!media || !hasVideo || !video || !canvas || nativePreview) return

    const context = canvas.getContext('2d')
    if (!context) return

    let frame = 0
    let lastDraw = 0

    const draw = (): void => {
      if (!video.videoWidth || !video.videoHeight) return
      const aspect = video.videoWidth / video.videoHeight
      // Resolution is an upper bound. Avoid allocating a 4K canvas for a small preview.
      const displayHeight = Math.max(1, Math.ceil(video.clientHeight * window.devicePixelRatio))
      const height = Math.min(previewResolution, video.videoHeight, displayHeight)
      const width = Math.max(1, Math.round(height * aspect))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      context.drawImage(video, 0, 0, width, height)
    }

    const loop = (now: number): void => {
      if (video.paused) return
      if (now - lastDraw >= 1000 / previewFps) {
        draw()
        lastDraw = now
      }
      frame = requestAnimationFrame(loop)
    }

    const start = (): void => {
      cancelAnimationFrame(frame)
      lastDraw = 0
      frame = requestAnimationFrame(loop)
    }
    const stop = (): void => {
      cancelAnimationFrame(frame)
      draw()
    }

    video.addEventListener('loadedmetadata', draw)
    video.addEventListener('loadeddata', draw)
    video.addEventListener('canplay', draw)
    video.addEventListener('seeked', draw)
    video.addEventListener('timeupdate', draw)
    video.addEventListener('play', start)
    video.addEventListener('pause', stop)
    draw()
    const initialFrame = requestAnimationFrame(draw)
    if (!video.paused) start()

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(initialFrame)
      video.removeEventListener('loadedmetadata', draw)
      video.removeEventListener('loadeddata', draw)
      video.removeEventListener('canplay', draw)
      video.removeEventListener('timeupdate', draw)
      video.removeEventListener('seeked', draw)
      video.removeEventListener('play', start)
      video.removeEventListener('pause', stop)
    }
  }, [media, hasVideo, previewResolution, previewFps, nativePreview])
}
