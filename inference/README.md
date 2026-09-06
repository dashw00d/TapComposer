# Premium inference

Free mode runs recording, CREPE Tiny recognition, composition, arranging, sampled playback and exports on the device. It never submits audio for inference. Premium sends a rendered WAV of the **actual arrangement**, plus its tempo, key and style direction, to ACE-Step's cover task. Original microphone recordings are not uploaded. Results are separate takes; changing a take's source does not destroy either version.

The private demo grants premium on the server with `TAPCOMPOSER_PREMIUM_DEMO=true`. This is a demo entitlement, not billing or a production subscription system. Before sharing publicly, replace this flag with authenticated account entitlements, per-account quotas, job ownership and billing. The gateway bearer credential must remain a server secret.

## Runtime used by this demo

- Official source: https://github.com/ace-step/ACE-Step-1.5 at `ca1e85fe9430179831e6bc6be790c332190a3866`.
- Model: https://huggingface.co/ACE-Step/acestep-v15-xl-turbo (4B XL turbo), with VAE and Qwen3 embedding from https://huggingface.co/ACE-Step/Ace-Step1.5.
- NVIDIA RTX 4070 Ti SUPER, 16GB VRAM. CUDA, CPU offload, batch one, eight diffusion steps. Cover uses source conditioning and bypasses the LM planner, so a separate language model is not initialized for these jobs.
- Source checkout, model weights and virtual environments live outside this git repository, in `../inference/`.
- `gateway.py` accepts only bounded PCM WAV song jobs, checks metadata, queues up to three jobs and serves finished WAVs. ACE-Step's model management and filesystem API stay on loopback.
- The demo uses a Cloudflare Quick Tunnel to the authenticated gateway. Its public URL contains no credential. The hosted Worker supplies the bearer key. **The GPU computer must remain online. A tunnel restart changes the URL**, which must then be updated in Sites and deployed. A paid service should use a stable inference origin with the same gateway API.

## Setup

Install `uv`, clone the pinned upstream source outside this app, then in that checkout:

```sh
uv sync --python 3.11
uvx --from huggingface_hub hf download ACE-Step/Ace-Step1.5 --revision 19671f406d603126926c1b7e2adc169acbcade22 --local-dir checkpoints
uvx --from huggingface_hub hf download ACE-Step/acestep-v15-xl-turbo --revision d4a0b288b83ebb7e25a8c0b32c573c22e134e8ee --local-dir checkpoints/acestep-v15-xl-turbo
```

Start ACE-Step with these environment settings (loopback only):

```dotenv
ACESTEP_CONFIG_PATH=acestep-v15-xl-turbo
ACESTEP_NO_INIT=false
ACESTEP_DEVICE=cuda
ACESTEP_OFFLOAD_TO_CPU=true
ACESTEP_OFFLOAD_DIT_TO_CPU=false
ACESTEP_INIT_LLM=false
ACESTEP_API_HOST=127.0.0.1
ACESTEP_API_PORT=8001
ACESTEP_USE_FLASH_ATTENTION=false
ACESTEP_COMPILE_MODEL=false
```

Run `.venv/bin/acestep-api`. Install the pinned gateway requirements in a separate Python 3.11 virtual environment. Set a cryptographically random `TAPCOMPOSER_INFERENCE_KEY`, `TAPCOMPOSER_RENDER_DIR` to a private runtime directory, and `ACESTEP_ORIGIN=http://127.0.0.1:8001`. Run `uvicorn gateway:app --host 127.0.0.1 --port 8789` from this folder. Bind the tunnel to the gateway only.

The running demo has systemd user units `tapcomposer-ace`, `tapcomposer-gateway`, and `tapcomposer-tunnel`. Credentials are in a mode-600 environment file outside the repository. They are not part of the model or source downloads.

Hosted runtime bindings:

- `TAPCOMPOSER_PREMIUM_DEMO=true`
- `TAPCOMPOSER_INFERENCE_URL`: HTTPS gateway origin
- `TAPCOMPOSER_INFERENCE_KEY`: secret bearer credential

Use ignored `.dev.vars` for local Worker bindings. Set production values through Sites environment tools, then deploy a saved version. Never place secrets in client variables or hosting.json.

## Limits and recovery

Demo songs are 10–180 seconds plus the local renderer's short release tail. The client stores pending jobs locally and reconnects after refresh. Free mode stops checking premium jobs; jobs already submitted can finish on the service. The gateway persists job state across restarts, but an ACE-Step restart can invalidate a running job; retry it if it fails. Finished audio is copied into browser storage and editable project backups (up to three takes). Downloaded takes remain available without inference.

The gateway removes source WAVs after completion/failure. Completed render files and upstream temporary files currently remain on the inference host for demo debugging; clear them manually when no jobs are running. This is not a production retention policy.

Tests: `python -m unittest test_gateway.py` in this directory; `npm run check` in the app. `npx tsx scripts/render-demo.ts` prepares the same composed example as the UI for real inference smoke testing.

## Verified demo run

The real 54.46-second arranged example completed through the app API, gateway, and XL model in 19 seconds after warm-up. The result is stereo 48 kHz WAV; checks verify its duration, finite non-silent audio throughout, and bounded peaks. `public/demo/studio-example.wav` is that actual output, not a placeholder. The example remains editable and further takes use the live service. Musical fidelity and preferred style remain listening judgments; the cover-strength control allows more or less reinterpretation.
