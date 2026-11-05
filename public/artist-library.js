import { shuffle } from './game.js';

export const LIBRARY_KEY = 'offbeat-artist-library-v1';
export const MAX_PLAYLIST_ARTISTS = 20;
export const MAX_ROUNDS = 50;

export function cleanArtists(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter(item => item && /^[1-9]\d*$/.test(String(item.id)) && typeof item.name === 'string' && item.name.trim()).map(item => ({ id: String(item.id), name: item.name.trim().slice(0, 200), genre: typeof item.genre === 'string' ? item.genre.slice(0, 80) : 'Artist' })).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}
export function readArtistLibrary(storage) {
  try {
    const value = JSON.parse(storage?.getItem(LIBRARY_KEY) || '{}');
    return { liked: cleanArtists(value?.liked).slice(0, 200), playlist: cleanArtists(value?.playlist).slice(0, MAX_PLAYLIST_ARTISTS) };
  } catch { return { liked: [], playlist: [] }; }
}
export function saveArtistLibrary(storage, library) {
  try { storage.setItem(LIBRARY_KEY, JSON.stringify(library)); return true; } catch { return false; }
}
export function roundSetting(value) {
  if (value === 'random') return 'random';
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MAX_ROUNDS ? count : null;
}
export function chooseRounds(setting, random = Math.random) {
  if (setting === 'random') return 5 + Math.floor(random() * 16);
  const count = roundSetting(setting);
  if (count === null) throw new RangeError('Choose 1–50 rounds or Random.');
  return count;
}
// Shuffle within each artist and draw from artists in a new random order per pass.
// This balances a mixed playlist and stops when all unique available songs are used.
export function buildArtistDeck(groups, count, random = Math.random) {
  const pools = groups.map(group => shuffle(group, random));
  const seen = new Set();
  const deck = [];
  while (deck.length < count && pools.some(pool => pool.length)) {
    for (const pool of shuffle(pools.filter(pool => pool.length), random)) {
      let song;
      do { song = pool.pop(); } while (song && seen.has(song.id));
      if (song) { seen.add(song.id); deck.push(song); }
      if (deck.length >= count) break;
    }
  }
  return deck;
}
