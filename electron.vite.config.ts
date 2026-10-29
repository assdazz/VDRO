import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Production-only CSP: the inline meta in src/renderer/index.html must carry
// ws:/localhost allowances for HMR during development, but those allowances
// must never ship in the packaged renderer. This plugin rewrites the
// Content-Security-Policy meta at build time only, leaving dev untouched.
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' vdro-media:; connect-src 'self' vdro-media:;"

const hardenCsp: Plugin = {
  name: 'vdro-harden-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const meta = /(<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content=")([^"]*)(")/i.exec(html)
    if (!meta) return html
    return html.replace(meta[0], `${meta[1]}${PROD_CSP}${meta[3]}`)
  },
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react(), hardenCsp],
  },
})
