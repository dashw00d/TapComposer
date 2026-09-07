# Local premium voice recognition

The demo uses ROSVOT + RWBD to propose note boundaries, RMVPE to condition those models, and the full CREPE model for acoustic pitch. The decoder aligns note starts to voiced audio, rejects short unstable fragments, and merges boundaries unsupported by a pitch change or volume dip. It retains fractional pitch until instrument resolution and retains the recording clock. CREPE conversion is deterministic: no random cent dithering and no second sigmoid on probabilities.

The existing Free selector (`tapcomposer-service`) bypasses the voice service entirely. Premium requires server entitlement and a healthy voice service; service failure, contention or unavailable GPU falls back to the original browser worker using the unchanged PCM. Taps always use browser analysis. Natural humming is no longer nudged to the timing grid; **Make smoother** remains opt-in.

## Install

Run from `app/`. Python 3.11 and an NVIDIA GPU are required for this premium service. The browser version has neither requirement.

```bash
uv venv --python 3.11 ../inference/voice-venv
uv pip install --python ../inference/voice-venv/bin/python torch==2.10.0 torchaudio==2.10.0 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python ../inference/voice-venv/bin/python -r inference/requirements-voice.txt
../inference/voice-venv/bin/python scripts/setup-voice.py
```

`setup-voice.py` clones the pinned ROSVOT source and checksum-verifies five model/config files in `../inference/ROSVOT`. It preserves an existing checkout at a different revision. Set `TAPCOMPOSER_ROSVOT_DIR` to use a different directory. Models are outside app Git and are never bundled into the website. The packaged torchcrepe full weights have SHA256 `133225604dedd2e4005f8bbd1bd0a2ec073ba8b7a6cd31ff6d5edbbfa3539986`.

Copy `inference/tapcomposer-voice.service.example` to `~/.config/systemd/user/tapcomposer-voice.service`, adjusting the three absolute paths for another machine. Its environment file uses the existing gateway's `TAPCOMPOSER_INFERENCE_KEY`; do not put that key into browser code or source control. Then:

```bash
systemctl --user daemon-reload
systemctl --user start tapcomposer-voice
systemctl --user restart tapcomposer-gateway
```

The service listens on **127.0.0.1:8790**, authenticates requests, accepts only bounded mono PCM16 WAV up to 30 seconds, and keeps audio in memory only. The gateway on 8789 forwards `/transcribe`; the app's `/api/premium/transcribe` route enforces entitlement, origin, MIME and size checks. `/api/premium/status` advertises `transcriptionReady` only after model loading and warm-up. Do not run multiple uvicorn workers, which would duplicate the GPU models.

The voice process keeps roughly 0.6 GB of model allocations resident and uses about **886 MiB peak PyTorch allocation** on this 4070 Ti Super, plus CUDA context/allocator overhead. Overall desktop VRAM was about **12.7 GB with ACE-Step and voice recognition running**. Temporary allocator caches are released after requests. The gateway avoids starting ACE generation while voice work is active, and routes new recognition back to the browser during an ACE render. `systemctl --user stop tapcomposer-voice` releases the voice models; stop `tapcomposer-ace` as well to release the generation models when pausing all inference.

## Verify

```bash
npm run check
npm run build
../inference/voice-venv/bin/python -m unittest discover -s inference -p test_voice.py
../inference/voice-venv/bin/python scripts/check-gpu-voices.py
npx tsx scripts/smoke-premium-voice.ts
```

The GPU checks need the voice benchmark output folder. The smoke test additionally needs the public vocadito audio downloaded using `npm run voices:download`, plus the running local app/gateway/service. It tests the actual premium client → app route → gateway → GPU → validation → note resolution path, checks identical repeated inference, and rejects malformed/unauthenticated requests. It never reads user recordings or starts the microphone.

For real-voice measurements and limitations, see [VOICE_EVALUATION.md](../VOICE_EVALUATION.md). No training or fine-tuning was performed.

## Sources and attribution

- [ROSVOT](https://github.com/RickyL-2000/ROSVOT), Ruiqi Li and collaborators, MIT source; pinned commit `3c8332bf43adae35f6e4d64971862f2f6139b310`. [ACL paper](https://arxiv.org/abs/2405.09940).
- ROSVOT, RWBD and RMVPE checkpoint mirror: [Soul-AILab/SoulX-Singer-Preprocess](https://huggingface.co/Soul-AILab/SoulX-Singer-Preprocess), pinned revision `83dc50289d22a81b1e9998f5b9e111aef7c1fdcd`. Mirror card declares Apache-2.0; preserve the upstream source/model attribution when redistributing. Checkpoint digests are in the setup script.
- [torchcrepe](https://github.com/maxrmorrison/torchcrepe) 0.0.24, MIT; full CREPE converted weights. CREPE: Jong Wook Kim, Justin Salamon, Peter Li and Juan Pablo Bello, ICASSP 2018.
