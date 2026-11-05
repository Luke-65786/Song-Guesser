import { MAX_CLIP_LENGTH, formatTime } from './game.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const control = (text, symbol) => `<svg aria-hidden="true"><use href="#i-${symbol}"/></svg><span>${text}</span>`;

// One dedicated player for browsing artists. It never advances or scores a game.
export function createSongPreviews(audio, beforePlay) {
  let active = null;
  let generation = 0;
  let cutoffTimer;
  let frame;

  function clearPlayback() { clearTimeout(cutoffTimer); cancelAnimationFrame(frame); }
  function buttonState(text, playing = false) {
    if (!active) return;
    active.button.innerHTML = control(text, playing ? 'pause' : 'play');
    active.button.setAttribute('aria-label', `${text} ${active.song.title} by ${active.song.artist}`);
    active.button.setAttribute('aria-pressed', String(playing));
    active.button.removeAttribute('aria-busy');
    active.row.classList.toggle('is-preview-playing', playing);
  }
  function updateTime() {
    if (!active) return;
    const limit = Math.min(MAX_CLIP_LENGTH, Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : MAX_CLIP_LENGTH);
    const elapsed = Math.min(limit, audio.currentTime || 0);
    active.row.querySelector('.song-preview-fill').style.width = `${elapsed / limit * 100}%`;
    active.row.querySelector('.song-preview-time').textContent = `${formatTime(elapsed)} / ${formatTime(limit)}`;
    return limit;
  }
  function pause() {
    generation++; clearPlayback(); audio.pause();
    if (active) { updateTime(); buttonState('Play'); active.status.textContent = `Paused: ${active.song.title}.`; }
  }
  function stop() {
    pause();
    if (active) {
      active.row.querySelector('.song-preview-timing').hidden = true;
      active.status.textContent = 'Choose a track to listen.';
    }
    active = null; audio.removeAttribute('src'); audio.load();
  }
  function finish() {
    generation++; clearPlayback(); audio.pause(); updateTime(); buttonState('Replay');
    if (active) active.status.textContent = `Preview finished: ${active.song.title}.`;
  }
  function failed() {
    const status = active?.status;
    stop();
    if (status) status.textContent = 'That preview couldn’t play. Try it again or choose another song.';
  }
  async function play(item) {
    if (active?.button === item.button && !audio.paused) { pause(); return; }
    if (active?.button !== item.button) {
      stop(); active = item; audio.src = item.song.preview;
    }
    beforePlay();
    const token = ++generation;
    if (audio.ended || audio.currentTime >= MAX_CLIP_LENGTH) audio.currentTime = 0;
    item.row.querySelector('.song-preview-timing').hidden = false;
    item.button.innerHTML = control('Loading…', 'play');
    item.button.setAttribute('aria-busy', 'true');
    item.status.textContent = `Loading preview: ${item.song.title}…`;
    let timeout;
    try {
      await Promise.race([audio.play(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Preview timed out')), 12000); })]);
      if (token !== generation || !item.row.isConnected) return;
      buttonState('Pause', true);
      item.status.textContent = `Playing: ${item.song.title}.`;
      const limit = updateTime();
      const checkCutoff = () => {
        if (token !== generation) return;
        if (audio.currentTime >= limit || audio.ended) { finish(); return; }
        cutoffTimer = setTimeout(checkCutoff, Math.max(1, (limit - audio.currentTime) * 1000));
      };
      const tick = () => {
        if (token !== generation) return;
        updateTime(); frame = requestAnimationFrame(tick);
      };
      checkCutoff(); tick();
    } catch (error) { if (token === generation && error.name !== 'AbortError') failed(); }
    finally { clearTimeout(timeout); }
  }
  audio.addEventListener('ended', () => { if (active) finish(); });
  audio.addEventListener('error', () => { if (active) failed(); });

  function render(container, songs, artistName) {
    const tracks = songs.slice(0, 5);
    container.innerHTML = `<div class="song-previews-heading"><h3>Song previews</h3><span>Up to ${MAX_CLIP_LENGTH} seconds each</span></div><ol class="song-preview-list">${tracks.map((song, index) => `<li class="song-preview-row"><span class="song-preview-number">${index + 1}</span><div class="song-preview-info"><strong>${escape(song.title)}</strong><small>${escape(song.album || song.artist)}${song.year && song.year !== 'Unknown year' ? ` · ${escape(song.year)}` : ''}</small><div class="song-preview-timing" hidden><div class="song-preview-line" aria-hidden="true"><span class="song-preview-fill"></span></div><span class="song-preview-time">${formatTime(0)} / ${formatTime(MAX_CLIP_LENGTH)}</span></div></div><button type="button" class="song-preview-button" aria-label="Play ${escape(song.title)} by ${escape(song.artist)}" aria-pressed="false">${control('Play', 'play')}</button></li>`).join('')}</ol><p class="song-preview-status" role="status" aria-label="${escape(artistName)} preview status">Choose a track to listen.</p>`;
    const status = container.querySelector('.song-preview-status');
    container.querySelectorAll('.song-preview-row').forEach((row, index) => {
      const button = row.querySelector('.song-preview-button');
      button.addEventListener('click', () => play({ row, button, status, song: tracks[index] }));
    });
  }
  return { render, stop, pause };
}
