import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../server.js';
let origin;
before(async () => { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); origin = `http://127.0.0.1:${server.address().port}`; });
after(() => server.listening ? new Promise(resolve => server.close(resolve)) : undefined);

test('serves the actual application and module', async () => {
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /What's the track/);
  const app = await fetch(origin + '/app.js');
  assert.match(app.headers.get('content-type'), /javascript/);
  assert.match(await app.text(), /prepareDeck/);
});
test('audio files support browser byte range requests', async () => {
  const response = await fetch(origin + '/audio/neon-avenue.wav', { headers: { Range: 'bytes=0-43' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-length'), '44');
  const header = Buffer.from(await response.arrayBuffer());
  assert.equal(header.toString('ascii', 0, 4), 'RIFF');
  assert.equal(header.toString('ascii', 8, 12), 'WAVE');
});
test('invalid ranges and missing files return meaningful statuses', async () => {
  assert.equal((await fetch(origin + '/audio/neon-avenue.wav', { headers: { Range: 'bytes=9999999999-' } })).status, 416);
  assert.equal((await fetch(origin + '/not-a-file')).status, 404);
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
});
