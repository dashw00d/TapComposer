# TapComposer

Tap or hum an idea. TapComposer interprets it through an instrument, adds backing and builds a song. A compact studio lets you shape the result without entering notes or setting up music theory.

## Run

Requires Node.js 22.15+ and npm.

```sh
npm ci
npm run dev
npm run check
npm run build
npm start
```

Microphone capture requires HTTPS or localhost and browser permission. Headphones reduce bleed while recording over existing parts. Open http://localhost:3000. This app runs as a local Node process and requires no ChatGPT account or hosted service.

The local server reads `.env.local` (see `.env.example`). The configured GPU services can be started with `systemctl --user start tapcomposer-ace tapcomposer-gateway`. The app and both inference services bind only to loopback.

## Making a song

1. Start with **Hum an idea** or **Tap a rhythm**, then audition piano, drums, bass, guitar, strings, or synth. Expand the instrument drawer to choose a sound before recording. Every instrument accepts every input.
2. For humming or desk taps, click **Start recording**. The microphone and sounds prepare first; a visible **3–2–1 → Start** countdown leads into capture. Click **Stop recording** when finished, or cancel during the countdown. Capture and backing share an audio-clock start, and leading silence stays part of the take. Hear an interpretation, retry or smooth it, then keep it. Optional controls layer several instruments from the same recording and audition them with the song. The first idea establishes a pulse and provisional key. Taps become chords, bass movement or a melody according to the chosen instrument.
3. Keeping an idea automatically creates complementary backing and a five-section song. A hummed melody informs the harmony; your original performance and recording remain available.
4. Choose a feel, change the energy, or try another version. Section order, length, instrument membership and your recorded ideas survive regeneration.
5. Drag section titles to reorder and right edges to resize; buttons and arrow keys offer the same changes. Section options include names, entrances, smooth fades, repetition and octave changes. **Shape the journey** reveals a drawable energy curve, accessible sliders and presets that shape dynamics and backing; suggesting lengths is optional.
6. Select a part for musical directions: simpler, more movement, answer the melody, come in later, or leave more space. Suggested changes and regenerated arrangements open a Before/Proposed comparison with Keep, Go back and, for arrangements, Try another. Accepted directions are kept automatically and remain undoable. Change any idea's instrument without recording again. Preview, rename, duplicate, smooth, replace or remove parts. Balance exposes level, pan, mute, solo and overall volume.
7. Play the song or its ingredients, seek to a section or position, repeat and adjust song speed. Save the full arrangement as stereo WAV, 192 kbps MP3, or MIDI. Download a project backup to move an editable song, including original audio, to another browser.

8. In Premium, give the song a studio finish. Add optional direction, choose how closely it follows the arrangement, then make a take. Compare the editable arrangement and saved takes at a shared playback position with RMS listening levels matched by attenuation, save WAV, or keep arranging and render again. Up to three takes survive browser saves and editable project backups. Free mode keeps all local tools and makes no audio uploads.

**Keep** pins a part, a section (including its shared parts), or harmony against automatic changes. Direct manual edits remain available. Keeping editable parts does not guarantee identical notes in the separate ACE-Step finished mix. **Save another direction** creates a separate editable song with its source recordings and studio takes; both remain in the local library.

The app supports 24 parts, 30 seconds per take, 12 sections and at most 512 beats of arrangement. These are resource limits rather than setup choices. Songs autosave locally; undo/redo retains up to 50 edits. Existing two-instrument songs retain their patterns and recordings and can be expanded with **Build my song**.

Keyboard: Space plays/stops when focus is outside an interactive control; Ctrl/Command Z undoes; Shift Ctrl/Command Z redoes; Ctrl/Command S downloads a project backup; Escape stops playback. Dialogs, sliders and recording controls support keyboard interaction.

## Architecture

Free mode runs music processing on the device. Premium adds ACE-Step XL cover rendering through the local GPU gateway. Both experiences are tested locally; the Premium label represents the future product tier. Account billing is not implemented. See [inference/README.md](./inference/README.md) for the GPU service, configuration, limits and operational requirements.

