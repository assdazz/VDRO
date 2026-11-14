# Rubber Band realtime migration

Realtime pitch now uses rubberband-wasm 3.3.0 (Rubber Band R3, real-time, short window, high-consistency pitch, linked stereo channels, no internal threads) inside AudioWorklet. The local WASM asset is about 265 KB and is bundled for offline operation. Native Electron ABI modules, external DLLs and SharedArrayBuffer are not required. CSP permits wasm-unsafe-eval, not general unsafe-eval.

Source audio continues streaming through the existing media element. Gain/fades use Web Audio, clipping protection now uses a DynamicsCompressor rather than a hard-clipping curve. Pitch curves are scheduled on the audio clock only when edits or playback state change. The stretcher uses start padding, latency discard and an 85 ms output reserve; the estimated initial delay at 48 kHz is about 112 ms, plus device latency. Seeking resets the stretcher.

Export still uses the bundled FFmpeg rubberband filter. The installed filter does not expose an R3 engine switch; therefore realtime R3 and rendered output are not claimed to be bit-identical. Existing format, marker, formant and export controls are retained.

Checks: Electron file renderer loads WASM under production CSP; a 330 Hz tone shifts to about 660 Hz; marker selection/interpolation, live gain/fade, rendered-result switching and page pause pass. Streaming benchmark: 4000 blocks at 48 kHz, zero underruns, about 0.17 ms average per 128-sample callback on this machine (synthetic signal, not a guarantee for all material/hardware).

## Distribution

Rubber Band is GPL licensed, with commercial licensing available. Existing VDRO/VDRO-NEW project license files have NOT been relicensed. An MIT project label alone does not cover distribution of the combined executable. Before public distribution, use a GPL-compatible distribution and provide corresponding source/build instructions, or obtain appropriate commercial authorization. No installer or public push was performed in this migration. Upstream license and source locations are included in renderer/third-party.
