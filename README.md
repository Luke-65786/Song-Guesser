# Offbeat

A song guessing game with a music catalog, artist challenges, and private local-file mixes. Built with HTML, CSS, JavaScript modules, and a small Node HTTP server. No runtime dependencies, API keys, accounts, or build step.

## Run

Use Node.js 22 or newer (developed with Node 24).

```sh
cd /workspace/Song-Guesser
npm start
```

The server listens on port **3000**, or `PORT` if set. `npm run dev` watches the server for changes; refresh the browser after frontend edits. `GET /health` returns `{"ok":true}`.

## Play

- **Everything mix:** five randomly selected songs from popular artists in the US iTunes catalog.
- **Artist mix:** search an artist and play up to five available previews.
- **Your own tracks:** select or drag in audio files, with filenames such as `Artist - Song title.mp3`. Audio stays on the device using object URLs; nothing is uploaded. This is the way to play songs outside the catalog. Have a friend choose the files to keep the answers a surprise.
- **Offline demo:** five included original instrumental loops. Open “Meet the tracks” to hear and learn the demos first. These are original synthesized tunes, not commercial song recordings.

Clips unlock at 1, 2, 4, 7, 11, and 16 seconds. Correct answers earn 1,000, 800, 600, 400, 250, or 100 points respectively. A hint deducts 150 points, with a minimum award of 50. Replay a clip freely, submit a typed title or pick a search result, and skip to unlock more audio. After six attempts, the song is revealed. Completed-session stats are stored in this browser's localStorage. Local libraries and in-progress sessions do not persist after reload.

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

Unit and HTTP tests cover guesses, catalog deduplication, scores, filenames, static assets, and audio range requests. HTTP tests require permission to bind a temporary local port.

For browser integration tests, run the app in a second terminal and use an environment with Python Playwright and Chromium installed:

```sh
python3 scripts/browser-smoke.py
```

Override `CHROMIUM_PATH` or `OFFBEAT_TEST_URL` if needed. These tests play real local audio and exercise sessions, timing, uploads, saved stats, network failure recovery, desktop/mobile layouts, and a **mocked** catalog response. Screenshots are written to `/tmp/offbeat-desktop.png` and `/tmp/offbeat-mobile.png`. A mocked catalog test does not establish that Apple's live service is reachable.

## Assets

The five demo tracks were composed and synthesized for this project. Regenerate them with `python3 scripts/generate-demo.py`; generated WAVs are included so Python is not required to play. The record illustration and icons are inline SVG/CSS. Bundled Open Sans fonts are covered by the Apache 2.0 license in `public/fonts/LICENSE.txt`.
