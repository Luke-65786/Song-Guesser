import { CLIP_LENGTHS, DEMO_SONGS, normalize, isCorrect, pointsFor, shuffle, catalogSongs, trackFromFile } from './game.js';

const $ = selector => document.querySelector(selector);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const audio = $('#audio');
const modal = $('#modal');
const state = { mode: 'everything', label: 'The everything mix', artist: '', deck: [], round: 0, attempt: 0, hinted: false, revealed: false, listened: false, results: [], score: 0, streak: 0, maxStreak: 0, loading: false, selected: null, suggestions: [], localTracks: [], generation: 0, finished: false, searchGeneration: 0 };
let playFrame;
let searchTimer;
let toastTimer;
let searchIndex = -1;
let uploading = [];
let uploadErrors = [];
let pendingRestart = null;
let loadingDeck = null;
let playGeneration = 0;
let artistSearchGeneration = 0;
let demoTimer;
let stats = readStats();
const searchCache = new Map();

function readStats() {
  try {
    const saved = JSON.parse(localStorage.getItem('offbeat-stats-v1'));
    if (saved && ['games', 'correct', 'rounds', 'bestScore', 'bestStreak'].every(key => Number.isFinite(saved[key]) && saved[key] >= 0)) return saved;
  } catch { /* Storage is optional in private browsing. */ }
  return { games: 0, correct: 0, rounds: 0, bestScore: 0, bestStreak: 0 };
}
function saveStats() { try { localStorage.setItem('offbeat-stats-v1', JSON.stringify(stats)); } catch { /* Keep in-memory stats when storage is unavailable. */ } }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function target() { return state.deck[state.round]; }
function roundCount() { return state.deck.length || Math.min(5, state.mode === 'local' ? state.localTracks.length : 5); }
function currentPoints() { return pointsFor(state.attempt, state.hinted); }
function openModal(html) { stopAudio(); demoAudio?.pause(); clearTimeout(demoTimer); $('#modal-body').innerHTML = html; if (!modal.open) modal.showModal(); }
function closeModal() { modal.close(); }
function statusText(text) { const el = $('#modal-status'); if (el) el.textContent = text; }

// Apple's public catalog supports JSONP, which works without an API key or a CORS proxy.
async function catalogSearch(term) {
  const key = normalize(term);
  if (searchCache.has(key)) return searchCache.get(key);
  const promise = new Promise((resolve, reject) => {
    const callback = `offbeat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const cleanup = () => { clearTimeout(timer); script.remove(); delete window[callback]; };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The music catalog took too long to respond.')); }, 8000);
    window[callback] = data => { cleanup(); resolve(catalogSongs(Array.isArray(data?.results) ? data.results : [])); };
    script.src = `https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', media: 'music', country: 'US', limit: '50', callback })}`;
    script.onerror = () => { cleanup(); reject(new Error('The music catalog could not be reached.')); };
    document.head.append(script);
  });
  searchCache.set(key, promise);
  try { return await promise; } catch (error) { searchCache.delete(key); throw error; }
}

async function prepareDeck() {
  if (state.deck.length) return true;
  if (loadingDeck) return loadingDeck;
  const generation = state.generation;
  const task = (async () => {
    state.loading = true; updateControls();
    $('#play-caption').textContent = 'Finding your next favorite mystery…';
    await Promise.resolve();
    try {
      let songs;
      if (state.mode === 'demo') songs = DEMO_SONGS;
      else if (state.mode === 'local') songs = state.localTracks;
      else if (state.mode === 'artist') {
        songs = await catalogSearch(state.artist);
        const exact = songs.filter(song => normalize(song.artist) === normalize(state.artist));
        if (exact.length) songs = exact;
      } else {
        const artists = shuffle(['Dua Lipa', 'The Weeknd', 'Queen', 'Adele', 'Daft Punk', 'Taylor Swift', 'Coldplay', 'Billie Eilish', 'Bruno Mars', 'Rihanna', 'ABBA', 'Harry Styles']).slice(0, 3);
        const searches = await Promise.allSettled(artists.map(catalogSearch));
        songs = searches.flatMap(result => result.status === 'fulfilled' ? result.value.slice(0, 12) : []);
      }
      if (generation !== state.generation) return false;
      if (!songs?.length) throw new Error('No playable previews found for this mix.');
      state.deck = shuffle(songs).slice(0, 5);
      renderRound();
      return true;
    } catch (error) {
      if (generation !== state.generation) return false;
      $('#feedback').innerHTML = `${escape(error.message)} Try another artist, <button type="button" data-action="upload">add your own songs</button>, or <button type="button" data-action="demo">play the offline demo</button>.`;
      $('#play-caption').textContent = 'Catalog unavailable. Try the offline demo below.';
      return false;
    } finally {
      if (generation === state.generation) { state.loading = false; updateControls(); }
      if (loadingDeck === task) loadingDeck = null;
    }
  })();
  loadingDeck = task;
  return task;
}

