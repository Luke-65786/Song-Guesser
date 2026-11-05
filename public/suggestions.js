import { catalogSongs } from './game.js';
import { catalogSearch, catalogLookup } from './catalog.js';
import { emptyFilters, filterSongs, filterLabel } from './filters.js';

export function searchText(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function matchSongQuery(songs, query) {
  const words = searchText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return songs.filter(song => {
    const text = searchText(`${song.title} ${song.artist} ${song.album || ''}`);
    return words.every(word => text.includes(word));
  });
}
export function scopedSongs(songs, scope) {
  if (scope.mode === 'playlist') {
    const artists = new Set((scope.playlist || []).map(artist => String(artist.id)));
    return filterSongs(songs, scope.filters || emptyFilters()).filter(song => artists.has(String(song.artistId)));
  }
  if (scope.mode === 'artist') return songs.filter(song => searchText(song.artist) === searchText(scope.artist));
  if (scope.mode === 'filtered') return filterSongs(songs, scope.filters || emptyFilters());
  return songs;
}
export function searchScopeLabel(scope) {
  const label = filterLabel(scope.filters || emptyFilters());
  if (scope.mode === 'playlist') return `Search this playlist: ${(scope.playlist || []).map(artist => artist.name).join(', ')}${label !== 'The everything mix' ? ' · ' + label : ''}`;
  if (scope.mode === 'artist') return `Search ${scope.artist} songs only`;
  if (scope.mode === 'filtered') return `Search this mix: ${label}`;
  if (scope.mode === 'trending') return 'Search playable songs from this trending chart';
  if (scope.mode === 'demo') return 'Search the original demo tracks';
  if (scope.mode === 'local') return 'Search your uploaded tracks';
  return 'Search all songs · Apply a mix or shuffle a playlist to narrow results';
}
export async function findMixSuggestions(query, scope, knownSongs = []) {
  if (!searchText(query)) return [];
  if (['demo', 'local', 'trending'].includes(scope.mode)) return matchSongQuery(knownSongs, query);
  const filters = scope.filters || emptyFilters();
  const collection = scope.mode === 'playlist' || scope.mode === 'artist' || (scope.mode === 'filtered' && (filters.artist || filters.album));
  let songs = knownSongs;
  if (collection) {
    // Search the whole eligible collection, not just the songs drawn for the session.
    if (!songs.length) {
      if (scope.mode === 'playlist') {
        songs = [];
        for (let index = 0; index < scope.playlist.length; index += 3) {
          const groups = await Promise.all(scope.playlist.slice(index, index + 3).map(async artist => catalogSongs(await catalogLookup(artist.id)).filter(song => String(song.artistId) === String(artist.id))));
          songs.push(...groups.flat());
        }
      } else if (scope.mode === 'artist') songs = await catalogSearch(scope.artist);
      else songs = catalogSongs(await catalogLookup(filters.album?.id || filters.artist.id));
    }
  } else {
    try {
      const remote = await catalogSearch(query);
      songs = scope.mode === 'everything' ? remote : [...new Map([...knownSongs, ...remote].map(song => [song.id, song])).values()];
    } catch (error) {
      const fallback = matchSongQuery(scopedSongs(knownSongs, scope), query);
      if (scope.mode !== 'everything' && fallback.length) return fallback;
      throw error;
    }
  }
  const unique = [...new Map(songs.map(song => [song.id, song])).values()];
  return matchSongQuery(scopedSongs(unique, scope), query);
}
