"""Controlled amplitude/noise perturbations of public voices; labels never enter inference."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np
import soundfile as sf

APP=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(APP/'inference'))
from voice_engine import VoiceEngine
label=sys.argv[1];split=sys.argv[2] if len(sys.argv)>2 else 'heldout'
if not label.replace('-','').isalnum() or split not in ('dev','heldout'): raise ValueError('Use LABEL [dev|heldout]')
root=APP/'outputs/voice-benchmark';out=root/label;out.mkdir(exist_ok=False)
files=sorted((root/('baseline-tiny' if split=='dev' else 'baseline-heldout')).glob('vocadito_*.json'))
files=[files[i] for i in np.linspace(0,len(files)-1,8,dtype=int)]
engine=VoiceEngine()
for file in files:
 d=json.loads(file.read_text());x,rate=sf.read(root/'Audio'/f"{d['result']['id']}.wav",dtype='float32');x=x[:rate*30]
 noise=np.random.default_rng(417).normal(0,np.sqrt(np.mean(x*x))*10**(-12/20),len(x))
 for kind,audio in [('clean',x),('quiet',x*.025),('dc',x+.08),('noise-12db',x+noise)]:
  for mode in ('raw','conditioned'):
   result=engine.transcribe(audio,rate,normalize=mode=='conditioned')
   (out/f'{file.stem}-{kind}-{mode}.json').write_text(json.dumps({'id':file.stem,'split':split,'kind':kind,'mode':mode,'annotations':d['annotations'],'notes':[dict(time=e['time'],duration=e['duration'],pitch=int(e['pitch']+.5)) for e in result['events']]}))
 print(file.stem,'finished',flush=True)
(out/'provenance.json').write_text(json.dumps({'split':split,'selection':'8 evenly spaced lexicographically sorted corpus IDs','quietGain':.025,'dcOffset':.08,'noiseSNRdB':12,'noiseSeed':417,'sourceSha256':{name:hashlib.sha256((APP/'inference'/name).read_bytes()).hexdigest() for name in ('voice_engine.py','voice_decode.py','voice_conditioning.py')}}))
