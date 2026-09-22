/** Evaluates original takes and reproducible noise variants without relabeling the prompt as truth. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import * as ort from 'onnxruntime-web/wasm';
import { neuralPitchFrames, resampleVoice } from '../lib/music/neural';
import { humFramesToIntent } from '../lib/music/analyze';
import { cleanHumIntent } from '../lib/music/phrase-cleanup';
import { encodeWav } from '../lib/music/wav';
import { syntheticNoise, mixNoise, seededRandom } from '../lib/voice-lab/noise';
import type {
  ExportedLabSession,
  ReferenceNote,
} from '../lib/voice-lab/protocol';
import { readVoiceWav } from './voice-audio';
import { noteScore, rhythmScore } from './voice-metrics';

const args = process.argv.slice(2);
const file = args[0];
function option(name: string, fallback?: string) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  if (!args[at + 1] || args[at + 1].startsWith('--'))
    throw new Error(`Missing value for ${name}`);
  return args[at + 1];
}
if (!file || file.startsWith('--'))
  throw new Error(
    'Usage: npm run voices:lab -- SESSION.json --out outputs/tuning/run-1 [--split dev|heldout] [--noise-dir DIRECTORY] [--annotations FILE]',
  );
const split = option('--split', 'dev');
if (split !== 'dev' && split !== 'heldout')
  throw new Error('Split must be dev or heldout.');
const out = resolve(option('--out', `outputs/tuning/run-${Date.now()}`)!);
const bytes = await readFile(file);
const corpus = JSON.parse(bytes.toString()) as ExportedLabSession;
if (
  corpus.format !== 'tapcomposer-voice-lab' ||
  corpus.version !== 1 ||
  !Array.isArray(corpus.takes)
)
  throw new Error('Expected a Tuning Center session export.');
// Rerecordings of the same condition do not multiply its statistical weight.
const latest = new Map<string, ExportedLabSession['takes'][number]>();
for (const take of corpus.takes) {
  if (
    !take.id ||
    !take.trialKey ||
    take.referenceKind !== 'prompt-score' ||
    !Array.isArray(take.reference)
  )
    throw new Error('Invalid take metadata.');
  if (take.split === split) latest.set(take.trialKey, take);
}
const takes = [...latest.values()];
if (!takes.length) throw new Error(`No ${split} takes in this export.`);
const annotationsFile = option('--annotations');
const annotations: Record<
  string,
  { status: 'reviewed' | 'unreviewed'; notes: ReferenceNote[] }
> = annotationsFile ? JSON.parse(await readFile(annotationsFile, 'utf8')) : {};
for (const annotation of Object.values(annotations)) {
  if (
    !Array.isArray(annotation.notes) ||
    annotation.notes.some(
      (n) =>
        !Number.isFinite(n.time) ||
        n.time < 0 ||
        !Number.isFinite(n.pitch) ||
        !Number.isFinite(n.duration) ||
        n.duration <= 0,
    )
  )
    throw new Error(
      'Annotations need finite pitches, nonnegative times and positive durations.',
    );
}
const externalNoise: { name: string; sha256: string; pcm: Float32Array }[] = [];
const noiseDir = option('--noise-dir');
if (noiseDir)
  for (const name of (await readdir(noiseDir))
    .filter((name) => name.endsWith('.wav'))
    .sort()) {
    const noiseBytes = await readFile(resolve(noiseDir, name));
    const audio = readVoiceWav(noiseBytes);
    externalNoise.push({
      name,
      sha256: createHash('sha256').update(noiseBytes).digest('hex'),
      pcm: resampleVoice(audio.pcm, audio.rate),
    });
  }
if (noiseDir && !externalNoise.length)
  throw new Error(
    'Noise directory has no .wav recordings. Use PCM16 mono WAV; the first 30 seconds are used.',
  );
await mkdir(dirname(out), { recursive: true });
await mkdir(out); // Refuse to replace previous evidence.
const weights = await readFile('public/models/crepe-tiny-91fc2a0f.onnx');
const modelSha256 = createHash('sha256').update(weights).digest('hex');
const codeHash = createHash('sha256');
for (const path of [
  'lib/music/neural.ts',
  'lib/music/analyze.ts',
  'lib/music/voice-activity.ts',
  'lib/music/hum-articulation.ts',
  'lib/music/phrase-cleanup.ts',
  'lib/voice-lab/noise.ts',
  'scripts/voice-metrics.ts',
  'scripts/benchmark-voice-lab.ts',
])
  codeHash.update(await readFile(path));
ort.env.wasm.numThreads = 1;
const model = await ort.InferenceSession.create(weights, {
  executionProviders: ['wasm'],
});
const rows: {
  melody: string;
  style: string;
  distanceCm: number;
  variant: string;
  promptAgreement: ReturnType<typeof metrics>;
  transcriptionAccuracy: ReturnType<typeof metrics> | null;
  [key: string]: unknown;
}[] = [];
const metrics = (reference: ReferenceNote[], prediction: ReferenceNote[]) => ({
  onsetOnly100: rhythmScore(reference, prediction),
  onsetPitch50: noteScore(reference, prediction, 0.05),
  onsetPitch100: noteScore(reference, prediction, 0.1),
  onsetPitchOffset50: noteScore(reference, prediction, 0.05, 0.2),
});
const annotationTemplate: Record<string, unknown> = {};
try {
  for (const [index, take] of takes.entries()) {
    const original = Buffer.from(take.audioBase64, 'base64');
    const audio = readVoiceWav(original);
    const clean = resampleVoice(audio.pcm, audio.rate);
    const takeSeed = createHash('sha256')
      .update(corpus.id + ':' + take.id)
      .digest()
      .readUInt32LE(0);
    const random = seededRandom(takeSeed);
    const filename = `take-${String(index + 1).padStart(3, '0')}`;
    await writeFile(`${out}/${filename}-original.wav`, original);
    annotationTemplate[take.id] = {
      status: 'unreviewed',
      audio: `${filename}-original.wav`,
      notes: [],
      promptOnly: take.reference,
    };
    const annotation = annotations[take.id];
    const variants: {
      name: string;
      pcm: Float32Array;
      noise?: Record<string, unknown>;
    }[] = [{ name: 'clean', pcm: clean }];
    const noises = [
      ...(['hiss', 'rumble'] as const).map((kind) => ({
        name: `synthetic-${kind}`,
        sha256: null,
        pcm: syntheticNoise(clean.length, 16000, kind, takeSeed),
      })),
      ...externalNoise,
    ];
    for (const noise of clean.some((sample) => sample !== 0) ? noises : []) {
      if (!noise.pcm.some((sample) => sample !== 0)) continue;
      const offset = Math.floor(random() * noise.pcm.length);
      for (const snrDb of [20, 10, 0]) {
        const mix = mixNoise(clean, noise.pcm, snrDb, offset);
        variants.push({
          name: `${noise.name} @ ${snrDb} dB`,
          pcm: mix.pcm,
          noise: {
            source: noise.name,
            sha256: noise.sha256,
            seed: takeSeed,
            offset,
            snrDb,
            gain: mix.gain,
            noiseScale: mix.noiseScale,
            snrDefinition:
              'Full-recording RMS, including silence; shared gain prevents clipping.',
          },
        });
      }
    }
    let cleanPrediction: ReferenceNote[] = [];
    for (const [variantIndex, variant] of variants.entries()) {
      const frames = await neuralPitchFrames(
        variant.pcm,
        16000,
        model,
        () => {},
        60000,
      );
      const intent = humFramesToIntent(
        frames,
        0.02,
        variant.pcm.length / 16000,
      );
      const prediction = intent.events.flatMap((event) =>
        event.pitch === null
          ? []
          : [
              {
                time: event.time,
                duration: event.duration,
                pitch: event.pitch,
              },
            ],
      );
      const cleaned = cleanHumIntent(intent, {
        tempo: take.bpm,
        key: 0,
        mode: 'major',
        confidence: 1,
      }).events.flatMap((event) =>
        event.pitch === null
          ? []
          : [
              {
                time: event.time,
                duration: event.duration,
                pitch: event.pitch,
              },
            ],
      );
      if (variantIndex === 0) cleanPrediction = prediction;
      const id = `${filename}-variant-${variantIndex}`;
      await writeFile(
        `${out}/${id}.wav`,
        Buffer.from(await encodeWav([variant.pcm], 16000).arrayBuffer()),
      );
      await writeFile(
        `${out}/${id}.json`,
        JSON.stringify(
          {
            takeId: take.id,
            variant: variant.name,
            frames,
            prediction,
            cleaned,
            prompt: take.reference,
            annotation:
              annotation?.status === 'reviewed' ? annotation.notes : null,
            noise: variant.noise ?? null,
          },
          null,
          2,
        ),
      );
      rows.push({
        id,
        takeId: take.id,
        trialKey: take.trialKey,
        setup: take.setup ?? {
          singer: corpus.singer,
          microphone: corpus.microphone,
          room: corpus.room,
        },
        melody: take.melodyId,
        style: take.style,
        distanceCm: take.distanceCm,
        split: take.split,
        variant: variant.name,
        root: take.root,
        bpm: take.bpm,
        guideDuringRecording: take.guideDuringRecording,
        listening: take.listening,
        originalSha256: createHash('sha256').update(original).digest('hex'),
        predictionCount: prediction.length,
        promptAgreement: metrics(take.reference, prediction),
        cleanedRhythmAgreement: {
          absolute: rhythmScore(take.reference, cleaned),
          relativeToFirstNote: rhythmScore(take.reference, cleaned, true),
          firstOnsetOffsetSeconds:
            cleaned.length && take.reference.length
              ? cleaned[0].time - take.reference[0].time
              : null,
          noteCount: cleaned.length,
        },
        cleanConsistency:
          variantIndex === 0 ? null : metrics(cleanPrediction, prediction),
        transcriptionAccuracy:
          annotation?.status === 'reviewed'
            ? metrics(annotation.notes, prediction)
            : null,
        noise: variant.noise ?? null,
      });
    }
    console.log(
      `${index + 1}/${takes.length}: ${take.melodyId}, ${take.style}, ${take.distanceCm} cm — ${variants.length} conditions`,
    );
  }
} finally {
  await model.release();
}
await writeFile(
  `${out}/annotation-template.json`,
  JSON.stringify(annotationTemplate, null, 2),
);
const report = {
  format: 'tapcomposer-voice-lab-results',
  split,
  sessionId: corpus.id,
  sessionSha256: createHash('sha256').update(bytes).digest('hex'),
  modelSha256,
  codeSha256: codeHash.digest('hex'),
  createdAt: new Date().toISOString(),
  tolerances: {
    pitchSemitones: 0.5,
    onsetSeconds: [0.05, 0.1],
    offsetRatio: 0.2,
    minimumOffsetSeconds: 0.05,
  },
  notes: [
    'Prompt agreement includes singer mistakes, microphone/output latency and detector errors; it is not transcription accuracy.',
    'Clean consistency measures change caused by noise against this detector’s clean prediction; it is not ground truth.',
    'Transcription accuracy is reported only against explicitly reviewed annotations of the actual singing.',
    'Raw scores retain pitch and capture timing. The separately labeled relative cleaned-rhythm diagnostic ignores pitch and removes each phrase’s first onset; it is not absolute timing accuracy. All descendants of a take inherit its split.',
    'Only the latest kept revision of each trial is scored. Originals remain in the session export.',
    'Silent takes are evaluated clean only; their signal-to-noise ratio is undefined. Silent noise files are skipped.',
  ],
  rows,
};
await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
const summary = [
  '# Tuning Center results',
  '',
  `Set: ${split}. ${takes.length} original takes; ${rows.length} evaluated conditions.`,
  '',
  ...report.notes.map((note) => `- ${note}`),
  '',
  '| Melody | Style | Distance | Condition | Guide agreement F1 (100 ms) | Verified transcription F1 (50 ms + offset) |',
  '|---|---|---:|---|---:|---:|',
];
for (const row of rows) {
  const prompt = row.promptAgreement as ReturnType<typeof metrics>;
  const truth = row.transcriptionAccuracy as ReturnType<typeof metrics> | null;
  summary.push(
    `| ${row.melody} | ${row.style} | ${row.distanceCm} cm | ${String(row.variant).replaceAll('|', '/')} | ${(prompt.onsetPitch100.f1 * 100).toFixed(1)}% | ${truth ? (truth.onsetPitchOffset50.f1 * 100).toFixed(1) + '%' : 'Not annotated'} |`,
  );
}
summary.push(
  '',
  'For verified scoring, copy annotation-template.json, listen to each original, enter the actual sung notes in seconds/MIDI pitch, and mark only reviewed entries as "reviewed". Re-run into a new output directory with --annotations FILE.',
  '',
  'Metric conventions: https://mir-eval.readthedocs.io/stable/api/transcription.html',
  'Noise mixing: https://docs.pytorch.org/audio/main/tutorials/audio_data_augmentation_tutorial.html',
);
await writeFile(`${out}/REPORT.md`, summary.join('\n'));
console.log(`Results: ${out}/REPORT.md`);
