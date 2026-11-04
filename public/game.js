export const CLIP_LENGTHS = Object.freeze([1, 2, 4, 7, 11, 16]);
export const DEMO_SONGS = Object.freeze([
  { id: 'demo-1', title: 'Neon Avenue', artist: 'Offbeat Originals', genre: 'Synth pop', year: '2026', preview: '/audio/neon-avenue.wav', demo: true },
  { id: 'demo-2', title: 'Sunday Somewhere', artist: 'Offbeat Originals', genre: 'Lo-fi', year: '2026', preview: '/audio/sunday-somewhere.wav', demo: true },
  { id: 'demo-3', title: 'After Hours', artist: 'Offbeat Originals', genre: 'Electronic', year: '2026', preview: '/audio/after-hours.wav', demo: true },
  { id: 'demo-4', title: 'Golden State', artist: 'Offbeat Originals', genre: 'Indie pop', year: '2026', preview: '/audio/golden-state.wav', demo: true },
  { id: 'demo-5', title: 'Paper Planes', artist: 'Offbeat Originals', genre: 'Chill', year: '2026', preview: '/audio/paper-planes.wav', demo: true },
]);

export function normalize(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, 'and').replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^a-z0-9]/g, '');
}
export function isCorrect(guess, target) {
  if (!guess || !target) return false;
  if (typeof guess === 'object') return String(guess.id) === String(target.id) || (normalize(guess.title) === normalize(target.title) && normalize(guess.artist) === normalize(target.artist));
  const text = normalize(guess);
  return !!text && [normalize(target.title), normalize(`${target.artist} ${target.title}`), normalize(`${target.title} ${target.artist}`)].includes(text);
}
export function pointsFor(attempt, hinted = false) {
  return Math.max(50, [1000, 800, 600, 400, 250, 100][Math.min(5, Math.max(0, attempt))] - (hinted ? 150 : 0));
}
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function fromCatalog(result) {
  return { id: String(result.trackId), title: result.trackName, artist: result.artistName, genre: result.primaryGenreName || 'Music', year: result.releaseDate?.slice(0, 4) || 'Unknown year', preview: result.previewUrl, artwork: result.artworkUrl100, url: result.trackViewUrl };
}
export function catalogSongs(results) {
  const seen = new Set();
  return results.filter(item => item.kind === 'song' && item.previewUrl && item.trackName && item.artistName).map(fromCatalog).filter(song => {
    const key = `${normalize(song.title)}:${normalize(song.artist)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function trackFromFile(file, url) {
  const name = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  const split = name.indexOf(' - ');
  return { id: `local-${file.name}-${file.size}-${file.lastModified}`, artist: split > 0 ? name.slice(0, split).trim() : 'Your library', title: split > 0 ? name.slice(split + 3).trim() : name.trim(), genre: 'Your collection', year: 'Local track', preview: url, local: true };
}
