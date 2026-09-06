// Local evaluation helper. Model files are downloaded separately; no remote inference.
import * as ort from 'onnxruntime-web/wasm';
import { readFile } from 'node:fs/promises';
ort.env.wasm.numThreads = 1;
const root = process.argv[2] ?? 'outputs/model-comparison';
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
function sound(rate, pitch, kind, duration = 1.8) {
  let phase = 0,
    seed = 271;
  return Float32Array.from({ length: Math.round(rate * duration) }, (_, i) => {
    const t = i / rate;
    seed = (seed * 16807) % 2147483647;
    phase += (2 * Math.PI * hz(pitch + 0.15 * Math.sin(t * 31))) / rate;
    const fundamental =
      kind === 'missing fundamental' ? 0 : Math.sin(phase) * 0.35;
    const signal =
      fundamental + Math.sin(phase * 2) * 0.3 + Math.sin(phase * 3) * 0.17;
    return (
      (signal + (kind === 'noisy' ? 0.18 : 0) * ((seed / 2147483647) * 2 - 1)) *
      (kind === 'quiet' ? 0.04 : 0.6)
    );
  });
}
for (const name of ['crepe-tiny', 'crepe-small', 'basic-pitch']) {
  const s = await ort.InferenceSession.create(
    await readFile(`${root}/${name}.onnx`),
    { executionProviders: ['wasm'] },
  );
  for (const kind of ['clean', 'noisy', 'quiet', 'missing fundamental']) {
    let correct = 0,
      voiced = 0,
      total = 0,
      elapsed = 0;
    for (const pitch of [45, 57, 69, 77]) {
      const bp = name === 'basic-pitch',
        rate = bp ? 22050 : 16000;
      const pcm = sound(rate, pitch, kind);
      const count = bp ? 1 : 60;
      const data = new Float32Array(bp ? 43844 : count * 1024);
      if (bp) data.set(pcm);
      else
        for (let i = 0; i < count; i++)
          data.set(
            pcm.subarray(1600 + i * 320, 1600 + i * 320 + 1024),
            i * 1024,
          );
      const start = performance.now();
      const out = await s.run({
        [s.inputNames[0]]: new ort.Tensor(
          'float32',
          data,
          bp ? [1, 43844, 1] : [count, 1024],
        ),
      });
      elapsed += performance.now() - start;
      const probs =
          out[bp ? 'StatefulPartitionedCall:1' : 'probabilities'].data,
        bins = bp ? 88 : 360;
      for (let i = bp ? 15 : 0; i < (bp ? 140 : count); i++) {
        let best = 0;
        for (let j = 1; j < bins; j++)
          if (probs[i * bins + j] > probs[i * bins + best]) best = j;
        const detected = bp
          ? best + 21
          : 69 +
            12 *
              Math.log2(
                (10 * 2 ** ((best * 20 + 1997.3794084376191) / 1200)) / 440,
              );
        const confidence = probs[i * bins + best];
        total++;
        if (confidence >= (bp ? 0.25 : 0.55)) {
          voiced++;
          if (Math.abs(detected - pitch) < 0.5) correct++;
        }
      }
      for (const v of Object.values(out)) v.dispose();
    }
    console.log(
      JSON.stringify({
        model: name,
        fixture: kind,
        correct,
        voiced,
        total,
        milliseconds: Math.round(elapsed),
      }),
    );
  }
  await s.release();
}
