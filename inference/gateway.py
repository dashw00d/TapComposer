"""Authenticated, narrow premium inference gateway. ACE-Step stays on loopback."""
import asyncio
import contextlib
import hmac
import io
import json
import os
import time
import uuid
import wave
from pathlib import Path
from urllib.parse import urlsplit, unquote

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse

ROOT = Path(os.environ.get('TAPCOMPOSER_RENDER_DIR', './outputs/premium')).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
TOKEN = os.environ.get('TAPCOMPOSER_INFERENCE_KEY', '')
UPSTREAM = os.environ.get('ACESTEP_ORIGIN', 'http://127.0.0.1:8001').rstrip('/')
MODEL = os.environ.get('ACESTEP_CONFIG_PATH', 'acestep-v15-xl-turbo')
queue = asyncio.Queue(maxsize=3)
active = set()

def save(job):
    folder = ROOT / job['id']; folder.mkdir(exist_ok=True)
    temp = folder / 'job.tmp'; temp.write_text(json.dumps(job)); temp.replace(folder / 'job.json')

def read(job_id):
    try:
        if str(uuid.UUID(job_id)) != job_id: raise ValueError()
        return json.loads((ROOT / job_id / 'job.json').read_text())
    except (ValueError, FileNotFoundError): raise HTTPException(404, 'Render not found.')

def public(job):
    return {key: job[key] for key in ('id', 'state', 'createdAt', 'duration', 'error') if key in job}

async def authorized(request):
    if not TOKEN or not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + TOKEN):
        raise HTTPException(401, 'Authentication required.')

def metadata(raw):
    try:
        value = json.loads(raw)
        duration = float(value['duration']); bpm = int(value['tempo']); strength = float(value.get('strength', .8))
        if not 10 <= duration <= 181 or not 40 <= bpm <= 240 or not .5 <= strength <= 1: raise ValueError()
        key = int(value['key']); mode = value['mode']
        if key not in range(12) or mode not in ('major', 'minor'): raise ValueError()
        prompt = str(value['prompt']).strip()
        if not prompt or len(prompt) > 2000: raise ValueError()
        return {'duration': duration, 'tempo': bpm, 'strength': strength, 'key': key, 'mode': mode, 'prompt': prompt}
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(400, 'The arrangement settings are invalid.')

async def process(job):
    folder = ROOT / job['id']; job['state'] = 'rendering'; save(job)
    async with httpx.AsyncClient(timeout=90) as client:
        if not job.get('upstream_id'):
            m = job['metadata']
            # Cover uses the actual editable arrangement as conditioning. ACE-Step skips
            # its LM planner for cover tasks, so no unrelated text-to-music is substituted.
            data = {
                'prompt': m['prompt'], 'lyrics': '[Instrumental]', 'task_type': 'cover',
                'model': MODEL, 'audio_duration': str(m['duration']), 'bpm': str(m['tempo']),
                'key_scale': ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m['key']] + ' ' + m['mode'],
                'time_signature': '4', 'audio_cover_strength': str(m['strength']),
                'batch_size': '1', 'inference_steps': '8', 'audio_format': 'wav',
                'thinking': 'false', 'use_cot_caption': 'false', 'use_cot_language': 'false',
                'use_random_seed': 'true',
            }
            response = await client.post(UPSTREAM + '/release_task', data=data,
                files={'src_audio': ('arrangement.wav', (folder / 'source.wav').read_bytes(), 'audio/wav')})
            response.raise_for_status(); payload = response.json()
            if payload.get('code') != 200: raise RuntimeError('ACE-Step rejected the render')
            job['upstream_id'] = payload['data']['task_id']; save(job)
        deadline = time.monotonic() + 1200
        while time.monotonic() < deadline:
            response = await client.post(UPSTREAM + '/query_result', json={'task_id_list': [job['upstream_id']]})
            response.raise_for_status(); entries = response.json().get('data') or []
            if entries:
                entry = entries[0]
                if entry.get('status') == 2: raise RuntimeError('ACE-Step could not finish the render')
                if entry.get('status') == 1:
                    results = json.loads(entry['result']) if isinstance(entry['result'], str) else entry['result']
                    path = urlsplit(results[0]['file'])
                    if path.path != '/v1/audio': raise RuntimeError('Unexpected audio response')
                    audio = await client.get(UPSTREAM + path.path + '?' + path.query)
                    audio.raise_for_status()
                    if not audio.content.startswith(b'RIFF'): raise RuntimeError('Expected a WAV performance')
                    (folder / 'performance.wav').write_bytes(audio.content)
                    job['state'] = 'ready'; save(job); return
            await asyncio.sleep(3)
        raise RuntimeError('Render exceeded the demo time limit')

