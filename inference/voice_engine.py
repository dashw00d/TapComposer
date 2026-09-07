"""Bounded monophonic transcription with the pinned ROSVOT / RWBD / RMVPE models."""
import math
import os
from pathlib import Path
import sys

import librosa
import numpy as np
import torch
import torch.nn.functional as F
import yaml
import torchcrepe
from voice_decode import decode_notes
from voice_conditioning import condition_voice

MODEL_ROOT = Path(os.environ.get('TAPCOMPOSER_ROSVOT_DIR', Path(__file__).resolve().parents[2] / 'inference' / 'ROSVOT')).resolve()
sys.path.insert(0, str(MODEL_ROOT))
from modules.rosvot.rosvot import MidiExtractor, WordbdExtractor
from modules.pe.rmvpe import RMVPE
from utils.audio.mel import MelNet
from utils.audio.pitch_utils import norm_interp_f0, denorm_f0, f0_to_coarse


def decode_pitch(probabilities):
    # CREPE weighted argmax without torchcrepe's random +/-20-cent bin dither.
    # These are already probabilities, so do not apply a second sigmoid.
    bins = probabilities.argmax(dim=1)
    indices = torch.arange(360, device=probabilities.device)[None,:,None]
    local = (indices-bins[:,None,:]).abs() <= 4
    weights = torch.where(local, probabilities.clamp_min(0), 0)
    cents = ((indices*20+1997.3794084376191)*weights).sum(1)/weights.sum(1).clamp_min(1e-8)
    return bins, 10*2**(cents/1200)


class VoiceEngine:
    def __init__(self, device='cuda:0'):
        self.device = torch.device(device)
        torch.set_num_threads(4)
        self.hp = yaml.safe_load((MODEL_ROOT / 'checkpoints/rosvot/config.yaml').read_text())
        self.wp = yaml.safe_load((MODEL_ROOT / 'checkpoints/rwbd/config.yaml').read_text())
        self.hp.update(max_frames=6000, note_bd_threshold=0.85)
        self.wp.update(max_frames=6000, word_bd_threshold=0.5)
        self.model = self._load(MidiExtractor(self.hp), 'rosvot')
        self.words = self._load(WordbdExtractor(self.wp), 'rwbd')
        self.pitch = RMVPE(str(MODEL_ROOT / 'checkpoints/rmvpe/model.pt'), device=self.device)
        self.mel = MelNet(self.hp)
        self.mel.to(self.device)

    def _load(self, model, name):
        checkpoint = torch.load(MODEL_ROOT / f'checkpoints/{name}/model.pt', map_location='cpu', weights_only=True)
        state = checkpoint['state_dict']
        if any('.' in k for k in state):
            state = {k[len('model.'):]: v for k, v in state.items() if k.startswith('model.')}
        else:
            state = state['model']
        model.load_state_dict(state, strict=True)
        return model.eval().to(self.device)

    @torch.inference_mode()
    def transcribe(self, pcm, sample_rate, diagnostics=False, normalize=True):
        pcm = np.asarray(pcm, dtype=np.float32)
        if pcm.ndim != 1 or sample_rate < 8000 or sample_rate > 192000 or not 0 < len(pcm) / sample_rate <= 30.01 or not np.isfinite(pcm).all():
            raise ValueError('Use a mono recording of at most 30 seconds.')
        duration = len(pcm) / sample_rate
        if normalize:
            pcm = condition_voice(pcm, sample_rate)
        result = {'version': 1, 'source': 'hum', 'analyzer': 'rosvot-crepe', 'duration': duration, 'events': [], 'confidence': 0.0}
        if duration < 0.08 or np.max(np.abs(pcm - pcm.mean())) < 0.001:
            return result
        rate, hop = self.hp['audio_sample_rate'], self.hp['hop_size']
        wav = librosa.resample(pcm, orig_sr=sample_rate, target_sr=rate)
        real_length = math.ceil(len(wav) / hop)
        length = math.ceil(real_length / self.hp['frames_multiple']) * self.hp['frames_multiple']
        f0s, _ = self.pitch.get_pitch_batch([wav], rate, hop, [real_length], fmin=self.hp['f0_min'], fmax=self.hp['f0_max'])
        f0, uv = norm_interp_f0(f0s[0])
        f0 = F.pad(torch.tensor(f0, dtype=torch.float32), (0, length - len(f0)))
        uv = F.pad(torch.tensor(uv, dtype=torch.float32), (0, length - len(uv)))
        coarse = f0_to_coarse(denorm_f0(f0, uv)).unsqueeze(0).to(self.device)
        uv = uv.long().unsqueeze(0).to(self.device)
        mel = self.mel(torch.from_numpy(wav).unsqueeze(0).to(self.device))
        mel = F.pad(mel, (0, 0, 0, length - mel.shape[1]))
        nonpadding = torch.arange(length, device=self.device).unsqueeze(0) < real_length
        mel = mel * nonpadding.unsqueeze(-1)
        word_bd = self.words(mel=mel[:, :, :self.wp['use_mel_bins']], pitch=coarse, uv=uv, non_padding=nonpadding, train=False)['word_bd_pred']
        output = self.model(mel=mel[:, :, :self.hp['use_mel_bins']], word_bd=word_bd, pitch=coarse, uv=uv, non_padding=nonpadding, train=False)
        boundaries = np.flatnonzero(output['note_bd_pred'][0,:real_length].cpu().numpy()) * hop/rate
        voice = librosa.resample(pcm, orig_sr=sample_rate, target_sr=16000)
        pitch, periodicity = torchcrepe.predict(torch.from_numpy(voice).unsqueeze(0), 16000,
            hop_length=160, fmin=50, fmax=1000, model='full', batch_size=128,
            device=str(self.device), return_periodicity=True, decoder=decode_pitch)
        f0 = pitch[0].cpu().numpy()
        certainty = periodicity[0].cpu().numpy()
        levels = np.array([np.sqrt(np.mean(voice[max(0,i*160-256):min(len(voice),i*160+256)]**2)) for i in range(len(f0))])
        pitches = 69 + 12*np.log2(f0/440)
        pitches[(certainty < .55) | (levels < .001)] = np.nan
        events = decode_notes(pitches, certainty, levels, .01, boundaries, duration)
        if diagnostics:
            result['diagnostics'] = {'f0': np.where(np.isfinite(pitches), f0, 0).tolist(), 'hop': .01,
                'boundaries': boundaries.tolist(), 'levels': levels.tolist(), 'periodicity': certainty.tolist()}
        result['events'] = events
        result['confidence'] = float(np.mean([e['confidence'] for e in events])) if events else 0.0
        return result
