import ffmpegStatic from 'ffmpeg-static'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'

function unpackedPath(input: string): string {
  // electron-builder can leave the module path pointing inside app.asar even
  // when the binary itself was unpacked. Keep dev paths untouched.
  return input.includes('app.asar')
    ? input.replace('app.asar', 'app.asar.unpacked')
    : input
}

export const ffmpegPath = unpackedPath(ffmpegStatic as unknown as string)
export const ffprobePath = unpackedPath(ffprobeInstaller.path)
