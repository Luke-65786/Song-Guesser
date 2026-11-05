# Offbeat

A dark-themed song guessing game with a music catalog, era/genre/artist/album filters, artist challenges, and private local-file mixes. Built with HTML, CSS, JavaScript modules, and a small Node HTTP server. No runtime dependencies, API keys, accounts, or build step.

## Run

Use Node.js 22 or newer (developed with Node 24).

```sh
cd /workspace/Song-Guesser
npm start
```

The server listens on port **3000**, or `PORT` if set. `npm run dev` watches the server for changes; refresh the browser after frontend edits. `GET /health` returns `{"ok":true}`.

## GitHub Pages

The browser app is entirely static and also runs without the Node server. The `gh-pages` branch publishes only the contents of `public/`, with relative asset paths that support the `/Song-Guesser/` project URL.

Website address: **https://luke-65786.github.io/Song-Guesser/**. Initial activation requires the repository's **Settings → Pages → Build and deployment** to use **Deploy from a branch**, branch **gh-pages**, folder **/(root)**. Click **Save** and wait for GitHub's Pages build to finish.

To publish later changes after committing them on `main`:

```sh
npm run publish:pages
```

The publishing script uses Git and Node without extra dependencies, keeps publication history, and uses normal fast-forward protection. Commit changes to `public/` before publishing. This is a manual publishing flow; pushing `main` alone does not update the deployed site. No API keys or server hosting are needed.

## Play

- **Everything mix:** randomly selected songs from popular artists in the US iTunes catalog.
- **Artist mix:** search an artist, preview their songs, and play a mix at your chosen length.
- **Artist playlist:** add several artists to your saved lineup and shuffle their songs together.
- **Your own tracks:** select or drag in audio files, with filenames such as `Artist - Song title.mp3`. Audio stays on the device using object URLs; nothing is uploaded. This is the way to play songs outside the catalog. Have a friend choose the files to keep the answers a surprise.
- **Offline demo:** five included original instrumental loops. Open “Meet the tracks” to hear and learn the demos first. These are original synthesized tunes, not commercial song recordings.

The top **Find your mix** bar lets you combine an **Era** (1960s–2020s), **Genre**, **Artist**, and **Album**. Artist and album pickers search the catalog. Selecting an album also selects its artist; choosing a different artist clears an incompatible album. Press **Apply mix** to start a filtered session. Changes stay as draft selections until applied, and replacing an in-progress game asks for confirmation. **Reset filters** clears the selections; apply them to return to the everything mix. The filters apply to catalog games; switching to a demo or local library clears them.

**Rounds** defaults to five. Pick a preset, choose **Custom** for any whole count from **1–50**, or choose **Random** to draw **5–20** once when a new session starts. Playing/retrying a clip never rerolls that number. A new session using Random draws again. All modes use this setting, including uploaded files and the demo. Sessions stop at the number of unique playable songs available, with an explanation when a library is shorter than requested. They do not repeat track IDs to fill a larger count.

Build **Your artist playlist** with **Find artists**. **Add to playlist** keeps search open so you can add several artists; use **Done**, then **Shuffle playlist**. Artist previews remain available while browsing. Each playlist holds up to 20 artists, and shuffle uses the era, genre, and rounds selected above. The single-artist and album choices are replaced by the playlist lineup. Artists are drawn in shuffled passes so larger catalogs do not dominate; an unavailable or empty artist result asks you to retry or edit the lineup instead of silently dropping it. Editing the saved lineup does not change a game already underway—shuffle again to apply changes.

Tap the **heart** beside an artist in either search screen to save a like. Open **Liked** to view favorites, unlike them, add them all to your playlist, or **Shuffle liked** directly (up to 20 randomly chosen favorites per mix). Likes and the current playlist are saved in localStorage on this browser, without an account or server upload. Removing a like does not remove that artist from the playlist, and clearing the playlist keeps your likes. Up to 200 likes are retained. If browser storage is unavailable, changes remain usable for the current session and the app explains that they could not be saved.

The interface uses charcoal and blue-gray surfaces with lavender accents, inspired by Windows dark settings. Text, inputs, filters, playback controls, and dialogs are enlarged for readability. **Skip** is a filled secondary button with a 56-pixel minimum height; on phones it spans the full width below Guess.

Artist searches include **Song previews**: up to five playable tracks with titles, album/year details, and Play/Pause controls. The first artist result loads its song list automatically, without playing audio; use **Preview songs** to expand another artist. In the artist-mix search, preview the songs and then press **Play this artist mix**. Only one preview plays at a time, with a 15-second limit. Changing the search, choosing an artist, starting a mix, or closing the dialog stops preview playback. Browsing uses a separate audio player and does not change game attempts or scores. Preview and catalog failures offer recovery choices, and some artists may have no playable previews.

