# Audio processing and third-party licensing

## Realtime preview

Realtime pitch processing uses rubberband-wasm 3.3.0 with the Rubber Band R3 engine inside an AudioWorklet. The local WebAssembly asset is bundled for offline use.

Audio preview uses Web Audio with streamed media or scheduled PCM blocks for multitrack playback. Supported PCM WAV files can be read directly. Other sources are prepared for the selected ranges as needed. Gain and fades use Web Audio, and clipping protection uses a DynamicsCompressor. Pitch changes are scheduled on the audio clock. Seeking resets the pitch processor.

The processor buffers audio before playback. The response delay depends on the sample rate, processor buffering, and audio device.

## Export

Audio export uses the bundled FFmpeg Rubber Band filter. Realtime preview and exported audio use different processing paths and can sound slightly different. Generated results can be played for comparison.

## Distribution

Rubber Band is GPL licensed, with commercial licensing available. Third-party components retain their own licenses. The MIT license for VDRO source code alone does not cover distribution of the combined executable.

Public distributions require a GPL-compatible distribution with corresponding source and build instructions, or appropriate commercial authorization.

The bundled license, upstream source locations, exact package version, and build instructions are listed in [RubberBand-NOTICE.txt](../src/renderer/public/third-party/RubberBand-NOTICE.txt) and [RubberBand-LICENSE.txt](../src/renderer/public/third-party/RubberBand-LICENSE.txt).
