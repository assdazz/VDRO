# VDRO

> 本地音视频片段截取工具 —— 在波形上选一段，一键导出，数据不出本机。  
> A local-first Windows desktop tool to cut and export segments from your own audio & video files.

VDRO is a Windows desktop app for local audio cutting, pitch adjustment, and multitrack mixing.
Create or resume a project from the home page, import audio or video, edit waveform regions,
and export clips or a complete mix through FFmpeg.

- **Projects and drafts**: independent project state, automatic draft recovery, missing-media relinking
- **Multitrack mixing**: drag, trim, split, mute and reverse clips with realtime mix preview
- **Waveform cutting**: wavesurfer.js waveform with drag selection, in/out points, skip, loop
- **Picture & audio sync**: video preview linked to the waveform, adjustable resolution / frame rate
- **Accurate export**: FFmpeg-based extraction with format, quality, sample-rate and channel options, templated filenames
- **Privacy first**: no uploads, no network service. Settings and records stay on your machine
  (portable builds: `.userdata` inside the app directory; installed builds: `%APPDATA%\VDRO`)

![VDRO main interface with material library and extracted audio](docs/screenshots/vdro-extract.png)

## Quick start (development)

Requires Node.js 20.19+ (20.x) or 22.12+, and npm.

```bash
git clone https://github.com/assdazz/VDRO.git
cd vdro
npm install
npm run dev        # launch the dev app with hot reload
```

Build and package:

```bash
npm run typecheck  # tsc --noEmit for node & web configs
npm run build      # electron-vite build -> out/
npm run dist       # electron-builder -> release/
```

## Audio adjustment

Switch between audio cutting and audio adjustment using the tabs at the top.
Audio adjustment supports realtime Rubber Band R3 pitch preview, pitch markers and smooth interpolation,
waveform zoom and marker snapping, gain, fade-in/out, formant preservation and clipping protection.
Combine multiple tracks with clip movement, edge trimming, splitting, reversing, muting, and snapping.
Undo and redo support Ctrl+Z, Ctrl+Y, and Ctrl+Shift+Z.
Output supports WAV, MP3, M4A and FLAC. Both pages share output defaults, saving options and filename templates.
The shared settings dialog includes audio-adjustment defaults. See [audio adjustment](docs/audio-adjustment.md)
and [Rubber Band integration and licensing](docs/audio-engine.md).

## Video decoding

Settings → Preview offers automatic hardware decoding (NVIDIA / AMD / Intel) or software decoding. Restart to apply changes. GPU availability and playback frame counters are shown separately; availability does not confirm the decoder used by the current stream. See [video decoding](docs/video-decoding.md).

## Settings

Click the gear icon at the top-right. The settings cover:

- output defaults: format, quality, sample rate, channels, saving mode, filename template
- preview defaults: resolution, frame rate, skip duration, loop, extracted-video sync
- interface: legacy/modern UI, dark/OLED/acrylic themes, six material tint colors, optional translucent window, accent color, UI scale, layout/sidebar restore
- data: delete confirmations, temporary-file cleanup, waveform-cache limit/cleanup, material-library/extracted-audio persistence
- shortcuts: play, set-in, set-out, seek back/forward, selection and split tools
- reset layout, clear temporary files/waveform cache, and reset all settings

## Portable build

Everything needed to run lives in one self-contained folder:

```text
VDRO\
  VDRO.exe              launcher (built from launcher/VDROLauncher.cs)
  runtime\electron.exe  local Electron runtime
  .userdata\            Electron user data/cache
  out\                  built app
```

The launcher builds once via a C# compiler and starts the runtime with
`--no-sandbox` as compatibility workarounds for non-system
workspace drives. `start-vdro.cmd` is a fallback that builds (if needed) and
launches the same `VDRO.exe`. For users on this drive, install once with
`npm install`; the portable runtime is already in `runtime\`.

## Version 1.3.2

See the [release notes](docs/release-1.3.2.md) for project recovery, the multitrack timeline,
realtime mixing, editing controls, and fixes.

## Installed build

Standard per-user NSIS installer (assisted mode, no administrator rights):

- default install directory `%LOCALAPPDATA%\Programs\VDRO`; data under `%APPDATA%\VDRO`
- Chinese/English UI, themes and accent color, interface scale, independent font size
- remembered window state, always-on-top, start maximized
- temporary-file retention policy, waveform cache management
- creates desktop and Start Menu shortcuts; uninstall keeps user data
- unsigned; SmartScreen may warn; x64 only; no auto-update

## Docs

- UI 截图：`docs/screenshots/`

## License

VDRO project source is provided under the [MIT License](LICENSE). Third-party dependencies retain their own licenses. Rubber Band is GPL licensed with commercial licensing available; the MIT project license alone does not cover a combined binary distribution. See [integration and distribution notes](docs/audio-engine.md).

Note: this prototype bundles FFmpeg from `ffmpeg-static`, which is a GPL build.
FFmpeg runs as an external binary invoked by the app, but if you redistribute a
build you should review GPL/LGPL and H.264 obligations — for a closed-source
commercial release, swap in an LGPL FFmpeg build and review licensing again.

## Limits

Each mix supports up to 64 clips. Pitch automation supports up to 128 markers per clip.
Waveform zoom ranges from 1× to 32×. Audio exports support WAV, MP3, M4A, and FLAC.