function renderWave() {
  const count = window.innerWidth < 701 ? 43 : 62;
  $('#waveform').innerHTML = Array.from({ length: count }, (_, i) => {
    const height = 7 + Math.abs(Math.sin(i * 1.76) * Math.cos(i * .39)) * 31 + (i % 4) * 1.5;
    return `<span class="wave-bar${i / count < CLIP_LENGTHS[state.attempt] / 16 ? ' unlocked' : ''}" style="height:${height}px"></span>`;
  }).join('');
}
function renderSession() {
  $('#score').textContent = state.score.toLocaleString();
  $('#streak').innerHTML = `${state.streak}<span> songs</span>`;
  $('#round-number').textContent = String(state.round + 1).padStart(2, '0');
  $('#round-total').textContent = String(roundCount()).padStart(2, '0');
  $('#round-list').innerHTML = Array.from({ length: roundCount() }, (_, i) => {
    const result = state.results[i];
    const active = i === state.round && !state.finished;
    return `<div class="round-item${active ? ' active' : ''}${result ? result.correct ? ' won' : ' lost' : ''}"><span class="round-dot">${result ? icon(result.correct ? 'check' : 'close') : i + 1}</span><span class="round-song">${result ? escape(result.title) : `Round ${i + 1}`}</span><span>${result ? result.correct ? `+${result.points}` : 'Missed' : active ? 'You’re up' : 'Up next'}</span></div>`;
  }).join('');
}
function updateControls() {
  $('#play-button').disabled = state.loading;
  $('#audio-player').classList.toggle('is-loading', state.loading);
  $('#guess-button').disabled = state.loading || state.revealed || !$('#guess-input').value.trim();
  $('#guess-input').disabled = state.loading || state.revealed;
  $('#skip-button').disabled = state.loading || state.revealed;
  $('#hint-button').disabled = state.loading || state.revealed || state.hinted;
}
function renderRound() {
  stopAudio();
  state.attempt = 0; state.hinted = false; state.revealed = false; state.selected = null; state.listened = false;
  audio.removeAttribute('src'); audio.load();
  $('#guess-input').value = ''; $('#feedback').textContent = '';
  $('#result').hidden = true; $('#result').className = 'result';
  $('#guess-form').hidden = false; $('#next-button').hidden = true;
  $('#game-title').textContent = "What's the track?";
  $('#game-subtitle').textContent = state.mode === 'demo' ? 'An original demo tune. Listen, then take your best guess.' : state.mode === 'local' ? 'Your library. A tiny snippet. Put your ears to the test.' : 'A familiar tune. A tiny snippet. You’ve got this.';
  $('#mix-label').textContent = state.label;
  $('#play-caption').textContent = 'Press play. Find your first clue.';
  closeSuggestions(); updateAttempt(); renderSession(); updateControls();
}
function updateAttempt() {
  $('#available-points').textContent = currentPoints().toLocaleString();
  $('#attempt-label').textContent = `GUESS ${state.attempt + 1} OF 6`;
  $('#skip-button span').textContent = state.attempt === 5 ? '(reveal song)' : `(+${CLIP_LENGTHS[state.attempt + 1] - CLIP_LENGTHS[state.attempt]} ${CLIP_LENGTHS[state.attempt + 1] - CLIP_LENGTHS[state.attempt] === 1 ? 'second' : 'seconds'})`;
  $$('.clip-step').forEach((el, i) => { el.classList.toggle('active', i === state.attempt); el.classList.toggle('completed', i < state.attempt); });
  $('#audio-time').innerHTML = `0:00 <span>/ 0:${String(CLIP_LENGTHS[state.attempt]).padStart(2, '0')}</span>`;
  renderWave();
}
function $$(selector) { return [...document.querySelectorAll(selector)]; }
function stopAudio() {
  playGeneration++; cancelAnimationFrame(playFrame); audio.pause();
  $('#audio-player').classList.remove('is-playing');
  $('#play-button').setAttribute('aria-label', 'Play song clip');
}
function playbackError() {
  stopAudio();
  $('#play-caption').textContent = 'That clip couldn’t play. Try again or change your mix.';
  $('#feedback').innerHTML = 'The audio may be unavailable in your region or blocked by your connection. <button type="button" data-action="mix">Choose another mix</button> or <button type="button" data-action="demo">try the offline demo</button>.';
}
async function playClip() {
  if (!audio.paused) { stopAudio(); return; }
  const generation = state.generation;
  if (!(await prepareDeck()) || generation !== state.generation) return;
  const song = target();
  if (!song) return;
  const token = ++playGeneration;
  try {
    if (audio.getAttribute('src') !== song.preview) audio.src = song.preview;
    audio.currentTime = 0;
    const playPromise = audio.play();
    // Some browsers keep play() pending while a remote media request stalls.
    let timer;
    try { await Promise.race([playPromise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Audio timed out')), 12000); })]); }
    finally { clearTimeout(timer); }
    if (generation !== state.generation || token !== playGeneration) return;
    state.listened = true;
    $('#audio-player').classList.add('is-playing');
    $('#play-button').setAttribute('aria-label', 'Pause song clip');
    $('#play-caption').textContent = state.revealed ? 'One more listen. This one’s a keeper.' : 'Listen close. You know more than you think.';
    const tick = () => {
      if (token !== playGeneration) return;
      const limit = state.revealed ? 16 : CLIP_LENGTHS[state.attempt];
      const position = audio.currentTime;
      $('#audio-time').innerHTML = `0:${String(Math.min(Math.floor(position), limit)).padStart(2, '0')} <span>/ 0:${String(limit).padStart(2, '0')}</span>`;
      $$('.wave-bar').forEach((bar, i, bars) => { bar.classList.toggle('played', i / bars.length < position / 16); });
      if (position >= limit || audio.ended) { stopAudio(); $('#play-caption').textContent = 'Got it? Make your guess. Or listen again.'; return; }
      playFrame = requestAnimationFrame(tick);
    };
    tick();
  } catch (error) {
    if (generation === state.generation && token === playGeneration && error.name !== 'AbortError') playbackError();
  }
}
audio.addEventListener('error', () => { if (audio.getAttribute('src') && !state.revealed) playbackError(); });
audio.addEventListener('ended', () => stopAudio());
$('#play-button').addEventListener('click', playClip);
$('#mute-button').addEventListener('click', () => {
  audio.muted = !audio.muted;
  $('#mute-button').setAttribute('aria-pressed', String(audio.muted));
  $('#mute-button').setAttribute('aria-label', audio.muted ? 'Unmute audio' : 'Mute audio');
  toast(audio.muted ? 'Audio muted' : 'Audio unmuted');
});

function closeSuggestions() { clearTimeout(searchTimer); state.searchGeneration++; $('#suggestions').hidden = true; $('#guess-input').setAttribute('aria-expanded', 'false'); $('#guess-input').removeAttribute('aria-activedescendant'); searchIndex = -1; }
function showSuggestions(songs, message = '') {
  state.suggestions = songs;
  searchIndex = -1;
  const list = $('#suggestions');
  list.innerHTML = message ? `<div class="suggestion-message">${escape(message)}</div>` : songs.map((song, i) => `<button type="button" class="suggestion" role="option" id="suggestion-${i}" data-index="${i}" aria-selected="false"><span class="suggestion-art">${icon('music')}</span><span><strong>${escape(song.title)}</strong><small>${escape(song.artist)}</small></span></button>`).join('');
  list.hidden = false; $('#guess-input').setAttribute('aria-expanded', 'true');
}
async function searchSuggestions() {
  const query = $('#guess-input').value.trim();
  if (query.length < 2) { closeSuggestions(); return; }
  const generation = state.generation;
  const searchGeneration = ++state.searchGeneration;
  const valid = () => generation === state.generation && searchGeneration === state.searchGeneration && $('#guess-input').value.trim() === query && !state.revealed;
  if (state.mode === 'demo' || state.mode === 'local') {
    const pool = state.mode === 'demo' ? DEMO_SONGS : state.localTracks;
    const songs = pool.filter(song => normalize(song.title + song.artist).includes(normalize(query))).slice(0, 8);
    showSuggestions(songs, songs.length ? '' : 'No matching title. You can still submit a typed guess.');
    return;
  }
  showSuggestions([], 'Searching the music catalog…');
  try {
    const songs = await catalogSearch(query);
    if (valid()) showSuggestions(songs.slice(0, 7), songs.length ? '' : 'No matches. Try a different title, or submit your typed guess.');
  } catch {
    if (valid()) showSuggestions([], 'Search is unavailable. You can still type the song title and press Guess.');
  }
}
$('#guess-input').addEventListener('input', () => {
  state.selected = null; updateControls(); closeSuggestions();
  searchTimer = setTimeout(searchSuggestions, 320);
});
$('#guess-input').addEventListener('focus', () => { if ($('#guess-input').value.length >= 2 && !state.selected) searchSuggestions(); });
$('#suggestions').addEventListener('click', event => {
  const option = event.target.closest('[data-index]');
  if (!option) return;
  state.selected = state.suggestions[Number(option.dataset.index)];
  $('#guess-input').value = `${state.selected.title} — ${state.selected.artist}`;
  closeSuggestions(); updateControls(); $('#guess-button').focus();
});
$('#guess-input').addEventListener('keydown', event => {
  const options = $$('#suggestions .suggestion');
  if (event.key === 'Escape') closeSuggestions();
  if (!options.length || $('#suggestions').hidden) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    searchIndex = (searchIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === searchIndex)));
    $('#guess-input').setAttribute('aria-activedescendant', options[searchIndex].id);
    options[searchIndex].scrollIntoView({ block: 'nearest' });
  }
  if (event.key === 'Enter' && searchIndex >= 0) { event.preventDefault(); options[searchIndex].click(); }
});
document.addEventListener('click', event => { if (!event.target.closest('.search-wrap')) closeSuggestions(); });
document.addEventListener('keydown', event => {
  if (event.key === '/' && !modal.open && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { event.preventDefault(); $('#guess-input').focus(); }
});

$('#guess-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.loading || state.revealed || !$('#guess-input').value.trim()) return;
  // Load the answer before enabling submission, so a title never gets silently discarded.
  if (!target()) { $('#feedback').textContent = 'Press play to start the round, then make your guess.'; return; }
  if (!state.listened) { $('#feedback').textContent = 'Give the clip a listen first. Your ears deserve a chance!'; return; }
  const guess = state.selected || $('#guess-input').value.trim();
  closeSuggestions(); stopAudio();
  if (isCorrect(guess, target())) reveal(true);
  else {
    const title = typeof guess === 'object' ? guess.title : guess;
    $('#guess-input').value = ''; state.selected = null;
    if (state.attempt === 5) reveal(false);
    else { state.attempt++; updateAttempt(); $('#feedback').textContent = `“${title}” isn’t the one. You’ve unlocked ${CLIP_LENGTHS[state.attempt]} seconds. Give it another listen.`; updateControls(); }
  }
});
$('#skip-button').addEventListener('click', async () => {
  if (state.revealed || state.loading) return;
  if (!target()) { $('#feedback').textContent = 'Press play to start your first song.'; return; }
  stopAudio(); closeSuggestions();
  if (state.attempt === 5) reveal(false);
  else { state.attempt++; updateAttempt(); $('#play-caption').textContent = 'A little more to go on. Press play.'; $('#feedback').textContent = `${CLIP_LENGTHS[state.attempt]} seconds unlocked. The next guess is worth ${currentPoints().toLocaleString()} points.`; updateControls(); }
});
$('#hint-button').addEventListener('click', () => {
  if (!target()) { $('#feedback').textContent = 'Start the song first. Then we’ll give you a little nudge.'; return; }
  if (state.hinted || state.revealed) return;
  state.hinted = true;
  const song = target();
  $('#feedback').textContent = `A little nudge: ${song.genre} · ${song.year}. The title begins with “${song.title[0]}” and has ${song.title.trim().split(/\s+/).length} word(s).`;
  $('#available-points').textContent = currentPoints().toLocaleString(); updateControls();
});

