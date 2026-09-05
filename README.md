# TapComposer · MVP + polish

Hum a short melody, hear it on a sampled grand piano, then tap in a drum part. No account, tempo selector, or music-theory controls are needed inside the application. The privately hosted preview may require its owner's Sites sign-in.

## Run

Requires Node.js 22.13+ and npm.

```sh
npm ci
npm run dev
npm run check
npm run build
npm start
```

`npm start` serves the built Cloudflare Worker locally. Use the URL printed by each server. Microphone capture requires HTTPS or localhost and browser permission. Headphones reduce bleed while recording over existing parts.

## Shipped scope

- Piano: microphone permission, hold-to-hum and click-to-start/finish recording, pitch detection, automatic note grouping, soft timing correction, and sampled piano playback.
- Drums: accessible touch/keyboard pad or microphone desk-tap detection; rhythm and accent interpretation into kick, snare, and hat.
- Listen immediately, keep a take, retry, record over an existing part, and undo smoothing.
- Up to 12 parts per song and 30 seconds per take. Existing parts play once from the same song clock while recording. The first take establishes tempo and a provisional key.
- Independent part playback, mute, removal with undo, and whole-song repeat. Shorter parts retain their original length when a longer part is added.
- Automatic local saving, multiple named songs, and preservation/download of original microphone WAV recordings.
- Stereo WAV and 192 kbps MP3 downloads, rendered from audible parts using the same sampler/mix as playback. Exports contain one whole song pass plus a short effects tail.
- Responsive layout, keyboard controls, focus-managed dialogs, reduced-motion support, error recovery, and an optional example song.

## Architecture

All music processing runs in the browser. The hosted Worker serves the app and bundled assets; there are no recording upload endpoints, analytics, cloud inference calls, or account requirements in application code.

| Module                       | Responsibility                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `public/worklets/capture.js` | AudioWorklet mono PCM capture, input meter, explicit song-clock start, 30-second cap; no microphone monitoring                |
| `lib/music/capture.ts`       | Permission/capture lifecycle, cancellation, WAV preservation, analyzer-worker dispatch                                        |
| `lib/music/analyze.ts`       | YIN pitch tracking, median smoothing, voiced-note segmentation, adaptive RMS onset detection                                  |
| `lib/music/types.ts`         | Versioned MusicalIntent, SongContext, Track, Song, performance events                                                         |
| `lib/music/resolve.ts`       | Pulse/key estimates, soft timing correction, piano/drum interpretation, reversible smoothing                                  |
| `lib/music/audio.ts`         | Bundled piano samples, synthesized drum one-shots, audio-clock scheduling, gentle compression/room effects, offline rendering |
| `lib/music/export.worker.ts` | MP3 encoding away from the interface thread                                                                                   |
| `lib/music/storage.ts`       | IndexedDB song + original recording persistence, downloads                                                                    |
| `components/recorder.tsx`    | Capture/review flow                                                                                                           |
| `components/composer.tsx`    | Song workspace, local library, part actions, export                                                                           |

Piano samples are bundled locally (17 minor-third-spaced samples, C2–C6, about 1.3 MB). No third-party sound CDN is needed at runtime. The app requires loading its page/assets before use; an installable/offline-cached PWA is not part of this MVP.

The `MusicalIntent` abstraction preserves pitches, confidence, timing, duration, intensity and source independently of arranged events. A first track's leading silence is trimmed in intent coordinates; original PCM stays untouched. Later tracks retain their initial offset. Future analyzers and instruments can replace isolated modules.

## Verification

`npm run check` runs strict TypeScript, application lint, and 15 automated tests. Tests cover six wobbly synthetic hummed notes, common sample rates, low/high pitches, silence/DC/noise rejection, tap onsets/accents, tempo, soft timing, smoothing reversibility, WAV headers, IndexedDB round trips with original blobs, capture timing/release/limits, real sampled stereo rendering, and successful WAV/MP3 decoding. Audio rendering tests use a native Web Audio implementation without needing a microphone or speakers.

The untouched generated Shadcn catalog and its generated mobile hook are excluded from application lint because they contain upstream lint violations. They remain type-checked. Application code and tests are linted.

The automated tests establish engine behavior, not subjective quality on every real microphone. Real-voice, device, touch-browser, screen-reader, and permission-dialog testing remains a release acceptance step. Humming should be monophonic and reasonably clear. YIN is a deterministic prototype, not Basic Pitch/CREPE or a trained vocal model. Pitch ambiguity, noisy rooms, breathy voices, and speaker bleed can reduce accuracy. The tempo/key estimator is intentionally conservative and does not infer chord progressions in this version.

Songs live only in this browser's IndexedDB. Clearing site data or changing browsers/origins does not migrate songs. Storage failures remain visible; audio/original downloads provide an immediate way to preserve work. MP3/WAV are rendered audio, not editable project backups.

## Next milestones from the plan

1. Test the “six ugly notes, then desk taps” interaction with non-musicians on real devices. Benchmark YIN against Basic Pitch / CREPE using consented recordings.
2. V0.2: bass and guitar arrangers; better project-level key/chord inference.
3. V0.3: strings, synth, and changing instrument without another recording.
4. Expand smoothing and accompaniment while preserving the simple interface.
5. Only after the instant workflow is useful: opt-in feedback data, symbolic models, and an optional generative render. No training-data collection or heavy generative feature is implemented here.

## Sound licenses

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md). The in-app credits provide the same sample attribution and privacy explanation.
