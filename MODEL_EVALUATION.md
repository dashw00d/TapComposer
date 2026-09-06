# Recognition models

The plan names Basic Pitch, CREPE/torchcrepe and ACE-Step. This update downloads and connects **CREPE Tiny** to the actual humming capture path. Basic Pitch and CREPE Small were downloaded for comparison. ACE-Step XL is now connected separately for Premium performance rendering on the local 16GB GPU through an authenticated service. See [the premium runtime documentation](./inference/README.md). It does not replace browser humming recognition.

## Reproducible model sources

`node scripts/download-models.mjs` verifies/restores the bundled Tiny model. `node scripts/download-models.mjs --benchmark` downloads all three comparison models to ignored `outputs/model-comparison/`; then run `node scripts/compare-models.mjs`.

- CREPE Tiny/Small: [pinned Hugging Face files](https://huggingface.co/wok000/vcclient_modules/tree/459397bb763fef82aee673dcb708754bd194313b/onnxcrepe); the mirror points to [onnxcrepe](https://github.com/yqzhishen/onnxcrepe/releases), which attributes its conversion to CREPE/torchcrepe. Model preprocessing includes frame normalization. MIT license.
- Basic Pitch: [pinned HF mirror](https://huggingface.co/daserge/basic-pitch-onnx/tree/2633e680fb5a1c551cee4905410115b6715862f6); SHA-256 matches its published hash for Spotify's ICASSP 2022 ONNX model. Official [Spotify documentation](https://github.com/spotify/basic-pitch) and [model card](https://huggingface.co/spotify/basic-pitch). Apache-2.0.
- ACE-Step: [official model repository](https://huggingface.co/ACE-Step/Ace-Step1.5) and [runtime documentation](https://huggingface.co/docs/diffusers/api/pipelines/ace_step). It is a separate generative audio system, not a replacement for low-latency pitch capture.

## Controlled comparison

Measured on this development machine with the same ONNX Runtime Web WASM backend used in the app, one CPU thread. These are synthetic fixtures at four known pitches, not recordings from users or a general vocal accuracy benchmark. Correct means a detected pitch within half a semitone, including confidence gating; raw frame outputs were compared before the app's note segmentation. Missing-fundamental fixtures contain only upper harmonics. Basic Pitch was evaluated with a simple strongest-note frame decoder, not its full polyphonic note decoder.

| Model       | Clean   | Added noise | Quiet   | Missing fundamental | Approximate inference time per group |
| ----------- | ------- | ----------- | ------- | ------------------- | ------------------------------------ |
| CREPE Tiny  | 240/240 | 240/240     | 240/240 | 215/240             | 1.6–1.7 s for 240 frames             |
| CREPE Small | 240/240 | 240/240     | 240/240 | 120/240             | 3.6 s for 240 frames                 |
| Basic Pitch | 500/500 | 500/500     | 500/500 | 0/500               | 0.2 s for four input windows         |

Tiny was selected for the monophonic humming path because it handled the upper-harmonic case better in this comparison and was faster and smaller than Small. Basic Pitch is an attractive future option for instrument/polyphonic transcription, but these results do not establish that its default decoder is best for this app's humming input. Bigger models did not automatically produce better results here.

## Integration and regression checks

- 16 kHz band-limited voice resampling, 1024-sample centered windows every 20 ms, bounded 32-frame batches. The ONNX model normalizes frames internally.
- 65–1000 Hz pitch range, silence/DC gating, confidence filtering and mild continuity preference, followed by the app's shared note segmentation.
- Model warms when the humming recorder opens. A reusable worker reports progress and retains the model between takes, then releases it after idle time. Actual cancellation terminates computation.
- Inference has a 14-second computation budget and an outer 22-second worker timeout; failure/timeout retries with the quick detector. Long takes on slow devices may use fallback. A take records which analyzer produced its intent.
- Real model regression: six quiet synthetic hummed notes are recovered in order, while the previous YIN gate finds zero. Silence, DC and deterministic broadband noise produce no notes; 44.1/48 kHz input retains pitch and duration. Worker reuse, progress, error fallback and cancellation are separately tested.
- All model/runtime assets are served from the app's own origin. No original recordings leave the browser. Free mode makes no audio inference uploads. Premium explicitly uploads the arranged instrumental WAV to its inference service.

Real-voice, room-noise and mobile-device evaluation is still needed to measure practical accuracy and latency. This integration is a tested recognition improvement, not a claim of perfect transcription or universal model superiority.
