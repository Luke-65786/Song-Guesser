import { MAX_CLIP_LENGTH, formatTime, DEMO_SONGS, normalize, isCorrect, shuffle, catalogSongs, trackFromFile } from './game.js';
import { catalogRequest, catalogSearch, catalogLookup } from './catalog.js';
import { ERAS, GENRES, emptyFilters, filterLabel, filterSongs, discoveryTerms } from './filters.js';
import { createSongPreviews } from './song-previews.js';
import { MAX_PLAYLIST_ARTISTS, cleanArtists, readArtistLibrary, saveArtistLibrary, roundSetting, chooseRounds, buildArtistDeck } from './artist-library.js';
import { findMixSuggestions, scopedSongs, searchText, searchScopeLabel } from './suggestions.js';
import { DIFFICULTIES, difficultyRules, difficultyPoints } from './difficulty.js';
import { loadTrendingChart } from './trending.js';

const $ = selector => document.querySelector(selector);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const audio = $('#audio');
const modal = $('#modal');
const songPreviews = createSongPreviews($('#artist-preview-audio'), () => { stopAudio(); demoAudio?.pause(); clearTimeout(demoTimer); $('#artist-preview-audio').muted = audio.muted; });
const state = { mode: 'everything', label: 'The everything mix', artist: '', difficulty: 'regular', chartSongs: [], filters: emptyFilters(), roundSetting: 5, requestedRounds: 5, playlist: [], searchPool: [], deck: [], round: 0, attempt: 0, hinted: false, revealed: false, listened: false, results: [], score: 0, streak: 0, maxStreak: 0, loading: false, selected: null, suggestions: [], localTracks: [], generation: 0, finished: false, searchGeneration: 0 };
let libraryStorage;
try { libraryStorage = localStorage; } catch { /* In-memory library when storage is unavailable. */ }
let artistLibrary = readArtistLibrary(libraryStorage);
const knownArtists = new Map([...artistLibrary.liked, ...artistLibrary.playlist].map(artist => [artist.id, artist]));
let filterDraft = emptyFilters();
let playFrame;
let clipTimer;
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
let pickerGeneration = 0;
let pickerResults = [];
let pickerTimer;

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
function roundCount() { return state.deck.length || Math.min(state.requestedRounds, state.mode === 'local' ? state.localTracks.length : state.mode === 'demo' ? DEMO_SONGS.length : state.requestedRounds); }
function selectedRounds() {
  const value = $('#rounds-select').value;
  const input = $('#custom-round-count');
  if (value === 'custom' && !input.checkValidity()) { if (modal.open) closeModal(); input.reportValidity(); input.focus(); return null; }
  return roundSetting(value === 'custom' ? input.valueAsNumber : value);
}
function activeClips() { return difficultyRules(state.difficulty).clips; }
function currentPoints() { return difficultyPoints(state.difficulty, state.attempt, state.hinted); }
function openModal(html) { stopAudio(); songPreviews.stop(); demoAudio?.pause(); clearTimeout(demoTimer); pickerGeneration++; clearTimeout(pickerTimer); $('#modal-body').innerHTML = html; if (!modal.open) modal.showModal(); }
function closeModal() { songPreviews.stop(); modal.close(); }
function statusText(text) { const el = $('#modal-status'); if (el) el.textContent = text; }

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
      let groups;
      if (state.mode === 'demo') songs = DEMO_SONGS;
      else if (state.mode === 'local') songs = state.localTracks;
      else if (state.mode === 'trending') songs = state.chartSongs.filter(song => song.preview);
      else if (state.mode === 'playlist') {
        groups = [];
        for (let start = 0; start < state.playlist.length; start += 3) {
          const batch = state.playlist.slice(start, start + 3);
          const results = await Promise.allSettled(batch.map(async artist => filterSongs(catalogSongs(await catalogLookup(artist.id)).filter(song => song.artistId === artist.id), state.filters)));
          if (generation !== state.generation) return false;
          const failed = batch.filter((_, index) => results[index].status === 'rejected');
          if (failed.length) throw new Error(`Couldn’t load ${failed.map(artist => artist.name).join(', ')}. Try again or remove them from the playlist.`);
          const empty = batch.filter((_, index) => !results[index].value.length);
          if (empty.length) throw new Error(`No playable songs match ${empty.map(artist => artist.name).join(', ')} and these filters. Broaden the era/genre or remove them, then shuffle the playlist again.`);
          groups.push(...results.map(result => result.value));
        }
        songs = groups.flat();
      }
      else if (state.mode === 'filtered') {
        const filters = state.filters;
        if (filters.album) songs = catalogSongs(await catalogLookup(filters.album.id));
        else if (filters.artist) songs = catalogSongs(await catalogLookup(filters.artist.id));
        else {
          const results = await Promise.allSettled(discoveryTerms(filters).map(catalogSearch));
          if (results.every(result => result.status === 'rejected')) throw new Error('The music catalog could not be reached.');
          songs = [...new Map(results.flatMap(result => result.status === 'fulfilled' ? result.value : []).map(song => [song.id, song])).values()];
        }
        songs = filterSongs(songs, filters);
        if (!songs.length) throw new Error('No playable songs match all these filters. Try a broader era or genre, or clear the album.');
      }
      else if (state.mode === 'artist') {
        songs = scopedSongs(await catalogSearch(state.artist), { mode: 'artist', artist: state.artist });
      } else {
        const artists = shuffle(['Dua Lipa', 'The Weeknd', 'Queen', 'Adele', 'Daft Punk', 'Taylor Swift', 'Coldplay', 'Billie Eilish', 'Bruno Mars', 'Rihanna', 'ABBA', 'Harry Styles']).slice(0, 3);
        const searches = await Promise.allSettled(artists.map(catalogSearch));
        songs = searches.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      }
      if (generation !== state.generation) return false;
      if (!songs?.length) throw new Error('No playable previews found for this mix.');
      state.searchPool = songs;
      state.deck = buildArtistDeck(groups || [songs], state.requestedRounds);
      renderRound();
      if (state.deck.length < state.requestedRounds) $('#feedback').textContent = `This mix has ${state.deck.length} unique playable songs, so your session has ${state.deck.length} rounds.`;
      return true;
    } catch (error) {
      if (generation !== state.generation) return false;
      const noMatches = ['filtered', 'playlist'].includes(state.mode) && error.message.startsWith('No playable songs match');
      $('#feedback').innerHTML = noMatches
        ? `${escape(error.message)} <button type="button" data-action="edit-filters">Edit your filters</button> or <button type="button" data-action="demo">try the offline demo</button>.`
        : `${escape(error.message)} Try another artist, <button type="button" data-action="upload">add your own songs</button>, or <button type="button" data-action="demo">play the offline demo</button>.`;
      $('#play-caption').textContent = noMatches ? 'No songs in this combination. Try broader filters.' : 'Catalog unavailable. Try the offline demo below.';
      return false;
    } finally {
      if (generation === state.generation) { state.loading = false; updateControls(); }
      if (loadingDeck === task) loadingDeck = null;
    }
  })();
  loadingDeck = task;
  return task;
}

