import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import ffmpeg from 'ffmpeg-static'

const outDir = join(process.cwd(), '.fixtures')
mkdirSync(outDir, { recursive: true })

if (!ffmpeg) {
  throw new Error('ffmpeg-static did not provide a binary path')
}

const video = join(outDir, 'sample.mp4')
const audio = join(outDir, 'sample.wav')

const videoResult = spawnSync(
  ffmpeg,
  [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '12',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    video,
  ],
  { stdio: 'inherit' },
)
if (videoResult.status !== 0) throw new Error('failed to create sample.mp4')

const audioResult = spawnSync(
  ffmpeg,
  [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:sample_rate=44100',
    '-t',
    '8',
    '-c:a',
    'pcm_s16le',
    audio,
  ],
  { stdio: 'inherit' },
)
if (audioResult.status !== 0) throw new Error('failed to create sample.wav')

console.log(video)
console.log(audio)
