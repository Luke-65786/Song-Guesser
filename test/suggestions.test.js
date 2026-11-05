import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilters } from '../public/filters.js';
import { searchText, matchSongQuery, scopedSongs, findMixSuggestions, searchScopeLabel } from '../public/suggestions.js';

const base = { id: '1', title: 'Shared Hit', artist: 'Queen', artistId: '10', album: 'Record', albumId: '100', genre: 'Rock', year: '1981' };
const songs = [base, { ...base, id: '2', artist: 'ABBA', artistId: '20', albumId: '200' }, { ...base, id: '3', artist: 'Queen Tribute', artistId: '30' }, { ...base, id: '4', year: '1991' }, { ...base, id: '5', genre: 'Pop' }, { ...base, id: '6', albumId: '101' }];
test('artist scope excludes other artists and similarly named tribute artists', () => {
  assert.deepEqual(scopedSongs(songs, { mode: 'filtered', filters: { artist: { id: '10' } } }).map(song => song.id), ['1', '4', '5', '6']);
  assert.deepEqual(scopedSongs(songs, { mode: 'artist', artist: 'Queen' }).map(song => song.id), ['1', '4', '5', '6']);
});
test('playlist suggestions intersect exact artist IDs, era, and genre', () => {
  const scope = { mode: 'playlist', playlist: [{ id: '10' }, { id: '20' }], filters: { era: '1980', genre: 'rock' } };
  assert.deepEqual(scopedSongs(songs, scope).map(song => song.id), ['1', '2', '6']);
  assert.deepEqual(scopedSongs(songs, { ...scope, playlist: [] }), []);
});
test('album membership and other filters apply before showing search matches', () => {
  const scope = { mode: 'filtered', filters: { era: '1980', genre: 'rock', artist: { id: '10' }, album: { id: '100' } } };
  assert.deepEqual(scopedSongs(songs, scope), [base]);
  assert.equal(scopedSongs(songs, { mode: 'everything', filters: scope.filters }).length, songs.length);
});
test('queries match song and artist words in either order, including Unicode names', () => {
  assert.deepEqual(matchSongQuery([base], 'Queen shared'), [base]);
  assert.deepEqual(matchSongQuery([base], 'Shared Queen'), [base]);
  assert.equal(searchText('Beyoncé & JAY-Z'), 'beyonce and jay z');
  const song = { title: '夜に駆ける', artist: 'YOASOBI' };
  assert.deepEqual(matchSongQuery([song, base], '夜に'), [song]);
  assert.deepEqual(matchSongQuery(songs, '!!!'), []);
  assert.deepEqual(scopedSongs([{ ...base, artist: '歌手一' }, { ...base, artist: '歌手二' }], { mode: 'artist', artist: '歌手一' }).map(song => song.artist), ['歌手一']);
});
test('collection search uses the complete eligible pool and removes duplicate IDs', async () => {
  const result = await findMixSuggestions('shared', { mode: 'filtered', filters: { artist: { id: '10' } } }, [...songs, base]);
  assert.deepEqual(result.map(song => song.id), ['1', '4', '5', '6']);
  assert.equal((await findMixSuggestions('Shared', { mode: 'demo' }, [base])).length, 1);
});
test('scope labels describe the active configuration', () => {
  assert.match(searchScopeLabel({ mode: 'playlist', playlist: [{ name: 'Queen' }, { name: 'ABBA' }], filters: { ...emptyFilters(), genre: 'rock' } }), /Queen, ABBA.*Rock/);
  assert.match(searchScopeLabel({ mode: 'everything' }), /all songs/);
  assert.match(searchScopeLabel({ mode: 'local' }), /uploaded/);
});
