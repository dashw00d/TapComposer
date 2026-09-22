"""Render the app's real arranged example through its own premium HTTP API."""
import asyncio
import io
import json
import sys
import time
import wave
from pathlib import Path
import httpx
from urllib.parse import quote

async def main():
    root = Path(__file__).resolve().parent.parent
    origin = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
    metadata = json.loads((root / 'outputs/demo-metadata.json').read_text())
    source = (root / 'outputs/demo-source.wav').read_bytes()
    # Optional longer cover regression: repeat the public demo, never user audio.
    if len(sys.argv) > 2:
        seconds = float(sys.argv[2])
        if not 10 <= seconds <= 180: raise ValueError('Use 10–180 seconds')
        with wave.open(io.BytesIO(source)) as audio:
            params = audio.getparams()
            frames = audio.readframes(audio.getnframes())
        size = round(seconds * params.framerate) * params.nchannels * params.sampwidth
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as audio:
            audio.setparams(params)
            audio.writeframes((frames * (size // len(frames) + 1))[:size])
        source = buffer.getvalue()
        metadata['duration'] = seconds
    async with httpx.AsyncClient(timeout=90) as client:
        health = (await client.get(origin + '/api/premium/status')).json()
        if not health.get('ready'): raise RuntimeError('Premium service is not ready')
        response = await client.post(origin + '/api/premium/render',
            headers={'Origin':origin,'Content-Type':'audio/wav','X-TapComposer-Arrangement':quote(json.dumps(metadata))},
            content=source)
        response.raise_for_status(); job = response.json()
        (root / 'outputs/smoke-job.json').write_text(json.dumps(job))
        print('Submitted real arrangement:', job['id'], flush=True)
        started = time.monotonic(); previous = ''
        while time.monotonic() - started < 1500:
            response = await client.get(origin + '/api/premium/jobs/' + job['id']); response.raise_for_status(); state = response.json()
            if state['state'] != previous: print('Render:',state['state'],flush=True); previous = state['state']
            if state['state'] == 'failed': raise RuntimeError(state.get('error'))
            if state['state'] == 'ready':
                response = await client.get(origin + '/api/premium/jobs/' + job['id'] + '/audio'); response.raise_for_status()
                (root / 'outputs/premium-demo.wav').write_bytes(response.content)
                print('Saved real studio performance:',len(response.content),'bytes in',round(time.monotonic()-started),'seconds',flush=True); return
            await asyncio.sleep(3)
        raise RuntimeError('Render timed out')

if __name__ == '__main__': asyncio.run(main())
