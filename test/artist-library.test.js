import test from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY_KEY, MAX_PLAYLIST_ARTISTS, cleanArtists, readArtistLibrary, saveArtistLibrary, roundSetting, chooseRounds, buildArtistDeck } from '../public/artist-library.js';

test('round choices accept whole counts 1–50 and random', () => {
  for (const value of [1, '5', 20, 50, 'random']) assert.notEqual(roundSetting(value), null);
  for (const value of [0, 51, '', 'abc', 2.5, NaN, null]) assert.equal(roundSetting(value), null);
  assert.equal(chooseRounds('random', () => 0), 5);
  assert.equal(chooseRounds('random', () => .999999), 20);
  assert.equal(chooseRounds(1), 1);
  assert.throws(() => chooseRounds(51), RangeError);
});
test('balanced artist shuffle includes each artist and does not mutate inputs', () => {
  const groups = [8, 3, 2].map((length, artist) => Array.from({ length }, (_, i) => ({ id: `${artist}-${i}`, artist })));
  const original = structuredClone(groups);
  const deck = buildArtistDeck(groups, 6, () => .25);
  assert.deepEqual(groups, original);
  assert.equal(new Set(deck.slice(0, 3).map(song => song.artist)).size, 3);
  assert.deepEqual([0, 1, 2].map(artist => deck.filter(song => song.artist === artist).length), [2, 2, 2]);
});
test('sessions stop at available unique songs and never repeat an ID', () => {
  const song = { id: 'same' };
  const deck = buildArtistDeck([[song, { id: '2' }], [song, { id: '3' }]], 50, () => .5);
  assert.equal(deck.length, 3);
  assert.equal(new Set(deck.map(item => item.id)).size, 3);
  assert.deepEqual(buildArtistDeck([], 5), []);
  assert.equal(buildArtistDeck([[{ id: '1' }, { id: '2' }]], 1).length, 1);
});
test('saved artists are validated and deduplicated by ID', () => {
  assert.deepEqual(cleanArtists([{ id: 10, name: ' Queen ' }, { id: '10', name: 'Duplicate' }, { id: 'bad', name: 'Invalid' }, { id: 0, name: 'Invalid' }, { id: 20, name: '' }]), [{ id: '10', name: 'Queen', genre: 'Artist' }]);
  const library = { liked: [{ id: '10', name: 'Queen', genre: 'Rock' }], playlist: [{ id: '20', name: 'ABBA', genre: 'Pop' }] };
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.ok(saveArtistLibrary(storage, library));
  assert.ok(values.has(LIBRARY_KEY));
  assert.deepEqual(readArtistLibrary(storage), library);
  assert.equal(readArtistLibrary({ getItem: () => JSON.stringify({ playlist: Array.from({ length: 30 }, (_, i) => ({ id: i+1, name: 'Artist' })) }) }).playlist.length, MAX_PLAYLIST_ARTISTS);
});
test('unavailable storage or malformed data does not prevent in-memory use', () => {
  assert.deepEqual(readArtistLibrary({ getItem: () => '{broken' }), { liked: [], playlist: [] });
  assert.deepEqual(readArtistLibrary(undefined), { liked: [], playlist: [] });
  assert.equal(saveArtistLibrary({ setItem: () => { throw new Error('Blocked'); } }, { liked: [], playlist: [] }), false);
});