function renderPlayback(position = 0, limit = state.revealed ? MAX_CLIP_LENGTH : activeClips()[state.attempt]) {
  const elapsed = Math.min(limit, Math.max(0, position));
  $('#playback-progress').style.width = `${elapsed / limit * 100}%`;
  $('#playback-line').setAttribute('aria-valuemax', String(limit));
  $('#playback-line').setAttribute('aria-valuenow', String(Math.round(elapsed * 100) / 100));
  $('#playback-line').setAttribute('aria-valuetext', `${Math.round(elapsed * 10) / 10} of ${limit} seconds played`);
  $('#audio-time').innerHTML = `${formatTime(elapsed)} <span>/ ${formatTime(limit)}</span>`;
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
  $('#hint-button').disabled = state.loading || state.revealed || state.hinted || !difficultyRules(state.difficulty).hints;
  $('#hint-button').title = difficultyRules(state.difficulty).hints ? 'A hint costs 150 points' : 'Hints are off on Hard difficulty';
  $('#hint-button span').textContent = difficultyRules(state.difficulty).hints ? '−150 pts' : 'No hints on Hard';
}
function renderRound() {
  stopAudio();
  state.attempt = 0; state.hinted = false; state.revealed = false; state.selected = null; state.listened = false;
  audio.removeAttribute('src'); audio.load();
  $('#guess-input').value = ''; $('#feedback').textContent = '';
  $('#result').hidden = true; $('#result').className = 'result';
  $('#guess-form').hidden = false; $('#next-button').hidden = true;
  $('#game-title').textContent = "What's the track?";
  $('.hero-copy > p').textContent = `Put your ears to the test. Start with just ${activeClips()[0]} ${activeClips()[0] === 1 ? 'second' : 'seconds'}.`;
  $('#game-subtitle').textContent = state.mode === 'demo' ? 'An original demo tune. Listen, then take your best guess.' : state.mode === 'local' ? 'Your library. A tiny snippet. Put your ears to the test.' : 'A familiar tune. A tiny snippet. You’ve got this.';
  $('#mix-label').textContent = state.label;
  $('#difficulty-badge').hidden = state.mode !== 'everything';
  $('#difficulty-badge').textContent = `${difficultyRules(state.difficulty).label} · ${activeClips().length} chances`;
  $('#search-scope').textContent = searchScopeLabel(state);
  $('#play-caption').textContent = 'Press play. Find your first clue.';
  closeSuggestions(); updateAttempt(); renderSession(); updateControls();
}
function updateAttempt() {
  const clips = activeClips();
  $('#clip-steps').style.gridTemplateColumns = `repeat(${clips.length}, 1fr)`;
  $('#available-points').textContent = currentPoints().toLocaleString();
  $('#attempt-label').textContent = `GUESS ${state.attempt + 1} OF ${clips.length}`;
  const nextLength = clips[state.attempt + 1];
  const increment = nextLength == null ? 0 : Number((nextLength - clips[state.attempt]).toFixed(1));
  $('#skip-button span').textContent = state.attempt === clips.length - 1 ? '(reveal song)' : `(+${increment} ${increment === 1 ? 'second' : 'seconds'})`;
  $('#clip-steps').innerHTML = clips.map((seconds, i) => `<div role="listitem" class="clip-step${i === state.attempt ? ' active' : i < state.attempt ? ' completed' : ''}"${i === state.attempt ? ' aria-current="step"' : ''}><span>${seconds}s</span></div>`).join('');
  renderPlayback();
}
function $$(selector) { return [...document.querySelectorAll(selector)]; }
function stopAudio() {
  playGeneration++; cancelAnimationFrame(playFrame); clearTimeout(clipTimer); audio.pause();
  $('#audio-player').classList.remove('is-playing');
  $('#play-button').setAttribute('aria-label', 'Play song clip');
}
function playbackError() {
  stopAudio();
  $('#play-caption').textContent = 'That clip couldn’t play. Try again or change your mix.';
  $('#feedback').innerHTML = 'The audio may be unavailable in your region or blocked by your connection. <button type="button" data-action="mix">Choose another mix</button> or <button type="button" data-action="demo">try the offline demo</button>.';
}
async function playClip() {
  songPreviews.stop();
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
    const limit = state.revealed ? MAX_CLIP_LENGTH : activeClips()[state.attempt];
    const finishClip = () => {
      renderPlayback(audio.currentTime, limit); stopAudio();
      $('#play-caption').textContent = 'Got it? Make your guess. Or listen again.';
    };
    // A separate media-clock check keeps 0.1s/0.5s cutoffs independent of frame rate.
    const checkCutoff = () => {
      if (token !== playGeneration) return;
      const remaining = limit - audio.currentTime;
      if (remaining <= 0 || audio.ended) { finishClip(); return; }
      clipTimer = setTimeout(checkCutoff, Math.max(1, remaining * 1000));
    };
    checkCutoff();
    const tick = () => {
      if (token !== playGeneration) return;
      const position = audio.currentTime;
      renderPlayback(position, limit);
      if (position >= limit || audio.ended) { finishClip(); return; }
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
  const scope = { mode: state.mode, artist: state.artist, filters: { ...state.filters }, playlist: [...state.playlist] };
  const pool = state.mode === 'demo' ? DEMO_SONGS : state.mode === 'local' ? state.localTracks : state.mode === 'trending' ? state.chartSongs.filter(song => song.preview) : state.searchPool;
  showSuggestions([], 'Finding matching songs…');
  try {
    const songs = await findMixSuggestions(query, scope, pool);
    if (valid()) showSuggestions(songs.slice(0, 7), songs.length ? '' : 'No matching songs in this mix. Try another title or artist, or submit your typed guess.');
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
    if (state.attempt === activeClips().length - 1) reveal(false);
    else { state.attempt++; updateAttempt(); $('#feedback').textContent = `“${title}” isn’t the one. You’ve unlocked ${activeClips()[state.attempt]} seconds. Give it another listen.`; updateControls(); }
  }
});
$('#skip-button').addEventListener('click', async () => {
  if (state.revealed || state.loading) return;
  if (!target()) { $('#feedback').textContent = 'Press play to start your first song.'; return; }
  stopAudio(); closeSuggestions();
  if (state.attempt === activeClips().length - 1) reveal(false);
  else { state.attempt++; updateAttempt(); $('#play-caption').textContent = 'A little more to go on. Press play.'; $('#feedback').textContent = `${activeClips()[state.attempt]} seconds unlocked. The next guess is worth ${currentPoints().toLocaleString()} points.`; updateControls(); }
});
$('#hint-button').addEventListener('click', () => {
  if (!target()) { $('#feedback').textContent = 'Start the song first. Then we’ll give you a little nudge.'; return; }
  if (state.hinted || state.revealed || !difficultyRules(state.difficulty).hints) return;
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
  state.results.push({ title: song.title, artist: song.artist, correct, points, seconds: activeClips()[state.attempt] });
  $('#result').hidden = false; $('#result').classList.toggle('lost', !correct);
  $('#result').innerHTML = `<div class="result-art">${icon(correct ? 'check' : 'music')}</div><div><small>${correct ? 'THAT’S THE ONE!' : 'ONE FOR YOUR PLAYLIST'}</small><h3>${escape(song.title)}</h3><p>${escape(song.artist)} · ${escape(song.year)}</p></div><span class="result-points">${correct ? `+${points.toLocaleString()}` : '✳'}</span>`;
  $('#guess-form').hidden = true; $('#feedback').textContent = '';
  $('#next-button').hidden = false;
  $('#next-button').innerHTML = `${state.round === state.deck.length - 1 ? 'See my results' : 'Next song'} ${icon('arrow')}`;
  $('#game-title').textContent = correct ? 'Look at those listening skills.' : 'Good music. Even when it gets you.';
  $('#game-subtitle').textContent = correct ? `You got it in ${activeClips()[state.attempt]} ${activeClips()[state.attempt] === 1 ? 'second' : 'seconds'}. Nicely done.` : 'Save that one to your memory. There’s always another song.';
  $('#play-caption').textContent = 'Play the longer clip. You’ve earned it.';
  renderPlayback();
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

function requestRestart(mode, label, artist = '', tracks = null, filters = null, rounds = selectedRounds(), artists = [], difficulty = $('#regular-difficulty').value, chartSongs = []) {
  if (rounds === null) return;
  if (!state.finished && (state.results.length || state.listened || state.attempt > 0)) {
    pendingRestart = { mode, label, artist, tracks, filters, rounds, artists, difficulty, chartSongs };
    openModal(`<h2 id="modal-title">A fresh set of songs?</h2><p>Your current session will end. Completed sessions stay in your stats.</p><div class="confirm-actions"><button class="outline-button" data-action="cancel-restart">Keep playing</button><button class="primary-button" data-action="confirm-restart">Start new mix ${icon('arrow')}</button></div>`);
    return;
  }
  restart(mode, label, artist, tracks, filters, rounds, artists, difficulty, chartSongs);
}
function restart(mode, label, artist = '', tracks = null, filters = null, rounds = 5, artists = [], difficulty = 'regular', chartSongs = []) {
  stopAudio(); state.generation++; loadingDeck = null;
  if (tracks) {
    state.localTracks.forEach(track => { if (!tracks.some(item => item.id === track.id)) URL.revokeObjectURL(track.preview); });
    state.localTracks = tracks;
  }
  Object.assign(state, { mode, label, artist, difficulty: mode === 'everything' && DIFFICULTIES[difficulty] ? difficulty : 'regular', chartSongs: [...chartSongs], filters: filters || emptyFilters(), roundSetting: rounds, requestedRounds: chooseRounds(rounds), playlist: cleanArtists(artists), searchPool: [], deck: [], round: 0, attempt: 0, hinted: false, revealed: false, listened: false, results: [], score: 0, streak: 0, maxStreak: 0, loading: false, selected: null, finished: false });
  if (mode === 'everything') { $('#regular-difficulty').value = state.difficulty; renderDifficultyDescription(); }
  syncRoundControls(rounds);
  filterDraft = { ...state.filters };
  renderFilters(mode === 'filtered' ? 'Mix applied. Press play to discover your songs.' : 'Pick a decade, a genre, or a favorite. Mix them together.');
  closeModal(); renderRound();
  if (mode === 'demo' || mode === 'local') {
    state.searchPool = mode === 'demo' ? DEMO_SONGS : state.localTracks;
    state.deck = buildArtistDeck([state.searchPool], state.requestedRounds); renderSession();
    if (mode === 'demo') $('#feedback').innerHTML = 'Demo mix: five original tunes, made for Offbeat. <button type="button" data-action="demo-guide">Meet the tracks</button> before you listen.';
    if (state.deck.length < state.requestedRounds) $('#feedback').append(` Your library has ${state.deck.length} unique songs, so this session has ${state.deck.length} rounds.`);
  }
  toast(`${label} is ready. Let’s hear it.`);
  $('#game').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncRoundControls(rounds) {
  const preset = ['5', '10', '15', '20', '50', 'random'].includes(String(rounds));
  $('#rounds-select').value = preset ? String(rounds) : 'custom';
  $('#custom-rounds').hidden = preset;
  $('#custom-round-count').disabled = preset;
  if (!preset) $('#custom-round-count').value = String(rounds);
}
function renderDifficultyDescription() {
  $('#difficulty-description').textContent = difficultyRules($('#regular-difficulty').value).description;
}
$('#regular-difficulty').addEventListener('change', renderDifficultyDescription);
$('#play-regular-mix').addEventListener('click', () => requestRestart('everything', 'The everything mix'));

let trendingChart = null;
let chartGeneration = 0;
const chartCountryName = code => code === 'gb' ? 'United Kingdom' : 'United States';
function chartStamp(chart) { return chart.updated ? `Updated ${new Date(chart.updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Chart update time not supplied'; }
async function refreshTrending() {
  songPreviews.stop();
  const token = ++chartGeneration;
  const country = $('#trending-country').value;
  trendingChart = null; $('#trending-songs').hidden = true; $('#view-trending').hidden = true; $('#play-trending').disabled = true;
  $('#load-trending').disabled = true; $('#trending-country').disabled = true;
  $('#trending-status').textContent = `Loading the ${chartCountryName(country)} iTunes Top Songs chart…`;
  try {
    const chart = await loadTrendingChart(country, true);
    if (token !== chartGeneration) return;
    trendingChart = chart;
    $('#trending-status').textContent = `${chartCountryName(chart.country)} · iTunes Top Songs · ${chartStamp(chart)} · ${chart.songs.length} ranked songs. Preview availability varies by track.`;
    $('#trending-songs').hidden = false;
    songPreviews.render($('#trending-songs'), chart.songs, 'Trending songs', { heading: 'Chart highlights', ranked: true, showArtist: true });
    $('#view-trending').hidden = false;
    $('#play-trending').disabled = !chart.songs.some(song => song.preview);
    $('#load-trending').textContent = 'Refresh chart';
  } catch (error) {
    if (token !== chartGeneration) return;
    $('#trending-status').textContent = `${error.message} No chart is being shown. Use Retry chart to try again.`;
    $('#load-trending').textContent = 'Retry chart';
  } finally {
    if (token === chartGeneration) { $('#load-trending').disabled = false; $('#trending-country').disabled = false; }
  }
}
$('#load-trending').addEventListener('click', refreshTrending);
$('#trending-country').addEventListener('change', refreshTrending);
$('#view-trending').addEventListener('click', () => {
  if (!trendingChart) return;
  openModal(`<h2 id="modal-title">Trending in the ${trendingChart.country === 'gb' ? 'UK' : 'US'}.</h2><p>Apple iTunes Top Songs · ${escape(chartStamp(trendingChart))}. Tap a track to preview it.</p><div id="full-trending-chart" class="trending-chart full-trending-chart"></div><button type="button" class="primary-button modal-full-button" data-action="close">Back to the game ${icon('arrow')}</button>`);
  songPreviews.render($('#full-trending-chart'), trendingChart.songs, 'Trending chart', { limit: 25, heading: 'Top songs', ranked: true, showArtist: true });
});
$('#play-trending').addEventListener('click', () => {
  const rounds = selectedRounds();
  if (!trendingChart || rounds === null) return;
  const label = `Trending · ${trendingChart.country.toUpperCase()} iTunes chart`;
  requestRestart('trending', label, '', null, emptyFilters(), rounds, [], 'regular', trendingChart.songs);
});
$('#rounds-select').addEventListener('change', () => {
  const custom = $('#rounds-select').value === 'custom';
  $('#custom-rounds').hidden = !custom; $('#custom-round-count').disabled = !custom;
  renderFilters($('#rounds-select').value === 'random' ? 'Random picks 5–20 rounds when you start a mix. Shorter libraries use the songs available.' : 'Round count changed. Start or apply a mix to use it.');
  if (custom) $('#custom-round-count').focus();
});

function artistActions(artist) {
  const [clean] = cleanArtists([artist]);
  if (!clean) return '';
  artist = clean;
  knownArtists.set(artist.id, artist);
  return `<div class="artist-actions"><button type="button" class="artist-like-button" data-like-artist="${artist.id}" aria-pressed="false">${icon('heart')}<span>Like</span></button><button type="button" class="artist-playlist-button" data-playlist-artist="${artist.id}" aria-pressed="false">${icon('plus')}<span>Add to playlist</span></button></div>`;
}
function refreshArtistActions() {
  $$('[data-like-artist]').forEach(button => {
    const artist = knownArtists.get(button.dataset.likeArtist);
    const liked = artistLibrary.liked.some(item => item.id === button.dataset.likeArtist);
    button.setAttribute('aria-pressed', String(liked)); button.setAttribute('aria-label', `${liked ? 'Unlike' : 'Like'} ${artist?.name || 'artist'}`);
    button.querySelector('span').textContent = liked ? 'Liked' : 'Like';
  });
  $$('[data-playlist-artist]').forEach(button => {
    const artist = knownArtists.get(button.dataset.playlistArtist);
    const included = artistLibrary.playlist.some(item => item.id === button.dataset.playlistArtist);
    button.setAttribute('aria-pressed', String(included)); button.setAttribute('aria-label', `${included ? 'Remove' : 'Add'} ${artist?.name || 'artist'} ${included ? 'from' : 'to'} playlist`);
    button.querySelector('span').textContent = included ? 'In playlist' : 'Add to playlist';
  });
}
function renderArtistLibrary() {
  $('#liked-count').textContent = String(artistLibrary.liked.length);
  $('#playlist-artists').innerHTML = artistLibrary.playlist.length
    ? artistLibrary.playlist.map(artist => `<span class="playlist-artist-chip"><span>${escape(artist.name)}</span><button type="button" data-remove-playlist="${artist.id}" aria-label="Remove ${escape(artist.name)} from playlist">${icon('close')}</button></span>`).join('')
    : '<p class="playlist-empty">Your lineup is empty. Find an artist and tap <b>Add to playlist</b>, or pick from your liked artists.</p>';
  $('#shuffle-playlist').disabled = !artistLibrary.playlist.length;
  $('#clear-playlist').disabled = !artistLibrary.playlist.length;
  $('#playlist-status').textContent = `${artistLibrary.playlist.length}/${MAX_PLAYLIST_ARTISTS} artists · Shuffle uses the era, genre, and rounds above.`;
  if ($('#liked-artists-list')) renderLikedRows();
  refreshArtistActions();
}
function persistArtistLibrary() {
  const saved = saveArtistLibrary(libraryStorage, artistLibrary);
  renderArtistLibrary();
  if (!saved) toast('Changes kept for this session. This browser couldn’t save your artist library.');
}
function toggleArtistMembership(kind, id) {
  const artist = knownArtists.get(id);
  if (!artist) return;
  const list = artistLibrary[kind];
  if (list.some(item => item.id === id)) artistLibrary[kind] = list.filter(item => item.id !== id);
  else {
    const max = kind === 'playlist' ? MAX_PLAYLIST_ARTISTS : 200;
    if (list.length >= max) { toast(`${kind === 'playlist' ? 'Your playlist' : 'Your liked list'} can hold up to ${max} artists. Remove one first.`); return; }
    artistLibrary[kind] = [...list, artist];
  }
  persistArtistLibrary();
}
function renderLikedRows() {
  const list = $('#liked-artists-list');
  if (!list) return;
  list.innerHTML = artistLibrary.liked.length
    ? artistLibrary.liked.map(artist => `<div class="liked-artist-row"><div><strong>${escape(artist.name)}</strong><small>${escape(artist.genre)}</small></div>${artistActions(artist)}</div>`).join('')
    : '<p class="playlist-empty">No liked artists yet. Search for an artist and tap the heart to save them here.</p>';
  $('#add-liked-to-playlist').disabled = !artistLibrary.liked.length;
  $('#shuffle-liked-artists').disabled = !artistLibrary.liked.length;
}
function showLikedArtists() {
  openModal(`<h2 id="modal-title">Your liked artists.</h2><p>Keep your favorites close. Add them to your playlist or shuffle a mix of your likes.</p><div id="liked-artists-list" class="liked-artists-list"></div><div class="liked-list-actions"><button type="button" class="outline-button" id="add-liked-to-playlist">Add all to playlist</button><button type="button" class="primary-button" id="shuffle-liked-artists">${icon('shuffle')}Shuffle liked</button><button type="button" class="outline-button" id="find-liked-artists">Find artists</button></div><div class="modal-note">Shuffle liked picks up to 20 favorites for a mix. Saved on this browser. Removing a like keeps that artist in your playlist.</div>`);
  renderLikedRows(); refreshArtistActions();
  $('#find-liked-artists').addEventListener('click', () => showFilterPicker('artist', true));
  $('#add-liked-to-playlist').addEventListener('click', () => {
    const combined = cleanArtists([...artistLibrary.playlist, ...artistLibrary.liked]);
    artistLibrary.playlist = combined.slice(0, MAX_PLAYLIST_ARTISTS); persistArtistLibrary();
    toast(combined.length > MAX_PLAYLIST_ARTISTS ? `Added artists up to the ${MAX_PLAYLIST_ARTISTS}-artist playlist limit.` : 'Liked artists added to your playlist.');
  });
  $('#shuffle-liked-artists').addEventListener('click', () => startArtistPlaylist(shuffle(artistLibrary.liked).slice(0, MAX_PLAYLIST_ARTISTS), 'Liked artists mix'));
}
function startArtistPlaylist(artists = artistLibrary.playlist, name = 'Artist playlist') {
  const rounds = selectedRounds();
  if (rounds === null) return;
  if (!artists.length) { toast('Add at least one artist to your playlist first.'); return; }
  const filters = { ...emptyFilters(), era: filterDraft.era, genre: filterDraft.genre };
  const extra = filterLabel(filters);
  const label = `${name} · ${artists.length} ${artists.length === 1 ? 'artist' : 'artists'}${extra !== 'The everything mix' ? ' · ' + extra : ''}`;
  requestRestart('playlist', label, '', null, filters, rounds, [...artists]);
}
$('#find-playlist-artists').addEventListener('click', () => showFilterPicker('artist', true));
$('#liked-artists-button').addEventListener('click', showLikedArtists);
$('#shuffle-playlist').addEventListener('click', () => startArtistPlaylist());
$('#clear-playlist').addEventListener('click', () => { artistLibrary.playlist = []; persistArtistLibrary(); });
document.addEventListener('click', event => {
  const like = event.target.closest('[data-like-artist]');
  if (like) {
    toggleArtistMembership('liked', like.dataset.likeArtist);
    if (!like.isConnected && modal.open) (modal.querySelector(`[data-like-artist="${like.dataset.likeArtist}"]`) || $('#liked-artists-list button') || $('#close-modal')).focus({ preventScroll: true });
  }
  const add = event.target.closest('[data-playlist-artist]');
  if (add) {
    toggleArtistMembership('playlist', add.dataset.playlistArtist);
    if (!add.isConnected && modal.open) modal.querySelector(`[data-playlist-artist="${add.dataset.playlistArtist}"]`)?.focus({ preventScroll: true });
  }
  const remove = event.target.closest('[data-remove-playlist]');
  if (remove) { artistLibrary.playlist = artistLibrary.playlist.filter(artist => artist.id !== remove.dataset.removePlaylist); persistArtistLibrary(); }
});

function renderFilters(message = 'Selections changed. Apply your mix when you’re ready.') {
  $('#era-filter').value = filterDraft.era;
  $('#genre-filter').value = filterDraft.genre;
  $('#artist-filter-value').textContent = filterDraft.artist?.name || 'Any artist';
  $('#album-filter-value').textContent = filterDraft.album?.title || 'Any album';
  $('#artist-filter').title = filterDraft.artist?.name || 'Choose an artist';
  $('#album-filter').title = filterDraft.album?.title || 'Choose an album';
  $('#artist-filter').classList.toggle('has-selection', !!filterDraft.artist);
  $('#album-filter').classList.toggle('has-selection', !!filterDraft.album);
  $('#filter-status').textContent = message;
  $('#reset-filters').disabled = !filterDraft.era && !filterDraft.genre && !filterDraft.artist && !filterDraft.album;
}
function showFilterPicker(kind, forPlaylist = false) {
  const album = kind === 'album';
  openModal(`<h2 id="modal-title">${album ? 'Go deep on an album.' : 'Find your favorite artist.'}</h2><p>${album ? 'Pick a record and guess the songs inside it. Your era and genre choices will also apply.' : 'Search the catalog, choose an artist, then combine with an era or genre.'}</p><form id="filter-picker-form"><label class="field-label" for="filter-picker-query">${album ? 'Album title or artist' : 'Artist name'}</label><div class="artist-form"><input id="filter-picker-query" class="modal-input" placeholder="${album ? 'e.g. Abbey Road' : 'e.g. Beyoncé'}" maxlength="100" autocomplete="off"><button class="primary-button" type="submit">Search ${icon('search')}</button></div></form><div id="picker-status" class="modal-status" role="status">${album && filterDraft.artist ? `Albums by ${escape(filterDraft.artist.name)}. Type to narrow the list.` : 'Type at least two characters to search.'}</div><div id="filter-picker-results" class="filter-picker-results" aria-label="${album ? 'Albums' : 'Artists'}"></div><div class="picker-footer"><button class="outline-button" id="clear-picker">${album ? 'Any album' : 'Any artist'}</button><span>${album ? 'Choosing an album also selects its artist.' : 'Changes apply when you press Apply mix.'}</span></div>`);
  const form = $('#filter-picker-form');
  const input = $('#filter-picker-query');
  const search = async () => {
    songPreviews.stop();
    const query = input.value.trim();
    const request = ++pickerGeneration;
    const valid = () => modal.open && form.isConnected && request === pickerGeneration;
    const status = $('#picker-status');
    const list = $('#filter-picker-results');
    list.innerHTML = '';
    if (query.length < 2 && !(album && filterDraft.artist)) { status.textContent = 'Type at least two characters to search.'; return; }
    status.textContent = album ? 'Finding albums…' : 'Finding artists…';
    try {
      const records = album && filterDraft.artist
        ? await catalogLookup(filterDraft.artist.id, 'album')
        : await catalogRequest('search', { term: query, media: 'music', entity: album ? 'album' : 'musicArtist', limit: '50' });
      if (!valid()) return;
      const seen = new Set();
      pickerResults = records.filter(record => album ? record.collectionId && record.collectionName && record.artistId : record.artistId && record.artistName)
        .map(record => album ? { id: String(record.collectionId), title: record.collectionName, artist: record.artistName, artistId: String(record.artistId), year: record.releaseDate?.slice(0, 4) || '', genre: record.primaryGenreName || 'Album' } : { id: String(record.artistId), name: record.artistName, genre: record.primaryGenreName || 'Artist' })
        .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return !album || !filterDraft.artist || (item.artistId === filterDraft.artist.id && (!query || normalize(item.title).includes(normalize(query)))); }).slice(0, 30);
      status.textContent = pickerResults.length ? `${pickerResults.length} ${album ? 'albums' : 'artists'} found. Choose one below.` : `No ${album ? 'albums' : 'artists'} found. Try a different name${album && filterDraft.artist ? ', or clear the artist filter' : ''}.`;
      list.innerHTML = pickerResults.map((item, index) => {
        const pick = `<button type="button" class="filter-result" data-pick-index="${index}"><span class="mix-card-icon ${album ? 'sage' : 'lilac'}">${icon('music')}</span><span><strong>${escape(album ? item.title : item.name)}</strong><small>${escape(album ? `${item.artist}${item.year ? ' · ' + item.year : ''}` : item.genre)}</small></span>${icon('arrow')}</button>`;
        return album ? pick : `<div class="artist-search-result">${pick}${artistActions(item)}<button type="button" class="artist-preview-toggle" data-preview-artist="${index}" aria-label="Preview songs by ${escape(item.name)}" aria-expanded="false" aria-controls="artist-songs-${request}-${index}">${icon('headphones')}<span>Preview songs</span><span class="preview-toggle-chevron" aria-hidden="true">⌄</span></button><div class="artist-song-panel" id="artist-songs-${request}-${index}" hidden></div></div>`;
      }).join('');
      refreshArtistActions();
      list.querySelectorAll('[data-pick-index]').forEach(button => button.addEventListener('click', () => {
        const item = pickerResults[Number(button.dataset.pickIndex)];
        if (forPlaylist) {
          if (!artistLibrary.playlist.some(artist => artist.id === item.id)) toggleArtistMembership('playlist', item.id);
          else toast(`${item.name} is already in your playlist.`);
          return;
        }
        if (album) { filterDraft.album = item; filterDraft.artist = { id: item.artistId, name: item.artist }; }
        else { if (filterDraft.album?.artistId !== item.id) filterDraft.album = null; filterDraft.artist = item; }
        closeModal(); renderFilters(); $(`#${kind}-filter`).focus();
      }));
      if (!album) {
        const loadPanel = async (item, panel) => {
          panel.innerHTML = '<p class="song-preview-status" role="status">Finding playable songs…</p>';
          try {
            const songs = catalogSongs(await catalogLookup(item.id)).filter(song => song.artistId === item.id);
            if (!valid() || !panel.isConnected) return;
            panel.dataset.loaded = 'true';
            if (!songs.length) { panel.innerHTML = '<p class="song-preview-status" role="status">No playable previews are available for this artist. You can still select them to explore their albums.</p>'; return; }
            songPreviews.render(panel, songs, item.name);
          } catch {
            if (!valid() || !panel.isConnected) return;
            panel.innerHTML = '<p class="song-preview-status" role="status">Song previews couldn’t be loaded. Try again.</p><button type="button" class="outline-button preview-retry">Retry previews</button>';
            panel.querySelector('.preview-retry').addEventListener('click', () => loadPanel(item, panel));
          }
        };
        list.querySelectorAll('[data-preview-artist]').forEach(toggle => toggle.addEventListener('click', () => {
          songPreviews.stop();
          const panel = document.getElementById(toggle.getAttribute('aria-controls'));
          const open = panel.hidden;
          list.querySelectorAll('.artist-song-panel').forEach(element => { element.hidden = true; });
          list.querySelectorAll('[data-preview-artist]').forEach(button => button.setAttribute('aria-expanded', 'false'));
          if (!open) return;
          panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
          if (!panel.dataset.loaded) loadPanel(pickerResults[Number(toggle.dataset.previewArtist)], panel);
        }));
        list.querySelector('[data-preview-artist]')?.click();
      }
    } catch {
      if (valid()) status.textContent = 'The catalog couldn’t be reached. Try again, or play your own tracks / the offline demo.';
    }
  };
  form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(pickerTimer); search(); });
  input.addEventListener('input', () => { songPreviews.stop(); pickerGeneration++; clearTimeout(pickerTimer); $('#filter-picker-results').innerHTML = ''; pickerTimer = setTimeout(search, 350); });
  input.addEventListener('keydown', event => { if (event.key === 'ArrowDown' && $('#filter-picker-results button')) { event.preventDefault(); $('#filter-picker-results button').focus(); } });
  if (forPlaylist) {
    $('#modal-title').textContent = 'Build your artist playlist.';
    $('#modal-body > p').textContent = 'Search for artists and add several to your lineup. When you’re ready, close this search and shuffle your playlist.';
    $('#clear-picker').textContent = 'Done';
    $('.picker-footer > span').textContent = 'Artists save as you add them. Song previews are available below each result.';
  }
  $('#clear-picker').addEventListener('click', () => { if (!forPlaylist) { filterDraft[kind] = null; if (!album) filterDraft.album = null; renderFilters(); } closeModal(); $(forPlaylist ? '#find-playlist-artists' : `#${kind}-filter`).focus(); });
  input.focus();
  if (album && filterDraft.artist) search();
}

