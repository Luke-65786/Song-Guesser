"""Verify actual playback durations, the line player, and the hidden session panel."""
import os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('OFFBEAT_TEST_URL', 'http://127.0.0.1:3000').rstrip('/') + '/'
LENGTHS = [0.1, 0.5, 1, 3, 5, 10, 15]

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440, 'height':1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE, wait_until='networkidle')
    expect(page.locator('.session-column')).to_be_hidden()
    expect(page.locator('.waveform, .wave-bar')).to_have_count(0)
    expect(page.get_by_role('progressbar', name='Song clip playback')).to_be_visible()
    expect(page.locator('.clip-step')).to_have_text(['0.1s','0.5s','1s','3s','5s','10s','15s'])
    expect(page.locator('#attempt-label')).to_have_text('GUESS 1 OF 7')
    expect(page.locator('#skip-button span')).to_have_text('(+0.4 seconds)')
    page.screenshot(path='/tmp/offbeat-line-desktop.png', full_page=True)
    page.locator('#demo-button').click()
    for index, limit in enumerate(LENGTHS):
        expect(page.locator('#playback-line')).to_have_attribute('aria-valuemax', str(limit))
        page.locator('#play-button').click()
        page.wait_for_function('(limit) => { const a=document.querySelector("#audio"); return a.paused && a.currentTime >= limit; }', arg=limit, timeout=int(limit*1000)+5000)
        actual = page.locator('#audio').evaluate('(a) => a.currentTime')
        assert limit <= actual < limit+0.1, (limit, actual)
        expect(page.locator('#playback-line')).to_have_attribute('aria-valuenow', str(limit))
        assert page.locator('#playback-progress').evaluate('(el) => el.style.width') == '100%'
        expect(page.locator('#play-button')).to_have_attribute('aria-label', 'Play song clip')
        print(f'PASS: {limit}s clip stopped at {actual:.4f}s', flush=True)
        if index < len(LENGTHS)-1:
            page.locator('#skip-button').click()
            expect(page.locator('#attempt-label')).to_have_text(f'GUESS {index+2} OF 7')
            expect(page.locator('#result')).to_be_hidden()
    expect(page.locator('#skip-button span')).to_have_text('(reveal song)')
    page.locator('#skip-button').click()
    expect(page.locator('#result')).to_contain_text('ONE FOR YOUR PLAYLIST')
    expect(page.locator('#audio-time')).to_have_text('0:00.0 / 0:15.0')
    expect(page.locator('#playback-line')).to_have_attribute('aria-valuemax', '15')
    page.locator('#next-button').click()
    expect(page.locator('#attempt-label')).to_have_text('GUESS 1 OF 7')
    expect(page.locator('#playback-line')).to_have_attribute('aria-valuemax', '0.1')
    expect(page.locator('#playback-line')).to_have_attribute('aria-valuenow', '0')
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate('window.scrollTo(0,0)')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    expect(page.locator('.session-column')).to_be_hidden()
    page.screenshot(path='/tmp/offbeat-line-mobile.png', full_page=True)
    assert errors == [], errors
    print('PASS: reveal after seven chances, 15s reveal cap, next-round reset, hidden sidebar on desktop/mobile, and no browser errors', flush=True)
    browser.close()
