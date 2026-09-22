# Premium inference

Free mode runs recording, CREPE Tiny recognition, composition, arranging, sampled playback and exports on the device. It never submits audio for inference. Premium sends a rendered WAV of the **actual arrangement**, plus its tempo, key and style direction, to ACE-Step's cover task. Original microphone recordings are not uploaded. Results are separate takes; changing a take's source does not destroy either version.

The local demo grants premium on the server with `TAPCOMPOSER_PREMIUM_DEMO=true`. This is a demo entitlement, not billing or a production subscription system. Before sharing publicly, replace this flag with authenticated account entitlements, per-account quotas, job ownership and billing. The gateway bearer credential must remain a server secret.

## Runtime used by this demo

- Official source: https://github.com/ace-step/ACE-Step-1.5 at `ca1e85fe9430179831e6bc6be790c332190a3866`.
- Model: https://huggingface.co/ACE-Step/acestep-v15-xl-turbo (4B XL turbo), with VAE and Qwen3 embedding from https://huggingface.co/ACE-Step/Ace-Step1.5.
- NVIDIA RTX 4070 Ti SUPER, 16GB VRAM. CUDA, CPU offload, batch one, eight diffusion steps. Cover uses source conditioning and bypasses the LM planner, so a separate language model is not initialized for these jobs.
- Source checkout, model weights and virtual environments live outside this git repository, in `../inference/`.
- `gateway.py` accepts only bounded PCM WAV song jobs, checks metadata, queues up to three jobs and serves finished WAVs. ACE-Step's model management and filesystem API stay on loopback.
- The Node app calls the gateway at `http://127.0.0.1:8789`, which calls ACE-Step at `http://127.0.0.1:8001`. All three processes bind to loopback. No tunnel or hosted app participates in local testing.

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
ACESTEP_OFFLOAD_DIT_TO_CPU=true
PYTORCH_ALLOC_CONF=expandable_segments:True
ACESTEP_INIT_LLM=false
ACESTEP_API_HOST=127.0.0.1
ACESTEP_API_PORT=8001
ACESTEP_USE_FLASH_ATTENTION=false
ACESTEP_COMPILE_MODEL=false
```

Run `.venv/bin/acestep-api`. Install the pinned gateway requirements in a separate Python 3.11 virtual environment. Set a cryptographically random `TAPCOMPOSER_INFERENCE_KEY`, `TAPCOMPOSER_RENDER_DIR` to a private runtime directory, and `ACESTEP_ORIGIN=http://127.0.0.1:8001`. Run `uvicorn gateway:app --host 127.0.0.1 --port 8789` from this folder.

The running demo has systemd user units `tapcomposer-ace` and `tapcomposer-gateway`. Credentials are in a mode-600 environment file outside the repository. They are not part of the model or source downloads.

Start the demo explicitly with `systemctl --user start tapcomposer-ace tapcomposer-voice tapcomposer-gateway`; stop it with the corresponding `stop` command. These units should be disabled at login so rebooting does not silently reclaim VRAM. DiT CPU offload keeps the same XL weights, but moves them out of VRAM between generation stages so VAE encoding and desktop recording have room. It adds transfer time; verify a real cover render with the voice worker running, not just a health check.

Local `.env.local` settings for the Node app:

- `TAPCOMPOSER_PREMIUM_DEMO=true`
- `TAPCOMPOSER_INFERENCE_URL`: `http://127.0.0.1:8789`
- `TAPCOMPOSER_INFERENCE_KEY`: secret bearer credential

The app loads ignored `.env.local` when running `npm run dev` or `npm start`. The key must match the local gateway environment file. Never place it in client variables. The former tunnel is disabled and its gateway credential has been rotated. No deployment is part of this workflow.

## Limits and recovery

Demo songs are 10–180 seconds plus the local renderer's short release tail. The client stores pending jobs locally and reconnects after refresh. Free mode stops checking premium jobs; jobs already submitted can finish on the service. The gateway persists job state across restarts, but an ACE-Step restart can invalidate a running job; retry it if it fails. Finished audio is copied into browser storage and editable project backups (up to three takes). Downloaded takes remain available without inference.

The gateway removes source WAVs after completion/failure. Completed render files and upstream temporary files currently remain on the inference host for demo debugging; clear them manually when no jobs are running. This is not a production retention policy.

Tests: `python -m unittest test_gateway.py` in this directory; `npm run check` in the app. `npx tsx scripts/render-demo.ts` prepares the same composed example as the UI for real inference smoke testing.

## Verified demo run

September 9: with `ACESTEP_OFFLOAD_DIT_TO_CPU=true`, the existing 54-second source and a 92-second repeated public demo both completed through the app HTTP API in 18 seconds each, with the voice worker loaded. The 92-second output decoded as stereo 48 kHz WAV with finite, non-silent audio (peak 0.891, RMS 0.196). ACE-Step idled at about 876 MiB after rendering, versus approximately 12 GiB held by the earlier persistent-DiT configuration. This check did not run OBS; it specifically verifies coexistence with voice recognition. Repeat the long case using `python inference/smoke.py http://localhost:3000 92` from the app root after preparing the demo fixture.

The real 54.46-second arranged example completed through the app API, gateway, and XL model in 19 seconds after warm-up. The result is stereo 48 kHz WAV; checks verify its duration, finite non-silent audio throughout, and bounded peaks. `public/demo/studio-example.wav` is that actual output, not a placeholder. The example remains editable and further takes use the live service. Musical fidelity and preferred style remain listening judgments; the cover-strength control allows more or less reinterpretation.