| Module                             | Responsibility                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `public/worklets/capture.js`       | Audio-clock capture, meter, explicit start, 30-second cap; no microphone monitoring        |
| `lib/music/capture.ts`             | Permission, cancellation, original WAV preservation, analysis worker                       |
| `lib/music/neural.ts`              | CREPE Tiny inference, voice resampling, confidence filtering and melodic segmentation      |
| `lib/music/analysis-client.ts`     | Warm worker reuse, progress, cancellation and bounded fallback                             |
| `lib/music/analyze.ts`             | YIN fallback, shared note segmentation and adaptive tap onset detection                    |
| `lib/music/resolve.ts`             | Pulse/key estimates, soft correction and instrument-specific interpretation                |
| `lib/music/harmony.ts`             | Melody-weighted diatonic harmony                                                           |
| `lib/music/composition.ts`         | Backing, feel/variation, section structure, tempo scaling and shared arranged event stream |
| `lib/music/audio.ts`               | Samples, drum/synth DSP, audio-clock scheduling, stereo mix, effects and offline rendering |
| `lib/music/export.worker.ts`       | MP3 encoding away from the interface thread                                                |
| `lib/music/project.ts`, `midi.ts`  | Validated editable project backup/import and portable MIDI                                 |
| `lib/music/storage.ts`             | IndexedDB songs/original audio and migration of source tempo                               |
| `hooks/use-song-history.ts`        | Snapshot undo/redo retaining original audio by reference                                   |
| `components/recorder.tsx`          | Capture and take review                                                                    |
| `components/composition-panel.tsx` | Automatic composition, optional section arrangement and balance                            |
| `components/composer.tsx`          | Studio, transport, library, instrument changes and export                                  |

The `MusicalIntent` layer separates human input from instrument performance. Tempo changes scale playback without rewriting source timing. Playback, WAV/MP3 and MIDI use the same arrangement, section membership and mix choices. Section fades use continuous Web Audio gain envelopes; MIDI approximates them with CC11 expression at quarter-beat intervals. Regeneration replaces suggested backing while retaining original ideas and manual structure.

Humming uses a pretrained CREPE Tiny neural pitch tracker, executed locally by ONNX Runtime Web in the analysis worker. The model and runtime load when the humming recorder opens and remain warm between takes. Confidence and silence gates filter predictions before shared note segmentation. Model loading, unsupported devices and slow inference fall back to YIN; capture and cancellation remain available. Tapping continues to use onset detection. The immediate composer uses local chord scoring and instrument rules. Premium then renders the actual arrangement with ACE-Step XL, preserving tempo/key conditioning and editable source parts. See [MODEL_EVALUATION.md](./MODEL_EVALUATION.md) for the evaluated alternatives and limitations.

The 1.96 MB CREPE model is bundled under `public/models`; the pinned 14 MB WASM runtime and loader are copied locally by `predev`/`prebuild`. No model or recording request goes to Hugging Face at runtime. `node scripts/download-models.mjs` restores missing weights and verifies their SHA-256 checksum.

Four sample banks are bundled locally: grand piano, electric bass, acoustic guitar and violin-based strings, about 3.3 MB in total. Drums and synth are generated. No third-party sound CDN is required during playback. Assets must load first; an installable, offline-cached PWA is not included.

## Verification and practical limits

`npm run check` runs strict TypeScript, application lint, and automated engine, persistence, audio and component interaction tests. Coverage includes pitch/noise/tap fixtures, all instrument/input combinations, automatic structure and variations, preservation of manual edits, tempo scaling, entrances/repeat/register, seek/repeat scheduling, backup import validation, MIDI, undo, original-audio persistence, sample decoding, bounded stereo rendering and WAV/MP3 decoding. Additional coverage exercises pins, directions, independent branches, layered source retention, fade envelopes in real audio, comparison position across rapid switches, and discard/retry/accept/undo in the complete composer. Component tests run in jsdom with the same Vinext link alias used by the application. Production output is built and checked through HTTP requests.

The untouched generated Shadcn catalog and its generated mobile hook are excluded from application lint because of upstream lint violations. They remain typechecked; application code and tests are linted.

Automated verification does not establish subjective musical quality or microphone behavior across real devices. Humming is monophonic; pitch ambiguity, noisy rooms, breathy voices and speaker bleed can reduce accuracy. Device input/output latency is not calibrated automatically; headphones avoid speaker bleed, and microphone capture requests echo cancellation, noise suppression and automatic gain control off to preserve musical attacks. Beatboxing sound classification, polyphonic transcription, arbitrary audio imports and professional plugin hosting are not implemented. Device microphone, touch-browser and screen-reader evaluation remain valuable user testing.

Songs live in this browser's IndexedDB. Clearing site data or switching origins does not carry songs over. Use **Save project** and **Open project** to preserve or transfer editable songs. Storage failures remain visible, and original recordings can be downloaded separately.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for sound and encoder attribution.
