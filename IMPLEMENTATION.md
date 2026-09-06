# Composition workspace goal

User objective: tap OR hum to compose a song, with a FruityLoops-like composition workflow and extreme quality of life.

Acceptance requirements (completion must be supported by working implementation and verification):

- [x] Tap or hum into piano, drums, bass, guitar, strings, and synth; switch an existing idea's instrument without rerecording.
- [x] Tap-only pitched accompaniment uses inferred song harmony; hum preserves recognizable melodic intention.
- [x] Studio-feeling pattern workspace: select, preview, duplicate, rename, and delete; detailed editing is optional and secondary to automatic composition.
- [x] Automatic multi-section song arrangement with accessible section/clip adjustments; users must not have to manually place notes to compose.
- [x] One-action backing and song-building assistance grounded in the user's existing idea.
- [x] Transport: pattern/song modes, play/stop, seek, repeat, automatic tempo plus accessible speed control.
- [x] Mix: per-part level, pan, mute, solo, master level; consistent playback and export.
- [x] Quality of life: undo/redo, keyboard shortcuts, safe autosave, project backup/import, original input preservation, clear empty/error states, touch/keyboard access.
- [x] MP3/WAV full-song exports and portable MIDI export.
- [x] Existing saved songs migrate without losing original recordings or user patterns.
- [x] Production build, HTTP runtime verification and 34 automated engine/data/audio/component interaction checks.

Implemented scope: six input-independent instruments, source-preserving automatic song composition, optional section arrangement, transport, mix, project portability and audio exports. The earlier two-instrument MVP is not the completion criterion.

Verification: strict TypeScript and application lint; automated audio/DSP, data, composition and jsdom interaction checks; production build and HTTP runtime smoke. Real microphone/device and subjective listening evaluation are not claimed by these tests. Local rules and harmony scoring power the instant arranger; neural transcription and the optional heavy generative render remain future enhancements from the plan.

Release workflow: push the exact source, save its validated build as a Sites version, then publish to the existing owner-only site. Sites records the source commit, saved version and deployment outcome; publication is verified separately from implementation checks.

Steering: auto-arrange by default; use AI only where it helps. Do not turn the product into a MIDI workshop. Prioritize automatic backing, structure, feel controls, and variations over note editing.
