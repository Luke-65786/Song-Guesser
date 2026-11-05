import test from 'node:test';
import assert from 'node:assert/strict';
import { ERAS, GENRES, emptyFilters, filterSongs, filterLabel, discoveryTerms } from '../public/filters.js';
import { fromCatalog } from '../public/game.js';

const base = { id: '1', year: '1985', genre: 'Rock', artist: 'Queen', artistId: '10', album: 'A record', albumId: '100' };
test('decade filters include both boundaries and exclude unknown dates', () => {
  const songs = ['1979', '1980', '1989', '1990', 'Unknown year'].map(year => ({ ...base, year }));
  assert.deepEqual(filterSongs(songs, { era: '1980' }).map(song => song.year), ['1980', '1989']);
});
test('genre filters use catalog genres and aliases, not artist search terms', () => {
  const songs = ['Rock', 'Pop Rock', 'Pop', 'Country'].map(genre => ({ ...base, genre }));
  assert.deepEqual(filterSongs(songs, { genre: 'rock' }).map(song => song.genre), ['Rock', 'Pop Rock']);
  assert.equal(filterSongs([{ ...base, genre: 'Hip-Hop/Rap' }], { genre: 'hiphop' }).length, 1);
});
test('combined filters intersect and artist/album identities are exact', () => {
  const filters = { era: '1980', genre: 'rock', artist: { id: '10', name: 'Queen' }, album: { id: '100' } };
  const songs = [base, { ...base, year: '1991' }, { ...base, genre: 'Pop' }, { ...base, artistId: '20' }, { ...base, albumId: '101' }];
  assert.deepEqual(filterSongs(songs, filters), [base]);
  assert.equal(filterSongs([{ ...base, albumId: null }], filters).length, 0);
  assert.equal(filterSongs(songs, emptyFilters()).length, songs.length);
});
test('labels and discovery cover each supported era and genre', () => {
  assert.equal(filterLabel(emptyFilters()), 'The everything mix');
  assert.equal(filterLabel({ era: '1980', genre: 'rock', artist: { name: 'Queen' }, album: { title: 'A record' } }), '1980s · Rock · Queen · A record');
  for (const era of ERAS) assert.ok(discoveryTerms({ era: era.value }).length >= 3);
  for (const genre of GENRES) assert.ok(discoveryTerms({ genre: genre.value }).length >= 3);
  assert.ok(discoveryTerms({ era: '1980', genre: 'rock' }).length <= 6);
});
test('catalog conversion retains release, genre, artist, and album identity', () => {
  const song = fromCatalog({ trackId: 1, trackName: 'Test', artistName: 'Artist', artistId: 10, collectionId: 100, collectionName: 'Record', releaseDate: '1985-01-01', primaryGenreName: 'Rock' });
  assert.equal(song.artistId, '10'); assert.equal(song.albumId, '100'); assert.equal(song.album, 'Record'); assert.equal(song.year, '1985');
});
