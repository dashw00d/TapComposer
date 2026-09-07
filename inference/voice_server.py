"""Loopback-only GPU voice service. Audio is bounded and processed in memory."""
import asyncio
import contextlib
import hmac
import io
import os
import wave

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Request
from voice_engine import VoiceEngine

TOKEN = os.environ.get('TAPCOMPOSER_INFERENCE_KEY', '')
MAX_BYTES = 12 * 1024 * 1024
engine = None
busy = False


def read_voice(data):
    try:
        with wave.open(io.BytesIO(data)) as wav:
            rate, count = wav.getframerate(), wav.getnframes()
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or not 8000 <= rate <= 192000 or not 0 < count/rate <= 30.01:
                raise ValueError()
            frames = wav.readframes(count)
            if len(frames) != count*2: raise ValueError()
        return np.frombuffer(frames, dtype='<i2').astype(np.float32)/32768, rate
    except (wave.Error, EOFError, ValueError):
        raise HTTPException(400, 'Use a mono PCM WAV recording of at most 30 seconds.')


def initialize():
    global engine
    model = VoiceEngine()
    # Warm both pitch and boundary models before advertising readiness.
    t = np.arange(16000, dtype=np.float32)/16000
    model.transcribe(.05*np.sin(2*np.pi*220*t), 16000)
    torch.cuda.empty_cache()
    engine = model


@contextlib.asynccontextmanager
async def lifespan(app):
    await asyncio.to_thread(initialize)
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def authorized(request):
    if not TOKEN or not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer '+TOKEN):
        raise HTTPException(401, 'Authentication required.')


@app.get('/health')
async def health(request: Request):
    authorized(request)
    return {'ready': engine is not None, 'busy': busy}


@app.post('/transcribe')
async def transcribe(request: Request):
    global busy
    authorized(request)
    if engine is None or busy: raise HTTPException(503, 'Voice recognition is busy.')
    if request.headers.get('content-type', '').split(';')[0] != 'audio/wav':
        raise HTTPException(400, 'Send a WAV recording.')
    busy = True
    try:
        async with asyncio.timeout(15):
            chunks = []; size = 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES: raise HTTPException(413, 'Recording too large.')
                chunks.append(chunk)
        pcm, rate = read_voice(b''.join(chunks))
        # A disconnected caller cannot start overlapping GPU work: shield the task
        # and hold the busy slot until the worker has actually finished.
        task = asyncio.create_task(asyncio.to_thread(engine.transcribe, pcm, rate))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise
    except TimeoutError:
        raise HTTPException(408, 'Recording upload timed out.')
    except torch.cuda.OutOfMemoryError:
        raise HTTPException(503, 'Voice recognition is temporarily unavailable.')
    finally:
        torch.cuda.empty_cache()
        busy = False
