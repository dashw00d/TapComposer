# Real voice evaluation

Premium recognition now uses a GPU model ensemble and a new note decoder; Free keeps the browser model. This improves measured pitch and note timing on the real vocal bank, but does not establish reliable recognition for every casual hum. No model training or fine-tuning was performed.

## Quiet-input and cleanup update

The app now automatically raises very quiet premium-analysis input into a useful range, removes material DC offset, and bounds amplification/headroom. Healthy-level input bypasses gain correction. This operates on an analysis copy; the saved recording and capture clock remain intact. Free recognition still uses the browser engine.

**Clean up my take** replaces the previous smoothing operation. It selectively absorbs weak short pitch/octave interruptions, preserves confident short notes and repeated syllables, compresses loudness variation, and gently tightens only a clearly established pulse (including triplets). The first onset stays fixed and other timing moves are capped at 18 ms. It does not snap humming into the inferred key. Cleaned monophonic instruments release overlapping tails more quickly, with a faster string attack. Undo restores and auditions the original notes; manual edits and source audio remain protected.

Final results and source hashes: [benchmarks/voice-cleanup.json](./benchmarks/voice-cleanup.json).

| Check | Before | After |
| --- | ---: | ---: |
| All 40 clean corpus clips, note F1 at 100 ms | 73.28% | 73.34% |
| Eight tuning clips at 1/40 amplitude | 45.72% | 72.88% |
| Eight reserved clips at 1/40 amplitude | 71.75% | 73.65% |
| Applying cleanup to the same 40 final transcriptions | Old smoothing: 52.00% | New cleanup: 73.34% |

The last row measures the previous button's excessive timing/key changes, **not a new recognition jump from 52% to 73%**. Unprocessed final transcriptions also score 73.34%; the new cleanup preserves this aggregate score. Note metrics do not score loudness, releases or perceived musical quality. The earlier smoothing score is reproduced from its exact piano pitch/onset rules at `7e182fb`.

The quiet tests multiply original samples by 0.025 without altering pitch, timing or reference annotations. Additional 12 dB white-noise and DC-offset checks are recorded in the JSON; results are mixed and there is no claim to general denoising. The same public 30-second recording through the actual client/WAV/HTTP path recovered 47 notes at normal volume and 48 when quiet, with 96.8% note agreement between predictions. This consistency score is separate from human-reference accuracy. Original and replayed normal-volume predictions were identical.

A general spectral filter did not consistently improve noisy clips. Normalizing every take changed otherwise good boundaries. Neither is enabled. The shipped method corrects weak input selectively; strong rumble, background music, clipping and genuinely ambiguous singing remain limitations. Both singer groups have been inspected, so these are regression checks rather than a fresh blind test.

95 app tests, five Python tests, GPU checks (including very quiet humming and noise), a real rendered-audio tail check, and the production build passed. A UI test verifies that cleanup and undo each audition the right version and save the restored notes.

```bash
../inference/voice-venv/bin/python scripts/benchmark-voice-conditioning.py my-quiet-dev dev
../inference/voice-venv/bin/python scripts/benchmark-voice-conditioning.py my-quiet-reserved heldout
npx tsx scripts/score-voice-conditioning.ts my-quiet-dev
npx tsx scripts/score-voice-conditioning.ts my-quiet-reserved
../inference/voice-venv/bin/python scripts/benchmark-gpu-voices.py my-final-voices all
npx tsx scripts/score-gpu-voices.ts my-final-voices
npx tsx scripts/benchmark-phrase-cleanup.ts my-final-voices my-cleanup
```

The conditioning runner picks eight evenly spaced IDs from each lexicographically sorted singer group; it runs the exact engine with correction enabled and disabled. All labels must be fresh. Full results stay in ignored local outputs.

## Premium GPU results — September 7, 2026

| Engine / group | Clips | Pitch recall | Note F1, 100 ms | Note F1, 50 ms |
| --- | ---: | ---: | ---: | ---: |
| Browser / all | 40 | 94.69% | 68.27% | 59.71% |
| Premium GPU / all | 40 | 97.15% | 73.28% | 66.31% |
| Premium GPU / tuning | 22 | 96.95% | 74.02% | 66.99% |
| Premium GPU / reserved | 18 | 97.39% | 72.36% | 65.48% |

