import { useLayoutEffect, useRef, type RefObject } from 'react'

const duration = 620
const settle = 'cubic-bezier(0.2, 0.72, 0.24, 1)'

export function useStartupBrand(
  homeRef: RefObject<HTMLDivElement | null>,
  ready: boolean,
  enabled: boolean,
): void {
  const considered = useRef(false)

  useLayoutEffect(() => {
    if (!ready || considered.current) return
    if (!enabled) {
      considered.current = true
      return
    }

    const listeners = new AbortController()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const home = homeRef.current
    const brand = home?.querySelector<HTMLElement>('.topbar .brand')
    const curtain = home?.querySelector<HTMLElement>('.startup-curtain')
    let rise: Animation | undefined
    let reveal: Animation | undefined

    function finish() {
      listeners.abort()
      if (rise) {
        rise.onfinish = null
        rise.cancel()
      }
      reveal?.cancel()
      home?.classList.remove('is-launching')
    }

    function start() {
      if (document.hidden || considered.current) return
      considered.current = true
      if (!home || !brand || !curtain || reducedMotion.matches) {
        finish()
        return
      }

      const frame = home.getBoundingClientRect()
      const target = brand.getBoundingClientRect()
      const x = frame.left + frame.width / 2 - target.left - target.width / 2
      const y = frame.top + frame.height / 2 - target.top - target.height / 2
      const center = `translate(${x}px, ${y}px) scale(2)`
      home.classList.add('is-launching')

      rise = brand.animate([
        { offset: 0, transform: center, opacity: 0 },
        { offset: 0.22, transform: center, opacity: 1 },
        { offset: 0.31, transform: center, opacity: 1, easing: settle },
        { offset: 1, transform: 'none', opacity: 1 },
      ], duration)
      reveal = curtain.animate([
        { offset: 0, opacity: 1 },
        { offset: 0.29, opacity: 1, easing: settle },
        { offset: 0.88, opacity: 0 },
        { offset: 1, opacity: 0 },
      ], duration)
      rise.onfinish = finish
    }

    const subscription = { signal: listeners.signal }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && considered.current) finish()
      else start()
    }, subscription)
    document.addEventListener('pointerdown', finish, { ...subscription, capture: true })
    document.addEventListener('keydown', finish, { ...subscription, capture: true })
    window.addEventListener('resize', finish, subscription)
    reducedMotion.addEventListener('change', finish, subscription)
    start()

    return finish
  }, [enabled, homeRef, ready])
}