async def run_queue():
    while True:
        job_id = await queue.get()
        try:
            job = read(job_id)
            await process(job)
        except Exception as exc:
            print('Premium render failed:', job_id, type(exc).__name__, str(exc), flush=True)
            job = read(job_id); job['state'] = 'failed'; job['error'] = 'The studio could not finish this performance. Your original song is safe; please try again.'; save(job)
        finally:
            (ROOT / job_id / 'source.wav').unlink(missing_ok=True)
            active.discard(job_id); queue.task_done()

@contextlib.asynccontextmanager
async def lifespan(app):
    for file in ROOT.glob('*/job.json'):
        job = json.loads(file.read_text())
        if job.get('state') in ('queued', 'rendering'):
            if queue.full():
                job['state'] = 'failed'; job['error'] = 'The studio restarted. Please render again.'; save(job)
            else: active.add(job['id']); queue.put_nowait(job['id'])
    task = asyncio.create_task(run_queue())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError): await task

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

@app.get('/health')
async def health(request: Request):
    await authorized(request)
    ready = False
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.get(UPSTREAM + '/health')
            info = response.json()
            ready = response.is_success and info.get('data', {}).get('models_initialized') is True
    except Exception: pass
    return {'ready': ready, 'queued': len(active)}

@app.post('/jobs')
async def submit(request: Request):
    await authorized(request)
    if len(active) >= 3: raise HTTPException(429, 'The studio is busy. Try again after the current performances finish.')
    chunks = []; size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 40 * 1024 * 1024: raise HTTPException(413, 'The arrangement is too large.')
        chunks.append(chunk)
    if request.headers.get('content-type', '').split(';')[0] != 'audio/wav': raise HTTPException(400, 'Send an audio arrangement.')
    raw = request.headers.get('x-tapcomposer-arrangement', '')
    if len(raw) > 12000: raise HTTPException(400, 'The arrangement settings are too large.')
    m = metadata(unquote(raw))
    data = b''.join(chunks)
    try:
        with wave.open(io.BytesIO(data)) as audio:
            frames = audio.getnframes(); rate = audio.getframerate()
            seconds = frames / rate
            expected_bytes = frames * audio.getnchannels() * audio.getsampwidth()
            if rate not in (8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000) or expected_bytes > 40 * 1024 * 1024: raise ValueError()
            if len(audio.readframes(frames)) != expected_bytes: raise ValueError()
            if audio.getnchannels() not in (1, 2) or audio.getsampwidth() != 2 or not 10 <= seconds <= 181 or abs(seconds - m['duration']) > 1: raise ValueError()
    except (wave.Error, EOFError, ValueError, ZeroDivisionError): raise HTTPException(400, 'Use a valid song arrangement under three minutes.')
    if len(active) >= 3 or queue.full(): raise HTTPException(429, 'The studio is busy. Please try again shortly.')
    job = {'id': str(uuid.uuid4()), 'state': 'queued', 'createdAt': int(time.time() * 1000), 'duration': m['duration'], 'metadata': m}
    save(job); (ROOT / job['id'] / 'source.wav').write_bytes(data)
    active.add(job['id']); queue.put_nowait(job['id'])
    return public(job)

@app.get('/jobs/{job_id}')
async def status(job_id: str, request: Request):
    await authorized(request); return public(read(job_id))

@app.get('/jobs/{job_id}/audio')
async def audio(job_id: str, request: Request):
    await authorized(request)
    if read(job_id)['state'] != 'ready': raise HTTPException(409, 'The performance is not ready yet.')
    return FileResponse(ROOT / job_id / 'performance.wav', media_type='audio/wav', filename='studio-performance.wav')