The exact engine was rerun on all 40 clips after the final decoder change. Results and source/model fingerprints are in [benchmarks/voice-premium.json](./benchmarks/voice-premium.json). Mean inference time was **0.51 seconds per clip**, including the first cold call, with **886 MiB peak PyTorch allocation** on the RTX 4070 Ti Super. This is not total process/desktop VRAM. The live HTTP/client smoke test took **0.70 seconds** for the 30-second prefix of the wordless recording and returned identical notes on replay.

ROSVOT/RWBD learned boundaries are aligned to full-CREPE acoustic pitch; RMVPE supplies conditioning for the boundary model. Unsupported splits are merged when pitch and volume continue smoothly. Raw ROSVOT output was worse than the browser baseline, so its note classes/timing are not used directly. Random pitch-bin dithering in torchcrepe was removed, and its weighted decoder was replaced with deterministic weighting of the actual probabilities. The app now preserves natural humming timing unless the user chooses smoothing.

Both singer groups improved in aggregate, but some individual recordings still regress. The reserved recordings were inspected during development and are **regression evidence, not an unseen validation claim**. Most labeled clips are singing, and repeated syllables, room noise, microphone latency and backing bleed still need broader human-recorded validation. Synthetic checks cover held vibrato, repeated same-pitch syllables, changing notes, silence and quiet noise; they are separate from human-voice accuracy evidence.

The 138 public RSH examples can also be replayed through the running premium HTTP service for listening comparisons. They remain **unlabeled**: their predictions are neither ground truth nor training data. [Service installation and behavior](./inference/VOICE_SETUP.md).

```bash
../inference/voice-venv/bin/python scripts/benchmark-gpu-voices.py my-gpu-run all
npx tsx scripts/score-gpu-voices.ts my-gpu-run
python3 scripts/benchmark-gpu-hums.py
npm run voices:report -- baseline-tiny baseline-heldout my-gpu-run --premium-hums
npm run voices:serve
```

Output labels must be fresh. The RSH replay preserves an existing `listening-premium.json`; move it aside before another run. All corpus audio remains in ignored outputs and is not bundled with the app.

## Data on this machine