All selected filters must match. Artist and album IDs determine membership, and decades use catalog release dates (which can differ for reissues). Discovery mixes sample catalog searches around artists in the selected era/genre; they are not an exhaustive list of all matching songs. Sessions use the selected round count, capped by available unique tracks. An empty combination asks you to broaden the filters rather than substituting unrelated songs. The interface always uses the dark theme, including native inputs and dialogs, regardless of system preferences.

Clips unlock at **0.1, 0.5, 1, 3, 5, 10, and 15 seconds**. Correct answers earn 1,000, 900, 800, 600, 400, 250, or 100 points respectively. A hint deducts 150 points, with a minimum award of 50. Replay a clip freely, submit a typed title or pick a search result, and skip to unlock more audio. After seven attempts, the song is revealed; replays after a reveal are capped at 15 seconds. Playback is a single progress line with fractional time labels, and the session/leaderboard sidebar is hidden. Personal stats remain available through **Your stats**. Completed-session stats are stored in this browser's localStorage. Local libraries and in-progress sessions do not persist after reload.

Keyboard support: `/` focuses the guess input, arrow keys navigate search results, Enter selects or submits, and Escape closes a dialog or suggestions. Reduced motion and mobile layouts are supported.

## Catalog access

The app uses Apple's public iTunes Search API via browser-side JSONP. It requires access to:

- `itunes.apple.com` for catalog search
- `audio-ssl.itunes.apple.com` for preview audio

No server-side API proxy or credentials are needed. Catalog coverage, regional restrictions, preview availability, rate limits, and browser media codec support can affect which songs work. The service does **not** promise every released song. Bring your own audio for any track you have. Network and media failures show recovery choices; the demo and local library work without external services.

## Validation

```sh
npm run check
npm test
```

Unit and HTTP tests cover guesses, catalog deduplication, scores, filenames, static assets, audio range requests, and era/genre/artist/album filter intersections. HTTP tests require permission to bind a temporary local port.

For browser integration tests, run the app in a second terminal and use an environment with Python Playwright and Chromium installed:

```sh
python3 scripts/browser-smoke.py
python3 scripts/browser-filters.py
python3 scripts/browser-playback.py
python3 scripts/browser-artist-previews.py
python3 scripts/browser-artist-library.py
```

Override `CHROMIUM_PATH` or `OFFBEAT_TEST_URL` if needed. These tests play real local audio and exercise sessions, timing, uploads, saved stats, network failure recovery, desktop/mobile layouts, and a **mocked** catalog response. Screenshots are written to `/tmp/offbeat-desktop.png` and `/tmp/offbeat-mobile.png`. A mocked catalog test does not establish that Apple's live service is reachable.

The filter suite additionally checks combined and individual filters, album/artist consistency, reset, empty results, picker failures, preserving an active session, and dark styling with a light system preference. Its screenshots are `/tmp/offbeat-dark-desktop.png` and `/tmp/offbeat-dark-mobile.png`. The same suite can validate a GitHub Pages-style subpath by setting `OFFBEAT_TEST_URL` to a static server's project URL.

The playback suite measures every requested clip duration using actual included audio, checks fractional labels and the line progress display, verifies seven chances and a 15-second reveal cap, and checks that the session panel is hidden on desktop and mobile. Its screenshots are `/tmp/offbeat-line-desktop.png` and `/tmp/offbeat-line-mobile.png`. Playback uses a media-clock cutoff timer alongside visual updates; timing is subject to browser scheduling.

The artist-preview suite uses mocked catalog data and actual included audio to verify automatic lists without autoplay, artist identity filtering, Play/Pause/resume, the 15-second cutoff, switching songs, close/selection cleanup, empty and failed previews, retries, both artist search screens, and mobile layout. Its screenshots are `/tmp/offbeat-artist-previews-desktop.png` and `/tmp/offbeat-artist-previews-mobile.png`.

The artist-library suite checks custom/random round choices, validation, complete sessions at different lengths, balanced artist selection, uniqueness, persistent likes and playlist edits, both shuffle actions, active-session snapshots, network failure recovery, and phone/tablet/desktop layouts. Catalog metadata is mocked, while playback uses the included audio. Screenshots are `/tmp/offbeat-library-mobile.png` and `/tmp/offbeat-liked-artists-mobile.png`.

## Assets

The five demo tracks were composed and synthesized for this project. Regenerate them with `python3 scripts/generate-demo.py`; generated WAVs are included so Python is not required to play. The record illustration and icons are inline SVG/CSS. Bundled Open Sans fonts are covered by the Apache 2.0 license in `public/fonts/LICENSE.txt`.
