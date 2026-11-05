"""Dark theme and catalog filter integration tests (mocked catalog; real local audio)."""
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('OFFBEAT_TEST_URL', 'http://127.0.0.1:3000').rstrip('/') + '/'
DATA = [
    ('neon-avenue', 'Neon Avenue', '1981', 'Rock', 10, 100),
    ('sunday-somewhere', 'Sunday Somewhere', '1989', 'Rock', 10, 100),
    ('after-hours', 'After Hours', '1991', 'Rock', 10, 101),
    ('golden-state', 'Golden State', '1983', 'Pop', 10, 100),
    ('paper-planes', 'Paper Planes', '1982', 'Rock', 20, 200),
]
ARTISTS = [
    {'wrapperType': 'artist', 'artistId': 10, 'artistName': 'Queen', 'primaryGenreName': 'Rock'},
    {'wrapperType': 'artist', 'artistId': 20, 'artistName': 'Queen Tribute', 'primaryGenreName': 'Rock'},
]
ALBUMS = [
    {'wrapperType': 'collection', 'collectionId': 100, 'collectionName': 'Neon Nights', 'artistName': 'Queen', 'artistId': 10, 'releaseDate': '1981-01-01'},
    {'wrapperType': 'collection', 'collectionId': 101, 'collectionName': 'Later Days', 'artistName': 'Queen', 'artistId': 10, 'releaseDate': '1991-01-01'},
    {'wrapperType': 'collection', 'collectionId': 200, 'collectionName': 'Another Record', 'artistName': 'Queen Tribute', 'artistId': 20, 'releaseDate': '1982-01-01'},
]
SONGS = [{'kind': 'song', 'trackId': i+1, 'trackName': title, 'artistName': 'Queen' if artist == 10 else 'Queen Tribute', 'artistId': artist, 'collectionId': album, 'collectionName': 'Neon Nights' if album == 100 else 'Later Days', 'primaryGenreName': genre, 'releaseDate': year+'-01-01', 'previewUrl': BASE+'audio/'+slug+'.wav'} for i, (slug,title,year,genre,artist,album) in enumerate(DATA)]
SONGS.append({**SONGS[0], 'trackId': 99, 'trackName': 'Unavailable', 'previewUrl': ''})

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce', color_scheme='light')
    errors = []
    requests = []
    def respond(route):
        params = parse_qs(urlparse(route.request.url).query)
        requests.append(params)
        entity = params.get('entity', [''])[0]
        if entity == 'musicArtist':
            results = ARTISTS
        elif entity == 'album':
            results = ARTISTS[:1] + ALBUMS
        else:
            results = ALBUMS[:1] + SONGS
        route.fulfill(status=200, content_type='text/javascript', body=params['callback'][0]+'('+json.dumps({'results':results})+');')
    context.route('https://itunes.apple.com/**', respond)
    def new_page(width=1440):
        page = context.new_page()
        page.set_viewport_size({'width':width, 'height':1100 if width > 700 else 844})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until='networkidle')
        return page
    def play(page):
        page.locator('#play-button').click()
        page.wait_for_function("document.querySelector('#audio').currentTime > .08")
    def correct(page):
        slug = Path(urlparse(page.locator('#audio').get_attribute('src')).path).stem
        title = next(row[1] for row in DATA if row[0] == slug)
        page.locator('#guess-input').fill(title)
        page.locator('#guess-button').click()
        expect(page.locator('#result')).to_contain_text('THAT’S THE ONE!')

    page = new_page()
    assert page.evaluate("getComputedStyle(document.documentElement).colorScheme") == 'dark'
    for selector in ['body', '.game-card', '.session-card', '.mix-toolbar']:
        color = page.locator(selector).evaluate('(el) => getComputedStyle(el).backgroundColor')
        assert color in ['rgb(17, 20, 16)', 'rgb(26, 32, 23)'], (selector, color)
    page.screenshot(path='/tmp/offbeat-dark-desktop.png', full_page=True)
    print('PASS: dark-only theme even with a light system preference')

    page.locator('#era-filter').select_option('1980')
    page.locator('#genre-filter').select_option('rock')
    page.locator('#artist-filter').click()
    page.locator('#filter-picker-query').fill('Queen')
    expect(page.locator('.filter-result')).to_have_count(2)
    page.locator('.filter-result').first.click()
    expect(page.locator('#artist-filter-value')).to_have_text('Queen')
    page.locator('#album-filter').click()
    expect(page.locator('.filter-result')).to_have_count(2)
    page.locator('.filter-result').filter(has_text='Neon Nights').click()
    expect(page.locator('#album-filter-value')).to_have_text('Neon Nights')
    page.locator('#apply-filters').click()
    expect(page.locator('#mix-label')).to_have_text('1980s · Rock · Queen · Neon Nights')
    play(page)
    expect(page.locator('#round-total')).to_have_text('02')
    assert Path(urlparse(page.locator('#audio').get_attribute('src')).path).stem in ['neon-avenue', 'sunday-somewhere']
    # Draft changes don't silently replace a session. Cancel keeps the current game.
    page.locator('#era-filter').select_option('1990')
    expect(page.locator('#mix-label')).to_contain_text('1980s')
    page.locator('#apply-filters').click()
    expect(page.locator('#modal-title')).to_have_text('A fresh set of songs?')
    page.locator('[data-action="cancel-restart"]').click()
    correct(page)
    page.locator('#next-button').click()
    play(page)
    assert Path(urlparse(page.locator('#audio').get_attribute('src')).path).stem in ['neon-avenue', 'sunday-somewhere']
    correct(page)
    page.locator('#next-button').click()
    expect(page.locator('#modal-body')).to_contain_text('2/2')
    page.locator('[data-action="again"]').click()
    expect(page.locator('#era-filter')).to_have_value('1980')
    page.locator('#reset-filters').click()
    expect(page.locator('#artist-filter-value')).to_have_text('Any artist')
    expect(page.locator('#album-filter-value')).to_have_text('Any album')
    page.locator('#apply-filters').click()
    expect(page.locator('#mix-label')).to_have_text('The everything mix')
    print('PASS: all four filters intersect; identity, dates, genre, session confirmation, replay, and reset work')

    era = new_page()
    era.locator('#era-filter').select_option('1980')
    era.locator('#apply-filters').click()
    play(era)
    expect(era.locator('#round-total')).to_have_text('04')
    genre = new_page()
    genre.locator('#genre-filter').select_option('pop')
    genre.locator('#apply-filters').click()
    play(genre)
    expect(genre.locator('#round-total')).to_have_text('01')
    assert 'golden-state' in genre.locator('#audio').get_attribute('src')
    print('PASS: era-only and genre-only mixes discover and filter real metadata')

    empty = new_page()
    empty.locator('#era-filter').select_option('1960')
    empty.locator('#genre-filter').select_option('rock')
    empty.locator('#apply-filters').click()
    empty.locator('#play-button').click()
    expect(empty.locator('#feedback')).to_contain_text('No playable songs match all these filters.')
    expect(empty.locator('#play-button')).to_be_enabled()
    empty.locator('[data-action="edit-filters"]').click()
    expect(empty.locator('#era-filter')).to_be_focused()
    empty.locator('#reset-filters').click()
    empty.locator('#apply-filters').click()
    play(empty)
    print('PASS: empty combinations explain the problem and recover without unrelated fallback songs')

    failed = new_page()
    failed.route('https://itunes.apple.com/**', lambda route: route.abort())
    failed.locator('#album-filter').click()
    failed.locator('#filter-picker-query').fill('Unreachable album')
    expect(failed.locator('#picker-status')).to_contain_text('couldn’t be reached')
    failed.keyboard.press('Escape')
    expect(failed.locator('#album-filter-value')).to_have_text('Any album')
    print('PASS: picker network failure and Escape preserve selections')

    mobile = new_page(390)
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
    mobile.screenshot(path='/tmp/offbeat-dark-mobile.png', full_page=True)
    mobile.locator('#album-filter').click()
    mobile.locator('#filter-picker-query').fill('Neon')
    expect(mobile.locator('.filter-result')).to_have_count(3)
    mobile.locator('.filter-result').first.click()
    expect(mobile.locator('#artist-filter-value')).to_have_text('Queen')
    expect(mobile.locator('#album-filter-value')).to_have_text('Neon Nights')
    mobile.locator('#artist-filter').click()
    mobile.locator('#filter-picker-query').fill('Queen')
    expect(mobile.locator('.filter-result')).to_have_count(2)
    mobile.locator('.filter-result').last.click()
    expect(mobile.locator('#album-filter-value')).to_have_text('Any album')
    print('PASS: mobile pickers, album selection sets artist, changing artists clears an incompatible album')
    assert any(item.get('entity') == ['musicArtist'] for item in requests)
    assert any(item.get('id') == ['100'] for item in requests)
    assert errors == [], errors
    print('PASS: no uncaught browser errors; catalog calls were mocked, not live-verified')
    browser.close()