ERAS.forEach(era => $('#era-filter').add(new Option(era.label, era.value)));
GENRES.forEach(genre => $('#genre-filter').add(new Option(genre.label, genre.value)));
$('#era-filter').addEventListener('change', () => { filterDraft.era = $('#era-filter').value; renderFilters(); });
$('#genre-filter').addEventListener('change', () => { filterDraft.genre = $('#genre-filter').value; renderFilters(); });
$('#artist-filter').addEventListener('click', () => showFilterPicker('artist'));
$('#album-filter').addEventListener('click', () => showFilterPicker('album'));
$('#reset-filters').addEventListener('click', () => { filterDraft = emptyFilters(); renderFilters('Filters cleared. Apply mix to return to everything.'); });
$('#mix-filters').addEventListener('submit', event => {
  event.preventDefault();
  const filters = { ...filterDraft };
  const label = filterLabel(filters);
  requestRestart(label === 'The everything mix' ? 'everything' : 'filtered', label, '', null, filters);
});

function showMixes() {
  openModal(`<h2 id="modal-title">Find your frequency.</h2><p>All the music you love. A few seconds to prove it.</p><button class="mode-option" data-action="everything"><span class="mix-card-icon peach">${icon('shuffle')}</span><span><strong>The everything mix</strong><small>Big artists and familiar favorites. Always shuffled.</small></span>${icon('arrow')}</button><button class="mode-option" data-action="artist"><span class="mix-card-icon lilac">${icon('music')}</span><span><strong>Your favorite artist</strong><small>Build a challenge around any artist in the catalog.</small></span>${icon('arrow')}</button><button class="mode-option" data-action="upload"><span class="mix-card-icon sage">${icon('upload')}</span><span><strong>Bring your own tracks</strong><small>Pick audio files. Play any song in your library.</small></span>${icon('arrow')}</button><button class="mode-option" data-action="demo"><span class="mix-card-icon peach">${icon('headphones')}</span><span><strong>The offline demo</strong><small>Five original tunes. No connection needed.</small></span>${icon('arrow')}</button><div class="modal-note">Catalog games use short Apple iTunes previews. Availability varies by song and region. Your own audio stays on your device.</div>`);
}
function showArtist() {
  openModal(`<h2 id="modal-title">How well do you know them?</h2><p>The hits. The deep cuts. The song you know by heart.<br>Find an artist, preview their songs, then start your mix.</p><form id="artist-form"><label class="field-label" for="artist-input">Artist name</label><div class="artist-form"><input id="artist-input" class="modal-input" placeholder="e.g. Taylor Swift" required maxlength="100"><button class="primary-button" type="submit">Find songs ${icon('arrow')}</button></div></form><div class="artist-chips"><button data-artist="Taylor Swift">Taylor Swift</button><button data-artist="The Weeknd">The Weeknd</button><button data-artist="Queen">Queen</button><button data-artist="BTS">BTS</button><button data-artist="Bad Bunny">Bad Bunny</button></div><div id="modal-status" class="modal-status" role="status"></div><div id="legacy-artist-actions" hidden></div><div id="artist-song-previews" class="artist-song-panel standalone-previews" hidden></div><button type="button" id="start-artist-mix" class="primary-button modal-full-button" hidden>Play this artist mix ${icon('arrow')}</button><div class="modal-note">We search the US iTunes catalog for songs with playable previews. No account or subscription needed.</div>`);
  $('#artist-input').addEventListener('input', () => {
    songPreviews.stop(); artistSearchGeneration++;
    $('#artist-song-previews').hidden = true; $('#legacy-artist-actions').hidden = true; $('#start-artist-mix').hidden = true;
    $('#artist-form button').disabled = false; statusText('Search to preview this artist’s songs.');
  });
  $('#artist-input').focus();
}
async function findArtist(artist) {
  if (!artist.trim()) return;
  const form = $('#artist-form');
  if (!form) return;
  const request = ++artistSearchGeneration;
  const valid = () => form.isConnected && modal.open && request === artistSearchGeneration;
  songPreviews.stop(); $('#artist-song-previews').hidden = true; $('#legacy-artist-actions').hidden = true; $('#start-artist-mix').hidden = true;
  const button = form.querySelector('button'); button.disabled = true;
  statusText('Finding songs for your mix…');
  try {
    const songs = await catalogSearch(artist.trim());
    if (!valid()) return;
    if (!songs.length) { statusText('No playable songs found. Try another artist or spelling.'); return; }
    const exact = songs.find(song => searchText(song.artist) === searchText(artist));
    const chosen = exact || songs[0];
    const name = chosen.artist;
    const matches = songs.filter(song => chosen.artistId ? song.artistId === chosen.artistId : searchText(song.artist) === searchText(name));
    statusText(`${matches.length} playable songs by ${name}. Listen below, then start your mix.`);
    const previews = $('#artist-song-previews');
    previews.hidden = false; songPreviews.render(previews, matches, name);
    const actions = $('#legacy-artist-actions');
    actions.hidden = !chosen.artistId;
    if (chosen.artistId) { actions.innerHTML = artistActions({ id: chosen.artistId, name, genre: chosen.genre }); refreshArtistActions(); }
    const start = $('#start-artist-mix');
    start.hidden = false; start.onclick = () => requestRestart('artist', `${name} mix`, name);
  } catch {
    if (valid()) statusText('We couldn’t reach the music catalog. Try again when you’re online, or choose your own tracks / the offline demo.');
  } finally { if (valid()) button.disabled = false; }
}
function showUpload() {
  if (selectedRounds() === null) return;
  uploading = [...state.localTracks]; uploadErrors = [];
  openModal(`<h2 id="modal-title">Your library. Your rules.</h2><p>Turn your own songs into a guessing game. Let a friend pick the tracks for an extra challenge.</p><label class="upload-drop" id="upload-drop">${icon('upload')}<strong>Drop your songs here, or browse</strong><small>MP3, M4A, WAV, OGG · up to 50 tracks</small><input type="file" id="file-input" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.webm" multiple class="sr-only"></label><div class="file-list" id="file-list"></div><div class="modal-note">Name files <b>Artist - Song title.mp3</b> for the best guesses and hints. Files are played locally and never uploaded. Your round choice applies, up to the number of unique files.</div><div id="modal-status" class="modal-status" role="status"></div><button class="primary-button modal-full-button" id="start-local" data-action="start-local">Start my mix ${icon('arrow')}</button>`);
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
  statusText(uploadErrors.length ? uploadErrors.join(' ') : uploading.length ? `${uploading.length} ${uploading.length === 1 ? 'track' : 'tracks'} ready. The round choice above applies, up to the number of unique files.` : 'Choose at least one audio file to begin.');
}
function showDemoGuide() {
  openModal(`<h2 id="modal-title">Meet the demo mix.</h2><p>Five original instrumental loops, made just for Offbeat. Listen to a sample to learn their sound, then put your memory to the test.</p><div class="demo-tracks">${DEMO_SONGS.map((song, i) => `<div><span>${escape(song.title)} <small>· ${escape(song.genre)}</small></span><button class="outline-button demo-listen-button" data-listen-demo="${i}" aria-label="Preview ${escape(song.title)}">Listen</button></div>`).join('')}</div><div class="modal-note">These are original demo melodies, not recordings of commercial songs. Choose a catalog mix or your own files to guess real releases.</div><button class="primary-button modal-full-button" data-action="close">I’m ready ${icon('arrow')}</button>`);
}
let demoAudio;
modal.addEventListener('cancel', () => { songPreviews.stop(); demoAudio?.pause(); });
modal.addEventListener('close', () => {
  songPreviews.stop(); demoAudio?.pause(); clearTimeout(demoTimer); clearTimeout(pickerTimer); pickerGeneration++; artistSearchGeneration++; pendingRestart = null;
  uploading.forEach(track => { if (!state.localTracks.some(item => item.id === track.id)) URL.revokeObjectURL(track.preview); });
  uploading = [];
});
function showHow() {
  const rules = difficultyRules(state.difficulty);
  openModal(`<h2 id="modal-title">A little sound. A big clue.</h2><p>No lyrics on the screen. No album cover to give it away.<br>Just you, your ears, and that “I know this” feeling.</p><div class="how-step"><span class="step-number">01</span><div><strong>Press play. Listen close.</strong><p>You start with a ${rules.clips[0]}-second clip. Replay it as often as you like.</p></div></div><div class="how-step"><span class="step-number">02</span><div><strong>Name that song.</strong><p>Type the title, or search and pick a match. A first-guess answer earns ${difficultyPoints(state.difficulty, 0).toLocaleString()} points.</p></div></div><div class="how-step"><span class="step-number">03</span><div><strong>Need another beat?</strong><p>Skip or guess wrong to unlock ${rules.clips.slice(1).join(', ')} seconds. Longer clips mean fewer points. ${rules.hints ? 'A hint costs 150 points, with a 50-point minimum.' : 'Hints are off on Hard difficulty.'}</p></div></div><div class="modal-note">${rules.clips.length} chances per song in this mix. Change difficulty for the regular mix above, then press <b>Play regular mix</b>. Your stats are saved in this browser after a full session. Press <b>/</b> to jump to the search box.</div><button class="primary-button modal-full-button" data-action="close">Let’s play ${icon('arrow')}</button>`);
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
  if (action === 'edit-filters') { $('.mix-toolbar').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#era-filter').focus({ preventScroll: true }); }
  if (action === 'artist') showArtist();
  if (action === 'upload') showUpload();
  if (action === 'demo-guide') showDemoGuide();
  if (action === 'demo') requestRestart('demo', 'The offline demo');
  if (action === 'everything') requestRestart('everything', 'The everything mix');
  if (action === 'start-local' && uploading.length) {
    requestRestart('local', 'Your own tracks', '', [...uploading]);
  }
  if (action === 'cancel-restart') { pendingRestart = null; closeModal(); }
  if (action === 'confirm-restart' && pendingRestart) { const config = pendingRestart; pendingRestart = null; restart(config.mode, config.label, config.artist, config.tracks, config.filters, config.rounds, config.artists, config.difficulty, config.chartSongs); }
  if (action === 'again') restart(state.mode, state.label, state.artist, null, state.filters, state.roundSetting, state.playlist, state.difficulty, state.chartSongs);
  if (action === 'share') {
    const text = `Offbeat · ${state.label}\n${state.results.map(result => result.correct ? '🟩' : '⬜').join('')}\n${state.score.toLocaleString()} points · ${state.results.filter(result => result.correct).length}/${state.results.length} songs\nHow soon do you know the song?`;
    try { await navigator.clipboard.writeText(text); toast('Results copied. Bragging rights are yours.'); } catch { toast('Copy isn’t available in this browser. Your score: ' + state.score.toLocaleString() + ' points.'); }
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopAudio(); songPreviews.pause(); demoAudio?.pause(); } });
renderRound();
renderArtistLibrary();
