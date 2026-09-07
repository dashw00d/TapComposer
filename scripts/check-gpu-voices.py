import sys,json
import numpy as np
from pathlib import Path
APP=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(APP/'inference'))
from voice_engine import VoiceEngine
m=VoiceEngine();rate=16000

def hum(notes,duration=3):
 pcm=np.zeros(round(rate*duration),np.float32)
 for start,length,pitch in notes:
  n=round(length*rate);t=np.arange(n)/rate
  frequency=440*2**((pitch-69+.15*np.sin(t*2*np.pi*5))/12)
  phase=np.cumsum(frequency)*2*np.pi/rate
  envelope=np.minimum(1,np.minimum(t/.02,(length-t)/.03))
  sound=sum(np.sin(phase*h)/h**2 for h in range(1,8))*.15*envelope
  pcm[round(start*rate):round(start*rate)+n]+=sound.astype(np.float32)
 return pcm
cases={
 'silence':np.zeros(rate*3,np.float32),
 'quiet-room-noise':np.random.default_rng(8).normal(0,.003,rate*3).astype(np.float32),
 'held-hum-vibrato':hum([(.4,2.2,57)]),
 'repeated-dums':hum([(.4,.35,57),(1,.35,57),(1.6,.35,57)]),
 'changing-notes':hum([(.4,.4,57),(.9,.4,60),(1.4,.4,59),(1.9,.4,62)]),
}
results={}
for name,pcm in cases.items():
 r=m.transcribe(pcm,rate);results[name]=r
 print(name,[(round(e['time'],2),round(e['duration'],2),round(e['pitch'],1)) for e in r['events']],flush=True)
open(APP/'outputs/voice-benchmark/gpu-synthetic-checks.json','w').write(json.dumps(results,indent=2))

assert not results['silence']['events']
assert not results['quiet-room-noise']['events']
for name, expected in {
 'held-hum-vibrato':[(.4,57)],
 'repeated-dums':[(.4,57),(1,57),(1.6,57)],
 'changing-notes':[(.4,57),(.9,60),(1.4,59),(1.9,62)],
}.items():
 events=results[name]['events']
 assert len(events)==len(expected), name
 for e,(time,pitch) in zip(events,expected):
  assert abs(e['time']-time)<.06 and abs(e['pitch']-pitch)<.5, (name,e)
print('GPU silence, vibrato, repeated syllable and changing-pitch checks passed.')
