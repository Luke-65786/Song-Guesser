import { catalogSongs } from './game.js';
const cache = new Map();

// JSONP is supported by the public iTunes API and needs neither a key nor a server proxy.
export async function catalogRequest(endpoint, params) {
  const query = new URLSearchParams({ country: 'US', ...params });
  const key = `${endpoint}?${query}`;
  if (cache.has(key)) return cache.get(key);
  const promise = new Promise((resolve, reject) => {
    const callback = `offbeat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const cleanup = () => { clearTimeout(timer); script.remove(); delete window[callback]; };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The music catalog took too long to respond.')); }, 8000);
    window[callback] = data => { cleanup(); resolve(Array.isArray(data?.results) ? data.results : []); };
    query.set('callback', callback);
    script.src = `https://itunes.apple.com/${endpoint}?${query}`;
    script.onerror = () => { cleanup(); reject(new Error('The music catalog could not be reached.')); };
    document.head.append(script);
  });
  if (cache.size >= 40) cache.delete(cache.keys().next().value);
  cache.set(key, promise);
  try { return await promise; } catch (error) { cache.delete(key); throw error; }
}
export async function catalogSearch(term) {
  return catalogSongs(await catalogRequest('search', { term, entity: 'song', media: 'music', limit: '200' }));
}
export async function catalogLookup(id, entity = 'song') {
  return catalogRequest('lookup', { id: String(id), entity, limit: '200' });
}
