import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_LENGTHS, MAX_CLIP_LENGTH, formatTime, DEMO_SONGS, normalize, isCorrect, pointsFor, shuffle, catalogSongs, trackFromFile } from '../public/game.js';

test('seven requested clip lengths and descending point values', () => {
  assert.deepEqual(CLIP_LENGTHS, [0.1, 0.5, 1, 3, 5, 10, 15]);
  assert.equal(MAX_CLIP_LENGTH, 15);
  assert.deepEqual(CLIP_LENGTHS.map((_, i) => pointsFor(i)), [1000, 900, 800, 600, 400, 250, 100]);
  assert.equal(pointsFor(0, true), 850);
  assert.equal(pointsFor(6, true), 50);
  assert.equal(pointsFor(99), 100);
});
test('playback times display fractions without rounding a 0.1s clip to zero', () => {
  assert.equal(formatTime(0), '0:00.0');
  assert.equal(formatTime(0.1), '0:00.1');
  assert.equal(formatTime(0.5), '0:00.5');
  assert.equal(formatTime(1), '0:01.0');
  assert.equal(formatTime(15), '0:15.0');
  assert.equal(formatTime(-1), '0:00.0');
});
test('typed guesses accept punctuation, accents, and version labels', () => {
  const song = { id: '1', title: 'Déjà Vu (Remastered)', artist: 'Beyoncé' };
  assert.ok(isCorrect('Deja Vu', song));
  assert.ok(isCorrect('Beyonce - deja vu', song));
  assert.ok(isCorrect('deja vu — beyonce', song));
  assert.ok(!isCorrect('Beyonce', song));
  assert.ok(!isCorrect('', song));
  assert.ok(!isCorrect('something else', song));
  assert.equal(normalize('Rock & Roll!'), 'rockandroll');
});
test('catalog guesses match an alternate release but not another artist', () => {
  const song = { id: '1', title: 'Hello', artist: 'Adele' };
  assert.ok(isCorrect({ ...song, id: '2' }, song));
  assert.ok(!isCorrect({ id: '3', title: 'Hello', artist: 'Lionel Richie' }, song));
});
test('catalog drops unplayable songs and duplicates', () => {
  const song = { kind: 'song', trackId: 1, trackName: 'Test', artistName: 'Artist', previewUrl: 'https://example.com/audio', releaseDate: '2020-01-01' };
  const result = catalogSongs([song, { ...song, trackId: 2 }, { ...song, previewUrl: '' }, { ...song, kind: 'music-video' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].year, '2020');
  assert.equal(result[0].preview, song.previewUrl);
});
test('shuffle preserves every song without mutating the source', () => {
  const source = [...DEMO_SONGS];
  const shuffled = shuffle(source, () => 0);
  assert.deepEqual(source, DEMO_SONGS);
  assert.equal(new Set(shuffled.map(song => song.id)).size, 5);
  assert.notDeepEqual(shuffled, source);
});
test('uploaded songs derive title and artist from filenames', () => {
  assert.deepEqual(trackFromFile({ name: 'My_Artist - My_Song.mp3', size: 120, lastModified: 1 }, 'blob:test'), {
    id: 'local-My_Artist - My_Song.mp3-120-1', title: 'My Song', artist: 'My Artist', genre: 'Your collection', year: 'Local track', preview: 'blob:test', local: true,
  });
  assert.equal(trackFromFile({ name: 'Song.wav' }, 'blob:test').title, 'Song');
});