function reveal(correct) {
  stopAudio(); closeSuggestions(); state.revealed = true;
  const song = target();
  const points = correct ? currentPoints() : 0;
  state.score += points; state.streak = correct ? state.streak + 1 : 0; state.maxStreak = Math.max(state.streak, state.maxStreak);
  state.results.push({ title: song.title, artist: song.artist, correct, points, seconds: CLIP_LENGTHS[state.attempt] });
  $('#result').hidden = false; $('#result').classList.toggle('lost', !correct);
  $('#result').innerHTML = `<div class="result-art">${icon(correct ? 'check' : 'music')}</div><div><small>${correct ? 'THAT’S THE ONE!' : 'ONE FOR YOUR PLAYLIST'}</small><h3>${escape(song.title)}</h3><p>${escape(song.artist)} · ${escape(song.year)}</p></div><span class="result-points">${correct ? `+${points.toLocaleString()}` : '✳'}</span>`;
  $('#guess-form').hidden = true; $('#feedback').textContent = '';
  $('#next-button').hidden = false;
  $('#next-button').innerHTML = `${state.round === state.deck.length - 1 ? 'See my results' : 'Next song'} ${icon('arrow')}`;
  $('#game-title').textContent = correct ? 'Look at those listening skills.' : 'Good music. Even when it gets you.';
  $('#game-subtitle').textContent = correct ? `You got it in ${CLIP_LENGTHS[state.attempt]} ${CLIP_LENGTHS[state.attempt] === 1 ? 'second' : 'seconds'}. Nicely done.` : 'Save that one to your memory. There’s always another song.';
  $('#play-caption').textContent = 'Play the longer clip. You’ve earned it.';
  $('#audio-time').innerHTML = '0:00 <span>/ 0:16</span>';
  renderSession(); updateControls(); $('#next-button').focus({ preventScroll: true });
}
$('#next-button').addEventListener('click', () => {
  if (state.round + 1 >= state.deck.length) { finishSession(); return; }
  state.round++; renderRound(); $('#play-button').focus({ preventScroll: true });
});
function finishSession() {
  stopAudio();
  if (!state.finished) {
    state.finished = true;
    stats.games++; stats.rounds += state.results.length; stats.correct += state.results.filter(result => result.correct).length;
    stats.bestScore = Math.max(stats.bestScore, state.score); stats.bestStreak = Math.max(stats.bestStreak, state.maxStreak); saveStats();
  }
  renderSession();
  const correct = state.results.filter(result => result.correct).length;
  openModal(`<div class="session-summary"><div class="summary-icon">${correct === state.results.length ? '✳' : '♫'}</div><h2 id="modal-title">${correct === state.results.length ? 'You’re on our wavelength.' : correct >= 3 ? 'Now that’s a good ear.' : 'The music keeps going.'}</h2><p>${escape(state.label)} · ${state.results.length} songs<br>Every great listener starts with another listen.</p><div class="summary-numbers"><div><strong>${state.score.toLocaleString()}</strong><span>Total points</span></div><div><strong>${correct}/${state.results.length}</strong><span>Songs guessed</span></div><div><strong>${state.maxStreak}</strong><span>Best streak</span></div></div><div class="summary-actions"><button class="outline-button" data-action="share">Copy results</button><button class="primary-button" data-action="again">One more mix ${icon('arrow')}</button></div></div>`);
  $('#next-button').innerHTML = `View session results ${icon('arrow')}`;
}

