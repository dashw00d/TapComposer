# Real voice evaluation

The current recognition is not accurate enough for unrestricted casual humming. The earlier synthetic tones were useful regression tests, but did not establish human-voice quality. This pass adds actual samples, reproducible measurements and an original-versus-detected listening report. It does **not** change the app's recognition behavior or train new weights.

## Data on this machine

- **vocadito:** 40 solo vocal recordings, 29 singer IDs in the downloaded metadata, with human frame-level pitch and two independent human note annotations. Includes a wordless “la” recording, but most files contain sung words. It is a proxy for casual humming, not a complete humming benchmark. [Publisher and download](https://zenodo.org/records/5578807), [technical report](https://arxiv.org/abs/2110.05580).
- **RSH:** 1,380 w-series recordings extracted locally, with three deterministic examples per speaker (138 from 46 speakers) selected for the listening gallery. The published corpus contains reading, singing and humming; the w-series selection excludes its r/s-series and TI files. It has no note-level ground truth. Its model predictions are explicitly unscored listening aids, never labels for evaluating or training the same detector. [Publisher](https://zenodo.org/records/3816618), [corpus paper](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0241809).

Both selected sources identify CC BY 4.0. Attribution: Rachel M. Bittner, Katherine Pasalo, Juan José Bosch, Gabriel Meseguer-Brocal, David Rubinstein (2021), *vocadito*, DOI 10.5281/zenodo.5578807; shi (2020), *RSH dataset*, DOI 10.5281/zenodo.3816618. Original audio is unchanged; decoded PCM is cropped to the app's 30-second limit for analysis. Generated predictions and report graphics are our processing.

Audio, archives, detailed prediction traces and generated HTML stay in ignored `outputs/voice-benchmark/`, outside `public/`. The local gallery runs separately from the app. It uploads nothing and uses no GPU. Corpus archive checksums are verified before extraction; selected RSH files have SHA-256 identities in their manifest.

HumTrans was considered, but its original onset/offset labels have documented problems and its dataset card specifies CC BY-NC. It was not downloaded, trained on, or used in the measurements. [Dataset](https://huggingface.co/datasets/dadinghh2/HumTrans), [annotation investigation](https://github.com/shubham-gupta-30/humming_transcription). More files alone do not solve bad or missing reference labels.

## Measurements

Current app decoder, source revision `e44049c`; pinned model hashes and per-recording results are saved in [benchmarks/voice-baseline.json](./benchmarks/voice-baseline.json). Neural frame extraction was factored out of `neuralHum` without changing its computation, so the benchmark calls the same inference and segmentation functions used in capture.

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
