import io
import json
import os
import tempfile
import unittest
import wave
os.environ['TAPCOMPOSER_RENDER_DIR'] = tempfile.mkdtemp()
os.environ['TAPCOMPOSER_INFERENCE_KEY'] = 'test-token'
from urllib.parse import quote
import httpx
import gateway

class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=gateway.app), base_url='http://test')
        self.headers = {'Authorization': 'Bearer test-token'}
        gateway.active.clear()
        while not gateway.queue.empty(): gateway.queue.get_nowait(); gateway.queue.task_done()
    async def asyncTearDown(self): await self.client.aclose()
    async def test_authorization(self):
        self.assertEqual((await self.client.get('/health')).status_code, 401)
        self.assertEqual((await self.client.post('/jobs')).status_code, 401)
        self.assertEqual((await self.client.get('/jobs/../etc/passwd', headers=self.headers)).status_code, 404)
    async def test_audio_validation_and_capacity(self):
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(8000); wav.writeframes(b'\0' * 160000)
        metadata = {'duration':10,'tempo':100,'key':0,'mode':'major','prompt':'Piano','strength':.8}
        async def submit(audio): return await self.client.post('/jobs', headers={**self.headers,'Content-Type':'audio/wav','X-TapComposer-Arrangement':quote(json.dumps(metadata))},content=audio)
        self.assertEqual((await submit(b'bad')).status_code, 400)
        response = await submit(output.getvalue()); self.assertEqual(response.status_code, 200, response.text)
        job = response.json(); self.assertEqual(job['state'],'queued'); self.assertNotIn('metadata',job)
        self.assertEqual((await self.client.get('/jobs/'+job['id']+'/audio',headers=self.headers)).status_code,409)
        self.assertEqual((await self.client.get('/jobs/'+job['id'],headers=self.headers)).json()['state'],'queued')
        await submit(output.getvalue()); await submit(output.getvalue())
        self.assertEqual((await submit(output.getvalue())).status_code,429)
    async def test_invalid_settings(self):
        for value in [None, {}, {'duration':float('nan')}, {'duration':1000}]:
            with self.assertRaises(gateway.HTTPException): gateway.metadata(json.dumps(value))

if __name__ == '__main__': unittest.main()
