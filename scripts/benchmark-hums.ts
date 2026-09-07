// Unlabeled listening cases. Model output is NOT reference/ground-truth data.
import { readFile, writeFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web/wasm';
import { neuralHum } from '../lib/music/neural';
import { readVoiceWav } from './voice-audio';
import { createHash } from 'node:crypto';
const root = 'outputs/voice-benchmark';
const manifest = JSON.parse(
  await readFile(`${root}/rsh/manifest.json`, 'utf8'),
);
ort.env.wasm.numThreads = 1;
const weights = await readFile('public/models/crepe-tiny-91fc2a0f.onnx');
const session = await ort.InferenceSession.create(weights, {
  executionProviders: ['wasm'],
});
try {
  let i = 0;
  for (const sample of manifest.samples) {
    const bytes = await readFile(`${root}/${sample.audio}`);
    if (createHash('sha256').update(bytes).digest('hex') !== sample.sha256)
      throw new Error('Sample checksum mismatch');
    const { pcm, rate } = readVoiceWav(bytes);
    const intent = await neuralHum(pcm, rate, session, () => {}, 60000);
    sample.duration = pcm.length / rate;
    sample.notes = intent.events.map((e) => ({
      time: e.time,
      duration: e.duration,
      pitch: Math.round(e.pitch!),
    }));
    if (++i % 20 === 0)
      console.log(`${i}/${manifest.samples.length} humming examples analyzed`);
  }
} finally {
  await session.release();
}
manifest.predictionModelSha256 = createHash('sha256')
  .update(weights)
  .digest('hex');
await writeFile(
  `${root}/rsh/listening.json`,
  JSON.stringify(manifest, null, 2),
);
console.log(
  `Saved ${manifest.samples.length} unscored original/detected comparisons`,
);
