import io
import unittest
import wave
import numpy as np
from fastapi import HTTPException
from voice_decode import decode_notes
from voice_conditioning import condition_voice
from voice_server import read_voice

class VoiceTests(unittest.TestCase):
    def test_arbitrary_boundary_does_not_split_a_steady_note(self):
        pitch=np.full(100,57.0); level=np.full(100,.1)
        notes=decode_notes(pitch,np.full(100,.9),level,.01,[.3,.7],1)
        self.assertEqual(len(notes),1)
        self.assertAlmostEqual(notes[0]['duration'],1)

    def test_repeated_syllables_keep_their_rests_and_leading_silence(self):
        pitch=np.full(120,np.nan); level=np.zeros(120)
        pitch[20:50]=pitch[70:100]=57; level[20:50]=level[70:100]=.1
        notes=decode_notes(pitch,np.full(120,.9),level,.01,[.55],1.2)
        self.assertEqual([round(n['time'],2) for n in notes],[.2,.7])
        self.assertEqual([round(n['duration'],2) for n in notes],[.3,.3])

    def test_short_pitch_changes_are_preserved(self):
        pitch=np.repeat([57.,59.,58.],12);level=np.full(36,.1)
        notes=decode_notes(pitch,np.full(36,.9),level,.01,[.12,.24],.36)
        self.assertEqual([n['pitch'] for n in notes],[57,59,58])

    def test_level_correction_keeps_samples_clock_and_source_intact(self):
        rate=16000; t=np.arange(rate,dtype=np.float32)/rate
        quiet=(np.sin(t*2*np.pi*220)*.001).astype(np.float32)
        original=quiet.copy(); corrected=condition_voice(quiet,rate)
        np.testing.assert_array_equal(quiet,original)
        self.assertEqual(len(corrected),len(quiet))
        np.testing.assert_array_equal(np.signbit(corrected[100:-100]),np.signbit(quiet[100:-100]-quiet.mean()))
        self.assertGreater(np.max(np.abs(corrected)),np.max(np.abs(quiet))*10)
        healthy=(np.sin(t*2*np.pi*220)*.1).astype(np.float32)
        np.testing.assert_array_equal(condition_voice(healthy,rate),healthy)
        np.testing.assert_array_equal(condition_voice(np.zeros(rate,np.float32),rate),np.zeros(rate,np.float32))
        self.assertLess(np.max(np.abs(condition_voice(np.full(rate,.1,np.float32),rate))),1e-6)

    def wav(self, channels=1, count=1600, rate=16000):
        f=io.BytesIO()
        with wave.open(f,'wb') as w:
            w.setnchannels(channels);w.setsampwidth(2);w.setframerate(rate)
            w.writeframes(b'\0\0'*count*channels)
        return f.getvalue()

    def test_bounded_mono_wav_and_truncated_data(self):
        pcm,rate=read_voice(self.wav())
        self.assertEqual((len(pcm),rate),(1600,16000))
        for data in (b'not audio',self.wav(channels=2),self.wav(count=480161),self.wav()[:-10]):
            with self.assertRaises(HTTPException):read_voice(data)

if __name__=='__main__': unittest.main()
