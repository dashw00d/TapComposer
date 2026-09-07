"""Replay the public RSH listening selection through the local premium HTTP route."""
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]/'outputs/voice-benchmark'
manifest=json.loads((ROOT/'rsh/manifest.json').read_text())
target=ROOT/'rsh/listening-premium.json'
if target.exists(): raise RuntimeError('Preserve the existing premium listening results before rerunning.')
samples=[]
for index,sample in enumerate(manifest['samples']):
 audio=(ROOT/sample['audio']).read_bytes()
 if hashlib.sha256(audio).hexdigest()!=sample['sha256']: raise RuntimeError('Sample checksum changed.')
 start=time.monotonic()
 request=urllib.request.Request('http://localhost:3000/api/premium/transcribe',data=audio,headers={'Content-Type':'audio/wav'})
 with urllib.request.urlopen(request,timeout=30) as response: intent=json.load(response)
 if intent['analyzer']!='rosvot-crepe':raise RuntimeError('Expected the premium voice engine.')
 notes=[{**e,'pitch':int(e['pitch']+.5)} for e in intent['events']]
 samples.append({**sample,'notes':notes,'duration':intent['duration'],'analyzer':intent['analyzer'],'milliseconds':(time.monotonic()-start)*1000})
 if (index+1)%20==0: print(index+1,'public humming samples replayed',flush=True)
target.write_text(json.dumps({'source':manifest['source'],'annotationStatus':'unlabeled; listening only; no accuracy claim','samples':samples}))
print('Saved',len(samples),'premium listening results:',target)
