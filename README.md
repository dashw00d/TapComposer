# TapComposer

Tap or hum an idea. TapComposer interprets it through an instrument, adds backing and builds a song. A compact studio lets you shape the result without entering notes or setting up music theory.

## Run

Requires Node.js 22.13+ and npm.

```sh
npm ci
npm run dev
npm run check
npm run build
npm start
```

Microphone capture requires HTTPS or localhost and browser permission. Headphones reduce bleed while recording over existing parts. The private Sites publication may require its owner's sign-in.

## Making a song

1. Choose piano, drums, bass, guitar, strings, or synth. Every instrument accepts humming, the touch/keyboard tap pad, or microphone desk taps.
2. Hear an interpretation, retry or smooth it, then keep it. The first idea establishes a pulse and provisional key. Taps become chords, bass movement or a melody according to the chosen instrument.
3. Keeping an idea automatically creates complementary backing and a five-section song. A hummed melody informs the harmony; your original performance and recording remain available.
4. Choose a feel, change the energy, or try another version. Section order, length, instrument membership and your recorded ideas survive regeneration.
5. Shape sections: move, lengthen, shorten, duplicate, remove, rename, decide which parts play, set entrances, play a part once or repeat it, and move pitched parts up or down an octave.
6. Change any idea's instrument without recording again. Preview, rename, duplicate, smooth, replace or remove parts. Balance exposes level, pan, mute, solo and overall volume.
7. Play the song or its ingredients, seek to a section or position, repeat and adjust song speed. Save the full arrangement as stereo WAV, 192 kbps MP3, or MIDI. Download a project backup to move an editable song, including original audio, to another browser.

The app supports 24 parts, 30 seconds per take, 12 sections and at most 512 beats of arrangement. These are resource limits rather than setup choices. Songs autosave locally; undo/redo retains up to 50 edits. Existing two-instrument songs retain their patterns and recordings and can be expanded with **Build my song**.

Keyboard: Space plays/stops when focus is outside an interactive control; Ctrl/Command Z undoes; Shift Ctrl/Command Z redoes; Ctrl/Command S downloads a project backup; Escape stops playback. Dialogs, sliders and recording controls support keyboard interaction.

## Architecture

Music processing runs in the browser. The hosted Worker serves the app and bundled assets; there are no recording upload endpoints, analytics, cloud inference calls, or application accounts.

| Module | Responsibility |
| --- | --- |
| `public/worklets/capture.js` | Audio-clock capture, meter, explicit start, 30-second cap; no microphone monitoring |
| `lib/music/capture.ts` | Permission, cancellation, original WAV preservation, analysis worker |
| `lib/music/neural.ts` | CREPE Tiny inference, voice resampling, confidence filtering and melodic segmentation |
| `lib/music/analysis-client.ts` | Warm worker reuse, progress, cancellation and bounded fallback |
| `lib/music/analyze.ts` | YIN fallback, shared note segmentation and adaptive tap onset detection |
| `lib/music/resolve.ts` | Pulse/key estimates, soft correction and instrument-specific interpretation |
| `lib/music/harmony.ts` | Melody-weighted diatonic harmony |
| `lib/music/composition.ts` | Backing, feel/variation, section structure, tempo scaling and shared arranged event stream |
| `lib/music/audio.ts` | Samples, drum/synth DSP, audio-clock scheduling, stereo mix, effects and offline rendering |
| `lib/music/export.worker.ts` | MP3 encoding away from the interface thread |
| `lib/music/project.ts`, `midi.ts` | Validated editable project backup/import and portable MIDI |
| `lib/music/storage.ts` | IndexedDB songs/original audio and migration of source tempo |
| `hooks/use-song-history.ts` | Snapshot undo/redo retaining original audio by reference |
| `components/recorder.tsx` | Capture and take review |
| `components/composition-panel.tsx` | Automatic composition, optional section arrangement and balance |
| `components/composer.tsx` | Studio, transport, library, instrument changes and export |

The `MusicalIntent` layer separates human input from instrument performance. Tempo changes scale playback without rewriting source timing. Playback, WAV/MP3 and MIDI use the same arrangement, section membership and mix choices. Regeneration replaces suggested backing while retaining original ideas and manual structure.

Humming uses a pretrained CREPE Tiny neural pitch tracker, executed locally by ONNX Runtime Web in the analysis worker. The model and runtime load when the humming recorder opens and remain warm between takes. Confidence and silence gates filter predictions before shared note segmentation. Model loading, unsupported devices and slow inference fall back to YIN; capture and cancellation remain available. Tapping continues to use onset detection. The composer uses local chord scoring and instrument rules; no trained composer or generative cloud render is included. See [MODEL_EVALUATION.md](./MODEL_EVALUATION.md) for the evaluated alternatives and limitations.

The 1.96 MB CREPE model is bundled under `public/models`; the pinned 14 MB WASM runtime and loader are copied locally by `predev`/`prebuild`. No model or recording request goes to Hugging Face at runtime. `node scripts/download-models.mjs` restores missing weights and verifies their SHA-256 checksum.

Four sample banks are bundled locally: grand piano, electric bass, acoustic guitar and violin-based strings, about 3.3 MB in total. Drums and synth are generated. No third-party sound CDN is required during playback. Assets must load first; an installable, offline-cached PWA is not included.

## Verification and practical limits

`npm run check` runs strict TypeScript, application lint, and 40 automated engine, persistence, audio and component interaction tests. Coverage includes pitch/noise/tap fixtures, all instrument/input combinations, automatic structure and variations, preservation of manual edits, tempo scaling, entrances/repeat/register, seek/repeat scheduling, backup import validation, MIDI, undo, original-audio persistence, sample decoding, bounded stereo rendering and WAV/MP3 decoding. Component interaction tests exercise arranging and the tap-to-piano keep flow in jsdom. Production output is built and checked through HTTP requests.

The untouched generated Shadcn catalog and its generated mobile hook are excluded from application lint because of upstream lint violations. They remain typechecked; application code and tests are linted.

Automated verification does not establish subjective musical quality or microphone behavior across real devices. Humming is monophonic; pitch ambiguity, noisy rooms, breathy voices and speaker bleed can reduce accuracy. Beatboxing sound classification, polyphonic transcription, arbitrary audio imports and professional plugin hosting are not implemented. Device microphone, touch-browser and screen-reader evaluation remain valuable user testing.

Songs live in this browser's IndexedDB. Clearing site data or switching origins does not carry songs over. Use **Save project** and **Open project** to preserve or transfer editable songs. Storage failures remain visible, and original recordings can be downloaded separately.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for sound and encoder attribution.
