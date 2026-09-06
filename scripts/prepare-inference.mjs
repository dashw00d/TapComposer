import { copyFile, mkdir } from 'node:fs/promises';
const target = new URL('../public/inference/ort-1.29.0/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
])
  await copyFile(
    new URL('../node_modules/onnxruntime-web/dist/' + name, import.meta.url),
    new URL(name, target),
  );
