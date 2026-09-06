import { test } from 'node:test';
import assert from 'node:assert/strict';
import { premiumRequest } from '../lib/premium/proxy';
import { renderMetadata, songFingerprint } from '../lib/premium/client';
import { makeDemoSong } from '../lib/music/demo';
import { exportProject, importProject } from '../lib/music/project';
const config = {
  enabled: true,
  origin: 'https://inference.example',
  token: 'server-only-secret',
};
void test('premium entitlement and route allowlist fail closed', async () => {
  const upstream = (async () => {
    throw new Error('Must not contact inference');
  }) as typeof fetch;
  for (const path of ['render', 'jobs/abc'])
    assert.equal(
      (
        await premiumRequest(
          new Request('https://studio.example/api/premium/' + path, {
            method: 'POST',
          }),
          { enabled: false },
          upstream,
        )
      ).status,
      403,
    );
  assert.equal(
    (
      await premiumRequest(
        new Request('https://studio.example/api/premium/v1/init'),
        config,
        upstream,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await premiumRequest(
        new Request('https://studio.example/api/premium/render', {
          method: 'POST',
          headers: {
            Origin: 'https://evil.example',
            'Content-Type': 'audio/wav',
          },
        }),
        config,
        upstream,
      )
    ).status,
    403,
  );
});
void test('premium proxy forwards audio and credentials only to the configured server', async () => {
  const form = new Blob(['source'], { type: 'audio/wav' });
  const response = await premiumRequest(
    new Request('https://studio.example/api/premium/render', {
      method: 'POST',
      body: form,
      headers: {
        'Content-Type': 'audio/wav',
        'X-TapComposer-Arrangement': 'encoded-settings',
      },
    }),
    config,
    (async (url, init) => {
      assert.equal(
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
        'https://inference.example/jobs',
      );
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer server-only-secret',
      );
      const request = new Request(url, init);
      assert.equal(await request.text(), 'source');
      assert.equal(
        request.headers.get('X-TapComposer-Arrangement'),
        'encoded-settings',
      );
      return Response.json({ id: 'example', state: 'queued' });
    }) as typeof fetch,
  );
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes(config.token));
});
void test('health never exposes upstream internals and reports actual readiness', async () => {
  const response = await premiumRequest(
    new Request('https://studio.example/api/premium/status'),
    config,
    (async () =>
      Response.json({
        ready: true,
        queued: 1,
        secret: 'private',
      })) as typeof fetch,
  );
  assert.deepEqual(await response.json(), {
    premium: true,
    ready: true,
    queued: 1,
  });
});
void test('premium uses the arranged song and backups retain takes', async () => {
  const song = makeDemoSong();
  const metadata = renderMetadata(song, 'Intimate strings');
  assert.ok(metadata.duration > 40);
  assert.ok(metadata.prompt.includes('Intimate strings'));
  const fingerprint = songFingerprint(song);
  assert.equal(songFingerprint({ ...song, name: 'Renamed' }), fingerprint);
  assert.notEqual(songFingerprint({ ...song, masterVolume: 0.1 }), fingerprint);
  const audio = new Blob(['RIFF0000WAVEaudio'], { type: 'audio/wav' });
  const restored = await importProject(
    await exportProject({
      ...song,
      premiumTakes: [
        {
          id: 'take',
          createdAt: 1,
          duration: metadata.duration,
          fingerprint,
          audio,
        },
      ],
    }),
  );
  assert.equal(
    await restored.premiumTakes?.[0].audio.text(),
    await audio.text(),
  );
  assert.equal(restored.premiumTakes?.[0].fingerprint, fingerprint);
});
