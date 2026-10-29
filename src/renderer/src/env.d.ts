import type { VdroApi } from '../../shared/types'

declare global {
  interface Window {
    vdro: VdroApi
  }
}

export {}
