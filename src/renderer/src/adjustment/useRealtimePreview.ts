import { useEffect, useRef, useState, type RefObject } from 'react'
import { RubberBandNode } from './RubberBandNode'
import type { AudioAdjustment } from '@shared/types'
import { fadeLevel } from '@shared/fades'
import { pitchAt, sortedPitchPoints } from '@shared/pitch'

type Preview = { active: boolean; effects: AudioAdjustment; start: number; end: number }
const clamp = (value: number, low: number, high: number) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : low
export function previewGain(time: number, state: Pick<Preview, 'effects' | 'start' | 'end'>) {
  const { effects, start, end } = state
  return 10 ** (clamp(effects.gainDb, -24, 12) / 20) * fadeLevel(time, effects, start, end)
}

/** One streaming graph per audio element; editing never re-decodes the whole file. */
export function useRealtimePreview(audio: RefObject<HTMLAudioElement | null>, state: Preview) {
  const latest = useRef(state); latest.current = state
  const refresh = useRef<() => void>(() => undefined)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const player = audio.current
    if (!player) return
    const context = new AudioContext({ latencyHint: 'interactive' })
    let disposed = false
    let cleanup = () => undefined as void
    void (async () => {
      const processor = await RubberBandNode.create(context)
      if (disposed) { processor.dispose(); return }
      player.preservesPitch = false
      const source = context.createMediaElementSource(player)
      const wet = context.createGain(), gain = context.createGain()
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -1; limiter.knee.value = 3
      limiter.attack.value = .003; limiter.release.value = .1
      source.connect(processor); processor.connect(gain); gain.connect(limiter); limiter.connect(wet); wet.connect(context.destination)
      let limiting: boolean | undefined
      let muteUntil = 0
      let lastPitchKey = ''
      const ramp = (param: AudioParam, value: number, now: number) => {
        const held = param.value
        param.cancelScheduledValues(now)
        param.setValueAtTime(held, now)
        param.linearRampToValueAtTime(value, now + .015)
      }
      const update = () => {
        const current = latest.current, now = context.currentTime
        const audible = current.active && !player.paused && !player.seeking && now >= muteUntil
        ramp(wet.gain, audible ? 1 : 0, now)
        if (limiting !== current.effects.limiter) {
          limiting = current.effects.limiter; limiter.ratio.setTargetAtTime(limiting ? 20 : 1, now, .02)
        }
        ramp(processor.formantStrength, current.effects.preserveFormants ? 1 : 0, now)
        processor.playbackRate.value = player.playbackRate
        const points = sortedPitchPoints(current.effects.pitchPoints)
        const pitchKey = JSON.stringify([points, current.effects.semitones, player.playbackRate, player.paused])
        if (pitchKey !== lastPitchKey) {
          lastPitchKey = pitchKey
          const param = processor.pitchSemitones
          const held = param.value
          param.cancelScheduledValues(now); param.setValueAtTime(held, now)
          param.linearRampToValueAtTime(clamp(pitchAt(points, player.currentTime + .06 * player.playbackRate, current.effects.semitones), -12, 12), now + .06)
          if (!player.paused) for (const point of points) {
            const delay = (point.time - player.currentTime) / player.playbackRate
            if (delay > .06) param.linearRampToValueAtTime(point.semitones, now + delay)
          }
        }
        // Follow the audible (buffer-delayed) position, without repeatedly
        // cancelling automation ramps during playback.
        gain.gain.setTargetAtTime(previewGain(player.currentTime - processor.latencySeconds, current), now, .015)
      }
      const fail = () => { player.pause(); setError('实时试听处理失败，请重新打开音频调整页面。') }
      processor.onprocessorerror = fail
      const play = () => { if (!latest.current.active) { player.pause(); return }; void context.resume().then(update).catch(fail) }
      const pause = () => { update(); void context.suspend().catch(() => undefined) }
      const seek = () => { lastPitchKey = ''; processor.reset(); muteUntil = context.currentTime + processor.latencySeconds; update() }
      player.addEventListener('play', play); player.addEventListener('pause', pause)
      player.addEventListener('seeking', seek); player.addEventListener('emptied', seek)
      const timer = window.setInterval(() => { if (!player.paused) update() }, 25)
      refresh.current = () => { update(); if (!latest.current.active) pause() }
      update(); setReady(true)
      if (!player.paused) play(); else void context.suspend()
      cleanup = () => {
        clearInterval(timer); refresh.current = () => undefined
        player.removeEventListener('play', play); player.removeEventListener('pause', pause)
        player.removeEventListener('seeking', seek); player.removeEventListener('emptied', seek)
        source.disconnect(); processor.dispose()
      }
    })().catch(cause => { if (!disposed) { player.pause(); setError('无法启用实时试听：' + String(cause)) } })
    return () => { disposed = true; cleanup(); void context.close() }
  }, [audio])
  useEffect(() => { refresh.current() }, [state.active, state.effects, state.start, state.end])
  return { ready, error }
}
