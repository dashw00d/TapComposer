"""Render the app's real arranged example through its own premium HTTP API."""
import asyncio
import json
import sys
import time
from pathlib import Path
import httpx
from urllib.parse import quote

async def main():
    root = Path(__file__).resolve().parent.parent
    origin = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
    async with httpx.AsyncClient(timeout=90) as client:
        health = (await client.get(origin + '/api/premium/status')).json()
        if not health.get('ready'): raise RuntimeError('Premium service is not ready')
        response = await client.post(origin + '/api/premium/render',
            headers={'Origin':origin,'Content-Type':'audio/wav','X-TapComposer-Arrangement':quote((root / 'outputs/demo-metadata.json').read_text())},
            content=(root / 'outputs/demo-source.wav').read_bytes())
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
