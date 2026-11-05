"""Browser integration checks. Requires Playwright and Chromium; run the app first.

The live catalog is mocked explicitly. Demo and uploaded audio are played for real.
"""
from pathlib import Path
import json
import os
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
BASE = os.environ.get('OFFBEAT_TEST_URL', 'http://127.0.0.1:3000').rstrip('/') + '/'
TRACKS = {
    'neon-avenue': 'Neon Avenue',
    'sunday-somewhere': 'Sunday Somewhere',
    'after-hours': 'After Hours',
    'golden-state': 'Golden State',
    'paper-planes': 'Paper Planes',
}

def listen(page):
    page.locator('#play-button').click()
    page.wait_for_function("document.querySelector('#audio').currentTime > 0.08")
    assert page.locator('#audio').evaluate('(a) => a.duration') > 15

def guess_current(page):
    source = page.locator('#audio').get_attribute('src')
    slug = Path(urlparse(source).path).stem
    page.locator('#guess-input').fill(TRACKS[slug])
    page.locator('#guess-button').click()
    expect(page.locator('#result')).to_contain_text('THAT’S THE ONE!')

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    context.route('https://itunes.apple.com/**', lambda route: route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until='networkidle')
    expect(page).to_have_title('Offbeat — Name that feeling. Guess that song.')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path='/tmp/offbeat-desktop.png', full_page=True)

    # Full five-song session: hint, wrong guess, correct guess, loss, and three wins.
    page.locator('#demo-button').click()
    expect(page.locator('#mix-label')).to_have_text('The offline demo')
    listen(page)
    page.wait_for_function("document.querySelector('#audio').paused")
    assert 0.1 <= page.locator('#audio').evaluate('(a) => a.currentTime') < 0.2
    page.locator('#hint-button').click()
    expect(page.locator('#available-points')).to_have_text('850')
    page.locator('#guess-input').fill('Definitely Not The Song')
    page.locator('#guess-button').click()
    expect(page.locator('#attempt-label')).to_have_text('GUESS 2 OF 7')
    expect(page.locator('#available-points')).to_have_text('750')
    guess_current(page)
    expect(page.locator('#score')).to_have_text('750')
    page.locator('#next-button').click()
    listen(page)
    for _ in range(7):
        page.locator('#skip-button').click()
    expect(page.locator('#result')).to_contain_text('ONE FOR YOUR PLAYLIST')
    expect(page.locator('#streak')).to_contain_text('0')
    for _ in range(3):
        page.locator('#next-button').click()
        listen(page)
        guess_current(page)
    expect(page.locator('#score')).to_have_text('3,750')
    page.locator('#next-button').click()
    expect(page.locator('#modal')).to_be_visible()
    expect(page.locator('#modal-body')).to_contain_text('4/5')
    data = page.evaluate("JSON.parse(localStorage.getItem('offbeat-stats-v1'))")
    assert data == {'games': 1, 'correct': 4, 'rounds': 5, 'bestScore': 3750, 'bestStreak': 3}, data
    print('PASS: complete session, real audio, clip cutoff, hints, seven attempts, scoring, streaks, and results')

    # Stats persist across page loads. Keyboard shortcut and dialogs work.
    page.reload(wait_until='networkidle')
    page.locator('#stats-button').click()
    expect(page.locator('.stat-box').first).to_contain_text('1')
    page.keyboard.press('Escape')
    page.keyboard.press('/')
    expect(page.locator('#guess-input')).to_be_focused()
    page.locator('#how-button').click()
    expect(page.locator('#modal-body')).to_contain_text('Name that song.')
    page.locator('#close-modal').click()
    print('PASS: persisted stats, keyboard shortcut, help dialog, and Escape')

    # One-song local library, derived from filename. No upload requests are made.
    page.locator('[data-preset="upload"]').click()
    page.locator('#file-input').set_input_files({'name': 'Test Artist - My Test Song.wav', 'mimeType': 'audio/wav', 'buffer': (ROOT / 'public/audio/neon-avenue.wav').read_bytes()})
    expect(page.locator('#file-list')).to_contain_text('My Test Song')
    page.locator('#start-local').click()
    expect(page.locator('#round-total')).to_have_text('01')
    listen(page)
    assert page.locator('#audio').get_attribute('src').startswith('blob:')
    page.locator('#guess-input').fill('My Test')
    expect(page.locator('.suggestion')).to_have_count(1)
    page.locator('#guess-input').press('ArrowDown')
    page.locator('#guess-input').press('Enter')
    page.locator('#guess-button').click()
    expect(page.locator('#result')).to_contain_text('My Test Song')
    page.locator('#next-button').click()
    expect(page.locator('#modal-body')).to_contain_text('1/1')
    print('PASS: local file loading, actual blob audio playback, autocomplete, keyboard selection, and one-track session')

    page.reload(wait_until='networkidle')
    page.locator('#play-button').click()
    expect(page.locator('#feedback')).to_contain_text('offline demo', timeout=10000)
    expect(page.locator('#play-button')).to_be_enabled()
    page.locator('#feedback [data-action="demo"]').click()
    expect(page.locator('#mix-label')).to_have_text('The offline demo')
    print('PASS: unavailable live catalog recovers into offline mode')

    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(BASE, wait_until='networkidle')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path='/tmp/offbeat-mobile.png', full_page=True)
    page.locator('#how-button').click()
    assert page.locator('#modal').bounding_box()['width'] <= 390
    page.locator('[data-action="close"]').click()
    print('PASS: mobile layout without horizontal overflow and responsive dialogs')

    # Test the catalog adapter with deterministic JSONP responses (not live verification).
    catalog_page = context.new_page()
    catalog_page.set_viewport_size({'width': 1440, 'height': 1000})
    catalog_page.on('pageerror', lambda error: errors.append(str(error)))
    def mock_catalog(route):
        params = parse_qs(urlparse(route.request.url).query)
        songs = [{'kind': 'song', 'trackId': i + 1, 'trackName': title, 'artistName': 'Queen', 'primaryGenreName': 'Rock', 'releaseDate': '1980-01-01', 'previewUrl': BASE + 'audio/' + slug + '.wav'} for i, (slug, title) in enumerate(TRACKS.items())]
        route.fulfill(status=200, content_type='text/javascript', body=params['callback'][0] + '(' + json.dumps({'results': songs}) + ');')
    catalog_page.route('https://itunes.apple.com/**', mock_catalog)
    catalog_page.goto(BASE, wait_until='networkidle')
    catalog_page.locator('[data-preset="artist"]').click()
    catalog_page.locator('[data-artist="Queen"]').click()
    expect(catalog_page.locator('#artist-song-previews .song-preview-row')).to_have_count(5)
    catalog_page.locator('#start-artist-mix').click()
    expect(catalog_page.locator('#mix-label')).to_have_text('Queen mix')
    listen(catalog_page)
    guess_current(catalog_page)
    expect(catalog_page.locator('#score')).to_have_text('1,000')
    print('PASS: artist lookup and catalog gameplay via a mocked JSONP service; live service remains unverified')
    assert errors == [], errors
    print('PASS: no uncaught browser errors')
    browser.close()