function requestRestart(mode, label, artist = '', tracks = null) {
  if (!state.finished && (state.results.length || state.listened || state.attempt > 0)) {
    pendingRestart = { mode, label, artist, tracks };
    openModal(`<h2 id="modal-title">A fresh set of songs?</h2><p>Your current session will end. Completed sessions stay in your stats.</p><div class="confirm-actions"><button class="outline-button" data-action="cancel-restart">Keep playing</button><button class="primary-button" data-action="confirm-restart">Start new mix ${icon('arrow')}</button></div>`);
    return;
  }
  restart(mode, label, artist, tracks);
}
function restart(mode, label, artist = '', tracks = null) {
  stopAudio(); state.generation++; loadingDeck = null;
  if (tracks) {
    state.localTracks.forEach(track => { if (!tracks.some(item => item.id === track.id)) URL.revokeObjectURL(track.preview); });
    state.localTracks = tracks;
  }
  Object.assign(state, { mode, label, artist, deck: [], round: 0, attempt: 0, hinted: false, revealed: false, listened: false, results: [], score: 0, streak: 0, maxStreak: 0, loading: false, selected: null, finished: false });
  closeModal(); renderRound();
  if (mode === 'demo' || mode === 'local') {
    state.deck = shuffle(mode === 'demo' ? DEMO_SONGS : state.localTracks).slice(0, 5); renderSession();
    if (mode === 'demo') $('#feedback').innerHTML = 'Demo mix: five original tunes, made for Offbeat. <button type="button" data-action="demo-guide">Meet the tracks</button> before you listen.';
  }
  toast(`${label} is ready. Let’s hear it.`);
  $('#game').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showMixes() {
  openModal(`<h2 id="modal-title">Find your frequency.</h2><p>All the music you love. A few seconds to prove it.</p><button class="mode-option" data-action="everything"><span class="mix-card-icon peach">${icon('shuffle')}</span><span><strong>The everything mix</strong><small>Big artists and familiar favorites. Always shuffled.</small></span>${icon('arrow')}</button><button class="mode-option" data-action="artist"><span class="mix-card-icon lilac">${icon('music')}</span><span><strong>Your favorite artist</strong><small>Build a challenge around any artist in the catalog.</small></span>${icon('arrow')}</button><button class="mode-option" data-action="upload"><span class="mix-card-icon sage">${icon('upload')}</span><span><strong>Bring your own tracks</strong><small>Pick audio files. Play any song in your library.</small></span>${icon('arrow')}</button><button class="mode-option" data-action="demo"><span class="mix-card-icon peach">${icon('headphones')}</span><span><strong>The offline demo</strong><small>Five original tunes. No connection needed.</small></span>${icon('arrow')}</button><div class="modal-note">Catalog games use short Apple iTunes previews. Availability varies by song and region. Your own audio stays on your device.</div>`);
}
function showArtist() {
  openModal(`<h2 id="modal-title">How well do you know them?</h2><p>The hits. The deep cuts. The song you know by heart.<br>Choose an artist and we’ll make your mix.</p><form id="artist-form"><label class="field-label" for="artist-input">Artist name</label><div class="artist-form"><input id="artist-input" class="modal-input" placeholder="e.g. Taylor Swift" required maxlength="100"><button class="primary-button" type="submit">Find songs ${icon('arrow')}</button></div></form><div class="artist-chips"><button data-artist="Taylor Swift">Taylor Swift</button><button data-artist="The Weeknd">The Weeknd</button><button data-artist="Queen">Queen</button><button data-artist="BTS">BTS</button><button data-artist="Bad Bunny">Bad Bunny</button></div><div id="modal-status" class="modal-status" role="status"></div><div class="modal-note">We search the US iTunes catalog for songs with playable previews. No account or subscription needed.</div>`);
  $('#artist-input').focus();
}
async function findArtist(artist) {
  if (!artist.trim()) return;
  const form = $('#artist-form');
  if (!form) return;
  const request = ++artistSearchGeneration;
  const valid = () => form.isConnected && modal.open && request === artistSearchGeneration;
  const button = form.querySelector('button'); button.disabled = true;
  statusText('Finding songs for your mix…');
  try {
    const songs = await catalogSearch(artist.trim());
    if (!valid()) return;
    if (!songs.length) { statusText('No playable songs found. Try another artist or spelling.'); return; }
    const exact = songs.find(song => normalize(song.artist) === normalize(artist));
    const name = exact?.artist || songs[0].artist;
    statusText(`${songs.length} playable songs found.`);
    requestRestart('artist', `${name} mix`, name);
  } catch {
    if (valid()) statusText('We couldn’t reach the music catalog. Try again when you’re online, or choose your own tracks / the offline demo.');
  } finally { if (button.isConnected) button.disabled = false; }
}
function showUpload() {
  uploading = [...state.localTracks]; uploadErrors = [];
  openModal(`<h2 id="modal-title">Your library. Your rules.</h2><p>Turn your own songs into a guessing game. Let a friend pick the tracks for an extra challenge.</p><label class="upload-drop" id="upload-drop">${icon('upload')}<strong>Drop your songs here, or browse</strong><small>MP3, M4A, WAV, OGG · up to 50 tracks</small><input type="file" id="file-input" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.webm" multiple class="sr-only"></label><div class="file-list" id="file-list"></div><div class="modal-note">Name files <b>Artist - Song title.mp3</b> for the best guesses and hints. Files are played locally and never uploaded. Each session picks up to five tracks.</div><div id="modal-status" class="modal-status" role="status"></div><button class="primary-button modal-full-button" id="start-local" data-action="start-local">Start my mix ${icon('arrow')}</button>`);
  renderFiles();
  $('#file-input').addEventListener('change', event => addFiles([...event.target.files]));
  const drop = $('#upload-drop');
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.style.borderColor = 'var(--orange)'; });
  drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
  drop.addEventListener('drop', event => { event.preventDefault(); drop.style.borderColor = ''; addFiles([...event.dataTransfer.files]); });
}
function addFiles(files) {
  uploadErrors = [];
  for (const file of files) {
    if (uploading.length >= 50) { uploadErrors.push('50-track limit reached.'); break; }
    if ((!file.type.startsWith('audio/') && !/\.(mp3|m4a|wav|ogg|flac|aac|webm)$/i.test(file.name)) || file.size === 0) { uploadErrors.push(`“${file.name}” isn’t a supported audio file.`); continue; }
    const id = `local-${file.name}-${file.size}-${file.lastModified}`;
    if (!uploading.some(track => track.id === id)) uploading.push(trackFromFile(file, URL.createObjectURL(file)));
  }
  renderFiles();
}
function renderFiles() {
  $('#file-list').innerHTML = uploading.map((track, i) => `<div class="file-row"><span>${escape(track.artist)} — <b>${escape(track.title)}</b></span><button data-remove="${i}" aria-label="Remove ${escape(track.title)}">×</button></div>`).join('');
  $('#start-local').disabled = !uploading.length;
  statusText(uploadErrors.length ? uploadErrors.join(' ') : uploading.length ? `${uploading.length} ${uploading.length === 1 ? 'track' : 'tracks'} ready. Your session will have ${Math.min(5, uploading.length)} ${uploading.length === 1 ? 'round' : 'rounds'}.` : 'Choose at least one audio file to begin.');
}
function showDemoGuide() {
  openModal(`<h2 id="modal-title">Meet the demo mix.</h2><p>Five original instrumental loops, made just for Offbeat. Listen to a sample to learn their sound, then put your memory to the test.</p><div class="demo-tracks">${DEMO_SONGS.map((song, i) => `<div><span>${escape(song.title)} <small>· ${escape(song.genre)}</small></span><button class="outline-button" style="margin-left:auto;height:30px;font-size:9px" data-listen-demo="${i}" aria-label="Preview ${escape(song.title)}">Listen</button></div>`).join('')}</div><div class="modal-note">These are original demo melodies, not recordings of commercial songs. Choose a catalog mix or your own files to guess real releases.</div><button class="primary-button modal-full-button" data-action="close">I’m ready ${icon('arrow')}</button>`);
}
let demoAudio;
modal.addEventListener('close', () => {
  demoAudio?.pause(); clearTimeout(demoTimer); artistSearchGeneration++; pendingRestart = null;
  uploading.forEach(track => { if (!state.localTracks.some(item => item.id === track.id)) URL.revokeObjectURL(track.preview); });
  uploading = [];
});
function showHow() {
  openModal(`<h2 id="modal-title">A little sound. A big clue.</h2><p>No lyrics on the screen. No album cover to give it away.<br>Just you, your ears, and that “I know this” feeling.</p><div class="how-step"><span class="step-number">01</span><div><strong>Press play. Listen close.</strong><p>You start with a one-second clip. Replay it as often as you like.</p></div></div><div class="how-step"><span class="step-number">02</span><div><strong>Name that song.</strong><p>Type the title, or search and pick a match. Get it in one second for 1,000 points.</p></div></div><div class="how-step"><span class="step-number">03</span><div><strong>Need another beat?</strong><p>Skip or guess wrong to unlock 2, 4, 7, 11, then 16 seconds. Longer clips mean fewer points. A hint costs 150 points, with a 50-point minimum.</p></div></div><div class="modal-note">Five songs per session, six chances per song. Your stats are saved in this browser after a full session. Press <b>/</b> to jump to the search box.</div><button class="primary-button modal-full-button" data-action="close">Let’s play ${icon('arrow')}</button>`);
}
function showStats() {
  openModal(`<h2 id="modal-title">Your listening history.</h2><p>A little proof that you know your music.<br>Stats from completed sessions on this browser.</p><div class="stats-grid"><div class="stat-box"><strong>${stats.games}</strong><span>Sessions played</span></div><div class="stat-box"><strong>${stats.rounds ? Math.round(stats.correct / stats.rounds * 100) : 0}%</strong><span>Songs guessed correctly</span></div><div class="stat-box"><strong>${stats.bestScore.toLocaleString()}</strong><span>Personal best score</span></div><div class="stat-box"><strong>${stats.bestStreak}</strong><span>Best song streak</span></div></div><div class="modal-note">${stats.games ? `${stats.correct} of ${stats.rounds} songs guessed. Keep the good music going.` : 'Your first session is waiting. Finish a mix and your numbers will appear here.'}</div><button class="primary-button modal-full-button" data-action="close">Back to the music ${icon('arrow')}</button>`);
}

