# Tuning Center

Open **[Tuning Center](http://localhost:3000/tuning)** or use its link at the bottom of the composer. This is a recording and comparison workspace, not a claim that voice recognition has already improved.

## First recording pass

1. Open **Your recording setup** and enter a nickname, microphone/device, and room description. Each take snapshots these fields, so changing the setup later does not relabel older recordings.
2. Use headphones when available. **Hear the melody** plays the score before recording. Pick a starting pitch you can sing comfortably and a pace you can follow. Keep these settings consistent across comparisons.
3. Start with **Hmm** and **Close · 15 cm**. Work through the 15 melodies with **Record my take**, then **Keep & next melody**. The moving score shows each pitch and duration, and the large cue names the current note. The recorder counts down, captures one second of room sound, follows the exercise, and leaves a quiet tail before stopping automatically.
4. Listen to each recording. Use **Try again** to immediately start another attempt, or **Keep this take** to stay on the same exercise. Kept takes can be rerecorded using **Rerecord this exercise**. Earlier kept attempts remain in the export; unkept drafts do not.
5. Repeat with **Daa** and **Baa**. Change just one condition at a time. Then try the 40 cm and 80 cm distances while retaining the microphone gain, room, root, and pace. Do not simulate microphone distance by turning down an existing file: actually move relative to the microphone.
6. Enter a note about mistakes or interruptions. These takes are useful even when the singing is imperfect.
7. **Export session** downloads a JSON bundle containing the original WAVs, intended score, timing, style, distance, recording setup, and take notes. Recordings also survive reloads in this browser. Keep an export before switching browser/origin or clearing site data.

The full matrix is 15 melodies × 3 vocal styles × 3 distances = 135 conditions per pitch/pace/monitoring setup. It is fine to start with one 15-take pass. Progress is shown for the current combination; changing pitch, pace, guide monitoring, or recording set starts a distinct combination.

## The three supported vocal styles

- **Hmm:** lips gently closed, a separate “hm” onset per note, continuous “mmm” during held notes. Briefly stop between repeated notes.
- **Daa:** one soft D at each onset, holding the “aa” vowel at the target pitch. Short “da” and long “daaa” follow the displayed duration. Sing rather than speak.
- **Baa:** one gentle lip closure/opening per B, then hold “aa.” Separate repeated syllables and avoid blowing into the microphone.

The Tuning Center evaluates all three styles locally. The composer now has an explicit **Voice style** selector: **Hmm** uses the tuned local path, while **Daa/Baa** retain the existing server-first recognition with local fallback. The selected style is saved with the source intent and restored for rerecording. Daa/Baa have not yet been tuned against Ryan's recordings.

The 15 exercises cover sustained notes, repeated notes at one pitch, ascending/descending steps, a rising/falling phrase, alternating notes, thirds, a chord outline, repeats followed by movement, short/long notes, rests, held-note transitions, half-beat rhythms, wider jumps, and a combined phrase.

## Reference playback and microphone timing

With headphones, **Play the melody while I record** schedules the reference against the capture audio clock. With speakers selected, the reference is disabled during capture; listen first and follow the visual score. The input is never monitored back to the speakers. Browser microphone processing requests echo cancellation, noise suppression, and automatic gain control off, as in the composer; devices may still apply their own processing.

The exported target note times are relative to the original microphone WAV, including its first quiet second. Target timing does not silently shift to match the detector. Hardware output/input latency and human reaction time remain real sources of disagreement; the experiment does not automatically calibrate them away.

## Noise and listening comparisons

The review panel can run the local detector on a clean recording or a copy mixed with synthetic hiss or fan-like rumble at 20, 10, or 0 dB SNR. **New noise pattern** changes the deterministic seed. You can hear both the detector input and its synthesized detected notes. These panel comparisons are exploratory; the session export retains original takes, not the temporary noise previews or predictions.

SNR is calculated from full-recording RMS, including silence. Shared attenuation prevents clipping without changing the ratio. Synthetic noise is a repeatable diagnostic, not a replacement for real room recordings. Record noise-only WAVs for the batch evaluator if you want fans, conversations, television, traffic, or other real backgrounds mixed in later. Do not play them aloud during the initial clean recordings.

## Reproducible evaluation

From the application directory:

```sh
npm run voices:lab -- /path/to/tuning-session.json --out outputs/tuning/baseline
```

This runs the existing CREPE Tiny detector against the latest kept revision of each tuning condition: clean, plus two synthetic noise sources at three SNRs. It writes original/variant WAVs, pitch traces, predictions, file/model/code hashes, a JSON report, a Markdown table, and an empty annotation template. It refuses to overwrite an existing report directory.

To add real background noise, supply a directory of PCM16 mono WAVs at 8–192 kHz. The first 30 seconds of each noise file are used, resampled to 16 kHz, with a seeded starting offset and looping if necessary:

```sh
npm run voices:lab -- /path/to/tuning-session.json \
  --out outputs/tuning/with-room-noise \
  --noise-dir /path/to/noise-only-wavs
```

A source take and every noise variant stay in the same partition. Use **Save fresh takes for a later check → Fresh check set** to collect recordings that are not used to tune the next candidate. The browser deliberately does not run the detector on these takes. Evaluate them explicitly only when the candidate is fixed:

```sh
npm run voices:lab -- /path/to/tuning-session.json \
  --out outputs/tuning/check-candidate-1 --split heldout
```

Keep candidate comparisons on the same exports, annotations, and generated noise conditions. A separate session/singer/device is a stronger generalization check than another take by the same singer.

## Intended notes versus actual sung notes

The score is the **prompt**, not ground truth for what the microphone captured. Three measurements remain separate:

- **Prompt agreement:** detector output compared with the intended score. Includes singing mistakes, latency, and recognition errors.
- **Clean consistency:** noisy output compared with the same detector’s clean output. Measures sensitivity to added noise, not correctness.
- **Transcription accuracy:** output compared with independently reviewed notes in the actual clean recording. Absent until those annotations exist.

Copy `annotation-template.json`, listen to each original, enter the notes actually sung as `{ "time": 1.04, "duration": 0.62, "pitch": 48 }` (seconds and MIDI pitch), and mark only reviewed entries `"status": "reviewed"`. `promptOnly` is context and is never read as an annotation. Then run:

```sh
npm run voices:lab -- /path/to/tuning-session.json \
  --out outputs/tuning/annotated-baseline --annotations /path/to/reviewed-notes.json
```

The matcher uses one-to-one note matching, 50-cent pitch tolerance, 50/100 ms onset views, and an additional duration-aware view requiring offsets within the larger of 50 ms or 20% of the reference duration. It does not transpose or shift the predictions to inflate a score. These conventions follow [mir_eval transcription metrics](https://mir-eval.readthedocs.io/stable/api/transcription.html); controlled noise power follows the [Torchaudio augmentation approach](https://docs.pytorch.org/audio/main/tutorials/audio_data_augmentation_tutorial.html).
## Whole-clip phrase cleanup

Recognition now estimates room-level activity from the complete clip before
turning pitch frames into notes. Browser and server use the same conservative
level-contrast rule. The server also uses sustained unvoiced intervals as rest
boundaries when the learned boundary model misses repeated syllables.

The existing reversible phrase cleanup now fits rests as well as note attacks:
tiny interruptions join up, clear pauses retain space, and separate syllables
keep separate attacks. Source audio and capture timestamps stay intact; overdub
alignment is unchanged. This is a heuristic, not a trained Hmm/Daa/Baa separator,
and cannot reliably reject unrelated sounds that overlap the voice at similar
levels. A continuous take without quiet room samples defers to pitch voicing.

Ryan's 2026-09-22 Hmm development replay is in
`outputs/tuning/ryan-hmm-phrases/review.html`: 105 cached clean/noisy conditions,
with original audio and before/after synthesized comparisons for the 15 clean
takes. Early detections before 0.75 s drop from 17 to zero; total notes from 143
to 99. These are diagnostics, not transcription accuracy. On 22 annotated
development clips, local note F1 at 100 ms changes from 72.40% to 73.32%; on 22
cached server development traces, 79.74% to 80.92%. Server models were not rerun,
and no new held-out data was used. Daa/Baa and independent performance labels
remain necessary before claiming broader accuracy improvements.

## Hmm timing refinement, 2026-09-22

The next pass adds acoustic repeated-syllable evidence (a pitch dip and envelope
gesture together), plus optional `pitchDrift` metadata for reversible cleanup.
Raw note pitches and capture times remain available. Cleanup absorbs short
settling fragments, favors simple pulses, requires stronger evidence for triplets,
and fits clear rests separately from note lengths. It uses the selected tempo;
it never consumes target notes, melody IDs, or expected note counts.

On Ryan's 15 clean Hmm recordings at their recorded 90 BPM, cleaned output now
has 81 notes and matches all 15 guide **relative onset patterns**. This diagnostic
ignores pitch and subtracts each phrase's first onset explicitly. It does not
claim exact absolute timing, note endings, or perfect transcription. These clips
were used for development. A new song still has to infer its tempo, whereas
this experiment knows the recorded BPM. The source export is untouched.

Listen at `outputs/tuning/hmm-timing/review.html`, including original audio,
previous cleanup, and updated cleanup. `review-data.json` contains all 105 cached
clean/noisy replays, absolute and relative timing scores, and source hashes.
The Tuning Center also exposes **Hear cleaned phrase** beside raw detection.

After freezing the candidate, local recognition on 18 reserved annotated corpus
clips changed onset-only F1 at 100 ms from 83.02% to 83.48%, pitch/onset F1 at
100 ms from 73.95% to 74.35%, and the stricter 50 ms pitch/onset F1 from 64.35%
to 64.31%. These are existing corpus checks, not new Hmm recordings. The server
decoder was replayed separately on 22 development and 18 reserved full-model
traces, with small improvements in its 100 ms metrics. Its Hmm outputs differ,
which is why explicit Hmm recordings select the local recognizer. Detailed
per-recording results are alongside the listening comparison.

The batch evaluator now reports timing independently of pitch and a separately
labeled relative cleaned-rhythm diagnostic. Verified transcription still
requires reviewed annotations of what was actually sung.
