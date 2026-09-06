import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const benchmark = process.argv.includes('--benchmark');
const models = [
  {
    name: 'crepe-tiny',
    path: 'crepe-tiny-91fc2a0f.onnx',
    url: 'https://huggingface.co/wok000/vcclient_modules/resolve/459397bb763fef82aee673dcb708754bd194313b/onnxcrepe/tiny.onnx',
    hash: '91fc2a0fd10f965dbf7775995daf50e99273caedd7efd00001f23be649da1bc3',
  },
  {
    name: 'crepe-small',
    url: 'https://huggingface.co/wok000/vcclient_modules/resolve/459397bb763fef82aee673dcb708754bd194313b/onnxcrepe/small.onnx',
    hash: 'cd119f6f5f608d9342a1c6f81e4653f21dbcde440a96d474ecbf6f27c6253466',
  },
  {
    name: 'basic-pitch',
    url: 'https://huggingface.co/daserge/basic-pitch-onnx/resolve/2633e680fb5a1c551cee4905410115b6715862f6/nmp.onnx',
    hash: '2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec',
  },
];
const root = new URL(
  benchmark ? '../outputs/model-comparison/' : '../public/models/',
  import.meta.url,
);
await mkdir(root, { recursive: true });
for (const model of benchmark ? models : models.slice(0, 1)) {
  const target = new URL(benchmark ? model.name + '.onnx' : model.path, root);
  let bytes;
  try {
    bytes = await readFile(target);
  } catch {
    /* Fetch missing weights. */
  }
  if (
    !bytes ||
    createHash('sha256').update(bytes).digest('hex') !== model.hash
  ) {
    const response = await fetch(model.url);
    if (!response.ok) throw new Error('Download failed: ' + model.name);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== model.hash)
      throw new Error('Model checksum mismatch: ' + model.name);
    await writeFile(target, bytes);
  }
  console.log(model.name + ': checksum verified');
}
