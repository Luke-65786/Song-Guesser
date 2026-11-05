"""Difficulty and trending integration checks with sample charts and real local audio.

No request to Apple's live service is made by this test.
"""
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('OFFBEAT_TEST_URL', 'http://127.0.0.1:3000').rstrip('/') + '/'
AUDIO = (Path(__file__).resolve().parents[1] / 'public/audio/neon-avenue.wav').read_bytes()
SONGS = [{'kind': 'song', 'trackId': i, 'trackName': f'Catalog Song {i}', 'artistId': 10,
          'artistName': 'Sample Artist', 'collectionId': 100, 'collectionName': 'Sample Album',
          'primaryGenreName': 'Rock', 'releaseDate': '2015-01-01',
          'previewUrl': BASE + f'audio/neon-avenue.wav?id={i}'} for i in range(1, 13)]

def chart(country, unavailable=False):
    entries = []
    for rank in range(1, 9):
        entry = {'id': {'attributes': {'im:id': str(1000 + rank)}, 'label': f'https://music.apple.com/track/{rank}'},
                 'im:name': {'label': f'{country.upper()} Chart Song {rank}'},
                 'im:artist': {'label': 'Sample Chart Artist'},
                 'im:collection': {'im:name': {'label': 'Sample Chart Album'}},
                 'im:releaseDate': {'label': '2026-01-01'}, 'category': {'attributes': {'label': 'Pop'}}}
        if rank != 2 and not unavailable:
            entry['link'] = [{'attributes': {'rel': 'enclosure', 'type': 'audio/x-wav',
                             'href': f'https://itunes.apple.com/fixture-preview/{country}/{rank}.wav'}}]
        entries.append(entry)
    return {'feed': {'updated': {'label': '2026-11-05T12:00:00Z'}, 'entry': entries}}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    feed_mode = 'fetch'
    requests = []

    def respond(route):
        url = urlparse(route.request.url)
        params = parse_qs(url.query)
        requests.append(route.request.url)
        if '/fixture-preview/' in url.path:
            route.fulfill(status=200, content_type='audio/wav', body=AUDIO)
        elif '/rss/topsongs/' in url.path:
            if feed_mode == 'fail' or (feed_mode == 'jsonp' and route.request.resource_type == 'fetch'):
                route.abort()
                return
            data = chart(url.path.split('/')[1], feed_mode == 'unavailable')
            callback = params.get('callback', [None])[0]
            route.fulfill(status=200, content_type='text/javascript' if callback else 'application/json',
                          headers={'Access-Control-Allow-Origin': '*'},
                          body=f'{callback}({json.dumps(data)});' if callback else json.dumps(data))
        else:
            data = {'results': SONGS}
            route.fulfill(status=200, content_type='text/javascript', body=params['callback'][0] + '(' + json.dumps(data) + ');')

    context.route('https://itunes.apple.com/**', respond)

    def new_page():
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE, wait_until='networkidle')
        return page

    def listen(page, length):
        page.locator('#play-button').click()
        page.wait_for_function('(duration) => {const a=document.querySelector("#audio");return a.paused && a.currentTime>=duration;}', arg=length)
        elapsed = page.locator('#audio').evaluate('(a)=>a.currentTime')
        assert elapsed < length + .25, (length, elapsed)
        return page.locator('#audio').get_attribute('src')

    def clips(page, values):
        expect(page.locator('.clip-step')).to_have_text([str(value) + 's' for value in values])

    easy = new_page()
    clips(easy, [.1, .5, 1, 3, 5, 10, 15])
    easy.locator('#rounds-select').select_option('custom')
    easy.locator('#custom-round-count').fill('1')
    easy.locator('#regular-difficulty').select_option('easy')
    easy.locator('#play-regular-mix').click()
    clips(easy, [1, 3, 5, 10, 15])
    expect(easy.locator('#available-points')).to_have_text('800')
    source = listen(easy, 1)
    easy.locator('#hint-button').click()
    expect(easy.locator('#available-points')).to_have_text('650')
    easy.locator('#regular-difficulty').select_option('hard')
    easy.locator('#play-regular-mix').click()
    expect(easy.locator('#modal-title')).to_have_text('A fresh set of songs?')
    easy.locator('[data-action="cancel-restart"]').click()
    clips(easy, [1, 3, 5, 10, 15])
    number = parse_qs(urlparse(source).query)['id'][0]
    easy.locator('#guess-input').fill('Catalog Song ' + number)
    easy.locator('#guess-button').click()
    expect(easy.locator('.result-points')).to_have_text('+650')
    easy.locator('#next-button').click()
    easy.locator('[data-action="again"]').click()
    expect(easy.locator('#regular-difficulty')).to_have_value('easy')
    clips(easy, [1, 3, 5, 10, 15])
    print('PASS: Easy starts at 1s, correct points and hint deduction, draft/cancel behavior, completed session and replay retain difficulty', flush=True)

    hard = new_page()
    hard.locator('#regular-difficulty').select_option('hard')
    hard.locator('#play-regular-mix').click()
    clips(hard, [.1, .5, 1, 3, 5])
    expect(hard.locator('#hint-button')).to_be_disabled()
    listen(hard, .1)
    for _ in range(4):
        hard.locator('#skip-button').click()
    expect(hard.locator('#attempt-label')).to_have_text('GUESS 5 OF 5')
    listen(hard, 5)
    hard.locator('#skip-button').click()
    expect(hard.locator('#result')).to_be_visible()
    expect(hard.locator('#playback-line')).to_have_attribute('aria-valuemax', '15')
    hard.locator('#next-button').click()
    expect(hard.locator('#attempt-label')).to_have_text('GUESS 1 OF 5')
    expect(hard.locator('#hint-button')).to_be_disabled()
    hard.locator('#demo-button').click()
    hard.locator('[data-action="confirm-restart"]').click()
    clips(hard, [.1, .5, 1, 3, 5, 10, 15])
    expect(hard.locator('#hint-button')).to_be_enabled()
    expect(hard.locator('#difficulty-badge')).to_be_hidden()
    print('PASS: Hard disables hints, stops at 5s, reveals after five chances, resets next round; demo keeps standard rules', flush=True)

    filtered = new_page()
    filtered.locator('#regular-difficulty').select_option('hard')
    filtered.locator('#genre-filter').select_option('rock')
    filtered.locator('#apply-filters').click()
    clips(filtered, [.1, .5, 1, 3, 5, 10, 15])
    expect(filtered.locator('#hint-button')).to_be_enabled()
    print('PASS: filtered mixes keep standard difficulty despite the regular-mix selection', flush=True)

    page = new_page()
    expect(page.locator('#play-trending')).to_be_disabled()
    page.locator('#load-trending').click()
    expect(page.locator('#trending-status')).to_contain_text('United States · iTunes Top Songs · Updated')
    expect(page.locator('#trending-songs .song-preview-row')).to_have_count(5)
    expect(page.locator('#trending-songs .song-preview-number')).to_have_text(['1', '2', '3', '4', '5'])
    expect(page.get_by_role('button', name='Preview unavailable for US Chart Song 2 by Sample Chart Artist', exact=True)).to_be_disabled()
    page.get_by_role('button', name='Play US Chart Song 1 by Sample Chart Artist', exact=True).click()
    page.wait_for_function('!document.querySelector("#artist-preview-audio").paused')
    page.locator('#view-trending').click()
    assert page.locator('#artist-preview-audio').evaluate('(a)=>a.paused')
    expect(page.locator('#full-trending-chart .song-preview-row')).to_have_count(8)
    page.locator('[data-action="close"]').click()
    page.locator('#regular-difficulty').select_option('hard')
    page.locator('#rounds-select').select_option('50')
    page.locator('#play-trending').click()
    clips(page, [.1, .5, 1, 3, 5, 10, 15])
    expect(page.locator('#hint-button')).to_be_enabled()
    expect(page.locator('#search-scope')).to_contain_text('this trending chart')
    page.locator('#guess-input').fill('US Chart')
    expect(page.locator('.suggestion')).to_have_count(7)
    expect(page.locator('#suggestions')).not_to_contain_text('Song 2')
    page.get_by_role('button', name='Play US Chart Song 1 by Sample Chart Artist', exact=True).click()
    page.wait_for_function('!document.querySelector("#artist-preview-audio").paused')
    listen(page, .1)
    assert page.locator('#artist-preview-audio').evaluate('(a)=>a.paused')
    expect(page.locator('#round-total')).to_have_text('07')
    expect(page.locator('#feedback')).to_contain_text('7 unique playable songs')
    page.locator('#trending-country').select_option('gb')
    expect(page.locator('#trending-status')).to_contain_text('United Kingdom')
    expect(page.locator('#trending-songs')).to_contain_text('GB Chart Song 1')
    page.locator('#guess-input').fill('US Chart ')
    expect(page.locator('.suggestion')).to_have_count(7)
    expect(page.locator('#mix-label')).to_contain_text('US iTunes chart')
    print('PASS: source/date/ranks, unavailable previews, real audio preview, full chart, scoped playable chart mix, round cap and stable active snapshot', flush=True)

    feed_mode = 'fail'
    page.locator('#load-trending').click()
    expect(page.locator('#trending-status')).to_contain_text('No chart is being shown')
    expect(page.locator('#trending-songs')).to_be_hidden()
    expect(page.locator('#play-trending')).to_be_disabled()
    expect(page.locator('#load-trending')).to_have_text('Retry chart')
    feed_mode = 'jsonp'
    page.locator('#load-trending').click()
    expect(page.locator('#trending-songs')).to_be_visible()
    expect(page.locator('#play-trending')).to_be_enabled()
    assert any('callback=offbeat_chart_' in request for request in requests)
    print('PASS: failed refresh clears stale chart, retry recovers through JSONP when fetch is blocked', flush=True)

    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='/tmp/offbeat-difficulty-trending-mobile.png', full_page=True)
    page.set_viewport_size({'width': 320, 'height': 740})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width': 1440, 'height': 1100})
    page.screenshot(path='/tmp/offbeat-difficulty-trending-desktop.png', full_page=True)
    feed_mode = 'unavailable'
    page.locator('#load-trending').click()
    expect(page.locator('#trending-songs')).to_be_visible()
    expect(page.locator('#play-trending')).to_be_disabled()
    assert errors == [], errors
    print('PASS: 320px/390px/desktop layouts, chart without previews remains browsable, no uncaught browser errors', flush=True)
    browser.close()