$('#close-modal').addEventListener('click', closeModal);
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal(); } });
$('#change-mix').addEventListener('click', showMixes);
$('#how-button').addEventListener('click', showHow);
$('#stats-button').addEventListener('click', showStats);
$('#demo-button').addEventListener('click', () => requestRestart('demo', 'The offline demo'));
$$('[data-preset]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.preset === 'everything') requestRestart('everything', 'The everything mix');
  else if (button.dataset.preset === 'artist') showArtist(); else showUpload();
}));
document.addEventListener('submit', event => { if (event.target.id === 'artist-form') { event.preventDefault(); findArtist($('#artist-input').value); } });
document.addEventListener('click', async event => {
  const artist = event.target.closest('[data-artist]');
  if (artist) { $('#artist-input').value = artist.dataset.artist; findArtist(artist.dataset.artist); }
  const remove = event.target.closest('[data-remove]');
  if (remove) { const [track] = uploading.splice(Number(remove.dataset.remove), 1); if (!state.localTracks.some(item => item.id === track.id)) URL.revokeObjectURL(track.preview); renderFiles(); }
  const preview = event.target.closest('[data-listen-demo]');
  if (preview) {
    demoAudio?.pause(); clearTimeout(demoTimer); demoAudio = new Audio(DEMO_SONGS[Number(preview.dataset.listenDemo)].preview);
    try { await demoAudio.play(); demoTimer = setTimeout(() => demoAudio?.pause(), 4000); } catch { toast('That demo clip couldn’t play. Try another browser.'); }
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'close') closeModal();
  if (action === 'mix') showMixes();
  if (action === 'artist') showArtist();
  if (action === 'upload') showUpload();
  if (action === 'demo-guide') showDemoGuide();
  if (action === 'demo') requestRestart('demo', 'The offline demo');
  if (action === 'everything') requestRestart('everything', 'The everything mix');
  if (action === 'start-local' && uploading.length) {
    requestRestart('local', 'Your own tracks', '', [...uploading]);
  }
  if (action === 'cancel-restart') { pendingRestart = null; closeModal(); }
  if (action === 'confirm-restart' && pendingRestart) { const config = pendingRestart; pendingRestart = null; restart(config.mode, config.label, config.artist, config.tracks); }
  if (action === 'again') restart(state.mode, state.label, state.artist);
  if (action === 'share') {
    const text = `Offbeat · ${state.label}\n${state.results.map(result => result.correct ? '🟩' : '⬜').join('')}\n${state.score.toLocaleString()} points · ${state.results.filter(result => result.correct).length}/${state.results.length} songs\nHow soon do you know the song?`;
    try { await navigator.clipboard.writeText(text); toast('Results copied. Bragging rights are yours.'); } catch { toast('Copy isn’t available in this browser. Your score: ' + state.score.toLocaleString() + ' points.'); }
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopAudio(); demoAudio?.pause(); } });
window.addEventListener('resize', renderWave);
renderRound();
