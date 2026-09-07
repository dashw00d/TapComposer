"""Run the exact premium engine on annotated voices; no reference labels enter inference."""
import hashlib
import json
from pathlib import Path
import sys
import time
import soundfile as sf
import torch
import numpy as np

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / 'inference'))
from voice_engine import VoiceEngine

label = sys.argv[1] if len(sys.argv)>1 else 'gpu-baseline'
split = sys.argv[2] if len(sys.argv)>2 else 'dev'
if not label.replace('-','').replace('_','').isalnum() or split not in ('dev','heldout','all'):
    raise ValueError('Use LABEL [dev|heldout|all]')
root = APP / 'outputs/voice-benchmark'
out = root / label
out.mkdir()
engine = VoiceEngine()
for source in ('baseline-tiny','baseline-heldout'):
    for file in sorted((root/source).glob('vocadito_*.json')):
        baseline = json.loads(file.read_text())
        if split != 'all' and baseline['result']['split'] != split: continue
        name=baseline['result']['id']
        pcm,rate=sf.read(root/'Audio'/f'{name}.wav',dtype='float32')
        torch.cuda.reset_peak_memory_stats()
        start=time.monotonic()
        result=engine.transcribe(pcm[:rate*30],rate,diagnostics=True)
        elapsed=time.monotonic()-start
        value={'result':baseline['result'], 'annotations':baseline['annotations'],
            'intent':result, 'notes':[{'time':e['time'],'pitch':int(np.floor(e['pitch']+.5)),'duration':e['duration']} for e in result['events']],
            'seconds':elapsed, 'gpuPeakMiB':torch.cuda.max_memory_allocated()/1024**2}
        (out/f'{name}.json').write_text(json.dumps(value))
        print(name,len(result['events']),f'{elapsed:.2f}s',f"{value['gpuPeakMiB']:.0f} MiB",flush=True)
sources = {name:hashlib.sha256((APP/'inference'/name).read_bytes()).hexdigest() for name in ('voice_engine.py','voice_decode.py','voice_conditioning.py')}
(out/'provenance.json').write_text(json.dumps({'sourceSha256': sources, 'split':split,
 'model':'ROSVOT / RWBD / RMVPE + CREPE full (torchcrepe 0.0.24)',
 'rosvotCommit':'3c8332bf43adae35f6e4d64971862f2f6139b310',
 'weightsRevision':'83dc50289d22a81b1e9998f5b9e111aef7c1fdcd',
 'device':torch.cuda.get_device_name(0)},indent=2))