- **vocadito:** 40 solo vocal recordings, 29 singer IDs in the downloaded metadata, with human frame-level pitch and two independent human note annotations. Includes a wordless “la” recording, but most files contain sung words. It is a proxy for casual humming, not a complete humming benchmark. [Publisher and download](https://zenodo.org/records/5578807), [technical report](https://arxiv.org/abs/2110.05580).
- **RSH:** 1,380 w-series recordings extracted locally, with three deterministic examples per speaker (138 from 46 speakers) selected for the listening gallery. The published corpus contains reading, singing and humming; the w-series selection excludes its r/s-series and TI files. It has no note-level ground truth. Its model predictions are explicitly unscored listening aids, never labels for evaluating or training the same detector. [Publisher](https://zenodo.org/records/3816618), [corpus paper](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0241809).

Both selected sources identify CC BY 4.0. Attribution: Rachel M. Bittner, Katherine Pasalo, Juan José Bosch, Gabriel Meseguer-Brocal, David Rubinstein (2021), *vocadito*, DOI 10.5281/zenodo.5578807; shi (2020), *RSH dataset*, DOI 10.5281/zenodo.3816618. Original audio is unchanged; decoded PCM is cropped to the app's 30-second limit for analysis. Generated predictions and report graphics are our processing.

Audio, archives, detailed prediction traces and generated HTML stay in ignored `outputs/voice-benchmark/`, outside `public/`. The local gallery runs separately from the app. It uploads nothing and uses no GPU. Corpus archive checksums are verified before extraction; selected RSH files have SHA-256 identities in their manifest.

HumTrans was considered, but its original onset/offset labels have documented problems and its dataset card specifies CC BY-NC. It was not downloaded, trained on, or used in the measurements. [Dataset](https://huggingface.co/datasets/dadinghh2/HumTrans), [annotation investigation](https://github.com/shubham-gupta-30/humming_transcription). More files alone do not solve bad or missing reference labels.

## Browser baseline measurements

Browser decoder, source revision `e44049c`; pinned model hashes and per-recording results are saved in [benchmarks/voice-baseline.json](./benchmarks/voice-baseline.json). Neural frame extraction was factored out of `neuralHum` without changing its computation, so the benchmark calls the same inference and segmentation functions used in capture.

| Model / group | Recordings | Pitch recall | Note F1, 100 ms | Note F1, 50 ms | Inference seconds per audio second |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tiny / tuning | 22 | 94.17% | 67.74% | 59.51% | 0.35 |
| Small / tuning | 22 | 94.71% | 68.75% | 59.67% | 0.77 |
| Tiny / reserved singers | 18 | 95.32% | 68.92% | 59.96% | 0.34 |

Pitch recall counts reference-voiced frames recovered within 50 cents, including missed voicing as errors. Frame reports separately record voiced recall and false voicing in reference-silent frames. Note F1 uses maximum one-to-one matching of predicted MIDI pitches with human reference pitches within 50 cents and onsets within 50/100 ms. Duplicate predictions cannot claim the same reference note. No time shifting, melody alignment, octave correction or reference transposition is applied. Offsets are shown for listening but are **not** part of these note F1 scores.

All scores are unweighted means by recording; note scores also average the two annotators independently. App notes are rounded to MIDI pitches before scoring, so poor tuning can contribute to note errors even when frame tracking is correct. Pitch tracking versus note F1 is not a pure segmentation ablation. Final instrument register, key inference, soft timing correction and automatic arranging are excluded and still require separate end-to-end checks.

The split was chosen before tuning from singer identity: first byte of `SHA256("tapcomposer-voice-v1:" + singer_id)`, modulo 3; zero reserved, otherwise tuning. That gives 16 tuning and 13 reserved singers, with no singer overlap. Every recording is scored up to 30 seconds, matching the app's take limit. The corpus contains longer excerpts, so these are **not** full-dataset leaderboard scores. Now that reserved results have been inspected, repeated optimization against them would invalidate their status as an unseen test; future work needs fresh validation data.

Backend: the same single-thread ONNX Runtime Web WASM model execution used in the app, running under Node on this desktop. The offline benchmark raises its computation budget to 60 seconds to finish comparative model runs; it does not exercise the app's 14-second deadline, worker fallback, microphone capture or device latency. Some independent runs overlapped on different CPU cores, so latency figures are indicative rather than a controlled hardware benchmark.

## What failed

Small adds only about one point of note F1 on tuning recordings and takes more than twice the processing time. That is not a sufficient fix, especially with the browser computation deadline.

An experimental whole-phrase decoder improved tuning note F1 from 67.74% to 70.42%, but reserved note F1 only moved from 68.92% to 69.28%. Some recordings regressed substantially. It passed the existing synthetic segmentation tests but still failed the practical generalization check, so it was **not shipped**. The [experimental patch](./benchmarks/rejected-phrase-decoder.patch) is archived against the baseline solely for reproducibility; it is not imported by the app or benchmark.

The evidence supports focusing on note boundaries, repeated syllables, slides, and tuning-to-note conversion, while retaining pitch tracking as a separate metric. It does not show that boundaries are the only problem. Recorded backing bleed, mic levels and microphone processing have not been measured here.

## Reproduce / listen

Run from the app directory. Dataset downloads and benchmarks are intentionally opt-in rather than part of routine CI.

```bash
npm run voices:download -- --rsh
node scripts/download-models.mjs --benchmark
npm run voices:benchmark -- my-tiny-dev tiny dev
npm run voices:benchmark -- my-small-dev small dev
npm run voices:benchmark -- my-tiny-reserved tiny heldout
npx tsx scripts/benchmark-hums.ts
npm run voices:report -- my-tiny-dev my-tiny-reserved
npm run voices:serve
```

Open `http://localhost:3002/report.html`. The main app remains at port 3000. Sort by hardest recordings, select a recording, then compare original audio, recovered notes and either human annotator on a shared timeline. The extra examples panel provides short RSH originals and detected-note previews without fabricated accuracy scores.

Choose a fresh result label each run; existing result folders are protected from overwrite. When only segmentation changes, reuse previously measured frames with the optional fifth argument, for example `npm run voices:benchmark -- candidate tiny dev my-tiny-dev`. The cached model hash is checked, and the source hash of the current analysis code is recorded. A cached run does not measure new inference latency.

The current report was generated with `baseline-tiny` and `baseline-heldout`. The gallery contains no private user recordings. The next useful dataset extension is freeform “hmm / dum / la” captured through this app with manually checked intended notes, including mistakes and room noise. Corrections, source timing and source audio must be preserved together; model guesses must not be treated as ground truth.

## Verification

`npm run check` passed (82 tests, strict typecheck and lint), and `npm run build` passed. Cached-frame runs reproduced both saved Tiny baseline scores exactly after the extraction refactor. The browser report was visually inspected, its note-preview/Stop controls exercised, and its completed DOM verified to contain 40 annotated selections and 138 extra audio players. Both local services and sample audio URLs returned HTTP 200; Premium remained ready. These are implementation checks, not additional claims of voice accuracy.
