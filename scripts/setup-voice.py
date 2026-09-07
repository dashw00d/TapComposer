"""Fetch pinned public GPU models beside the app. Run using the voice venv."""
import hashlib
import os
from pathlib import Path
import subprocess
import urllib.request

APP = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get('TAPCOMPOSER_ROSVOT_DIR', APP.parent/'inference/ROSVOT'))
REV = '3c8332bf43adae35f6e4d64971862f2f6139b310'
HF_REV = '83dc50289d22a81b1e9998f5b9e111aef7c1fdcd'
WEIGHTS = {
 'rmvpe/model.pt': '19dc1809cf4cdb0a18db93441816bc327e14e5644b72eeaae5220560c6736fe2',
 'rosvot/model.pt': '7501fb5f913d971c2f51bcb3063b930027b03206581820a4d2bfdc394c9c3fcb',
 'rwbd/model.pt': '0bc2d42a6d4b7a05436deb937e2deda1c12de49e5687cfda0bdf6a430120dcd2',
 'rosvot/config.yaml': '6bccb2becf6c69dc7b60ecf4b4253854a70fda9b30d63838cd300b18da74abb4',
 'rwbd/config.yaml': '3bb41f1d9eaa85aa1b3e5b6d94fff4ab4affb39719028ab69b4505974b9a1bc7',
}
def digest(path):
 with path.open('rb') as file: return hashlib.file_digest(file,'sha256').hexdigest()

if not ROOT.exists():
 ROOT.parent.mkdir(parents=True,exist_ok=True)
 subprocess.run(['git','clone','https://github.com/RickyL-2000/ROSVOT.git',str(ROOT)],check=True)
 subprocess.run(['git','-C',str(ROOT),'checkout',REV],check=True)
actual = subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
if actual != REV: raise RuntimeError('Existing ROSVOT checkout is not the pinned revision; preserve it and choose a fresh TAPCOMPOSER_ROSVOT_DIR.')
for name,expected in WEIGHTS.items():
 path=ROOT/'checkpoints'/name
 if path.exists() and digest(path)==expected: continue
 path.parent.mkdir(parents=True,exist_ok=True)
 temporary=path.with_suffix(path.suffix+'.download')
 url=f'https://huggingface.co/Soul-AILab/SoulX-Singer-Preprocess/resolve/{HF_REV}/rosvot/{name}'
 urllib.request.urlretrieve(url,temporary)
 if digest(temporary)!=expected:
  temporary.unlink(); raise RuntimeError('Model checksum mismatch: '+name)
 temporary.replace(path)
 print('Verified',name)
print('Pinned ROSVOT models verified:',ROOT)
