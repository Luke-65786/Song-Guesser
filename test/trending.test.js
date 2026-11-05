import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrendingChart } from '../public/trending.js';

const song = (id, title = 'Chart Hit') => ({
  id: { attributes: { 'im:id': String(id) }, label: `https://music.apple.com/us/album/hit/${id}` },
  'im:name': { label: title }, 'im:artist': { label: 'Chart Artist', attributes: { href: 'https://music.apple.com/us/artist/chart-artist/123' } },
  'im:collection': { 'im:name': { label: 'Chart Album' } }, category: { attributes: { label: 'Pop' } },
  'im:releaseDate': { label: '2026-01-01T00:00:00-07:00' },
  link: [{ attributes: { rel: 'enclosure', type: 'audio/x-m4a', href: 'https://audio-ssl.itunes.apple.com/preview.m4a' } }],
});
test('chart parsing retains source rankings, timestamp, identities and playable previews', () => {
  const chart = parseTrendingChart({ feed: { updated: { label: '2026-11-05T12:00:00Z' }, entry: [song(10), song(11, 'Second Hit')] } }, 'gb');
  assert.equal(chart.country, 'gb');
  assert.equal(chart.updated, '2026-11-05T12:00:00.000Z');
  assert.deepEqual(chart.songs.map(track => [track.id, track.rank]), [['10', 1], ['11', 2]]);
  assert.equal(chart.songs[0].artistId, '123');
  assert.equal(chart.songs[0].album, 'Chart Album');
  assert.equal(chart.songs[0].year, '2026');
  assert.match(chart.songs[0].preview, /^https:/);
});
test('invalid and duplicate songs are removed without renumbering the published ranks', () => {
  const chart = parseTrendingChart({ feed: { entry: [song(10), song(10), song('invalid'), song(11)] } }, 'invalid');
  assert.deepEqual(chart.songs.map(track => track.rank), [1, 4]);
  assert.equal(chart.updated, null);
  assert.equal(chart.country, 'us');
});
test('songs without secure audio remain visible in the chart but have no playable preview', () => {
  const entry = song(10);
  entry.link[0].attributes.href = 'javascript:alert(1)';
  entry.id.label = 'http://example.com/track';
  const chart = parseTrendingChart({ feed: { entry } });
  assert.equal(chart.songs.length, 1);
  assert.equal(chart.songs[0].preview, null);
  assert.equal(chart.songs[0].url, null);
  assert.throws(() => parseTrendingChart({ feed: {} }), /no readable songs/);
});
