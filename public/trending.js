const cache = new Map();
const validCountry = country => ['us', 'gb'].includes(country) ? country : 'us';
const httpsURL = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };

export function parseTrendingChart(data, country = 'us') {
  const feed = data?.feed;
  const entries = Array.isArray(feed?.entry) ? feed.entry : feed?.entry ? [feed.entry] : [];
  const seen = new Set();
  const songs = entries.map((entry, index) => {
    const id = String(entry.id?.attributes?.['im:id'] || '');
    const artist = entry['im:artist'];
    const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
    const preview = links.find(link => link.attributes?.rel === 'enclosure' && link.attributes?.type?.startsWith('audio/'));
    return { id, title: entry['im:name']?.label || '', artist: artist?.label || '', artistId: String(artist?.attributes?.['im:id'] || artist?.attributes?.href?.match(/(?:\/id|\/)(\d+)(?=[/?#]|$)/)?.[1] || '') || null, album: entry['im:collection']?.['im:name']?.label || '', albumId: null, genre: entry.category?.attributes?.label || 'Music', year: entry['im:releaseDate']?.label?.slice(0, 4) || 'Unknown year', preview: httpsURL(preview?.attributes?.href), url: httpsURL(entry.id?.label), rank: index + 1 };
  }).filter(song => {
    if (!/^\d+$/.test(song.id) || !song.title || !song.artist || seen.has(song.id)) return false;
    seen.add(song.id); return true;
  });
  if (!songs.length) throw new Error('The chart returned no readable songs. Please try refreshing.');
  const updated = Date.parse(feed.updated?.label);
  return { country: validCountry(country), updated: Number.isFinite(updated) ? new Date(updated).toISOString() : null, songs };
}
function jsonpChart(url) {
  return new Promise((resolve, reject) => {
    const callback = `offbeat_chart_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const cleanup = () => { clearTimeout(timer); script.remove(); delete window[callback]; };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The chart feed took too long to respond.')); }, 8000);
    window[callback] = data => { cleanup(); resolve(data); };
    script.src = `${url}?${new URLSearchParams({ callback, _: String(Date.now()) })}`;
    script.onerror = () => { cleanup(); reject(new Error('The chart feed could not be reached.')); };
    document.head.append(script);
  });
}
export async function loadTrendingChart(country = 'us', refresh = false) {
  country = validCountry(country);
  const saved = cache.get(country);
  if (!refresh && saved && Date.now() - saved.savedAt < 300000) return saved.chart;
  const url = `https://itunes.apple.com/${country}/rss/topsongs/limit=25/json`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10000);
  let data;
  try {
    const response = await fetch(url, { signal: abort.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Chart request failed');
    data = await response.json();
  } catch {
    data = await jsonpChart(url);
  } finally { clearTimeout(timer); }
  const chart = parseTrendingChart(data, country);
  cache.set(country, { chart, savedAt: Date.now() });
  return chart;
}
