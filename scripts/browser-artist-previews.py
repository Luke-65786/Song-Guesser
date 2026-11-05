"""Artist previews: mocked catalog metadata and actual local audio playback."""
import json
import os
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('OFFBEAT_TEST_URL', 'http://127.0.0.1:3000').rstrip('/') + '/'
ARTISTS = [{'artistId': i, 'artistName': name, 'primaryGenreName': 'Rock'} for i,name in [(10,'Queen'),(20,'Queen Tribute'),(30,'Silent Artist'),(40,'Retry Artist')]]
def song(i, title, slug, artist=10):
    return {'kind':'song', 'trackId':i, 'trackName':title, 'artistName':'Queen' if artist==10 else 'Queen Tribute', 'artistId':artist, 'collectionName':'Preview Collection', 'collectionId':100, 'releaseDate':'1981-01-01', 'primaryGenreName':'Rock', 'previewUrl':BASE+'audio/'+slug+'.wav'}
SONGS = [song(1,'Neon Avenue','neon-avenue'), song(2,'Sunday Somewhere','sunday-somewhere'), song(3,'Broken Clip','missing-preview'), song(4,'Golden State','golden-state'), song(5,'After Hours','after-hours'), song(6,'Extra Track','neon-avenue'), song(7,'Wrong Artist','paper-planes',20), {**song(8,'Unavailable','neon-avenue'), 'previewUrl':''}]

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1440,'height':1100}, reduced_motion='reduce')
    errors=[]
    retries=0
    def respond(route):
        global retries
        params=parse_qs(urlparse(route.request.url).query)
        if params.get('entity')==['musicArtist']:
            results=ARTISTS if params.get('term')!=['Other'] else ARTISTS[1:2]
        elif params.get('id')==['30']:
            results=[]
        elif params.get('id')==['40']:
            retries+=1
            if retries==1:
                route.abort(); return
            results=[song(40,'Recovered Song','after-hours',40)]
        elif params.get('id')==['20']:
            results=[song(20,'Tribute Song','paper-planes',20)]
        else:
            results=SONGS
        route.fulfill(status=200,content_type='text/javascript',body=params['callback'][0]+'('+json.dumps({'results':results})+');')
    context.route('https://itunes.apple.com/**',respond)
    def new_page(width=1440):
        page=context.new_page()
        page.set_viewport_size({'width':width,'height':1100 if width>700 else 844})
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(BASE,wait_until='networkidle')
        return page
    def search(page):
        page.locator('#artist-filter').click()
        page.locator('#filter-picker-query').fill('Queen')
        expect(page.locator('.artist-search-result')).to_have_count(4)
        expect(page.locator('.artist-song-panel:not([hidden]) .song-preview-row')).to_have_count(5)
    def play_preview(page,index=0):
        panel=page.locator('.artist-song-panel:not([hidden])')
        panel.locator('.song-preview-button').nth(index).click()
        page.wait_for_function('!document.querySelector("#artist-preview-audio").paused && document.querySelector("#artist-preview-audio").currentTime>.1')
        return panel

    page=new_page()
    search(page)
    panel=page.locator('.artist-song-panel:not([hidden])')
    expect(panel).not_to_contain_text('Wrong Artist')
    expect(panel).not_to_contain_text('Unavailable')
    expect(panel).not_to_contain_text('Extra Track')
    assert page.locator('#artist-preview-audio').get_attribute('src') is None
    assert page.locator('#artist-preview-audio').evaluate('(a)=>a.paused')
    page.screenshot(path='/tmp/offbeat-artist-previews-desktop.png',full_page=True)
    panel=play_preview(page)
    expect(panel.locator('.song-preview-button').first).to_have_attribute('aria-pressed','true')
    expect(page.locator('#score')).to_have_text('0')
    expect(page.locator('#attempt-label')).to_have_text('GUESS 1 OF 7')
    assert page.locator('#audio').evaluate('(a)=>a.paused')
    panel.locator('.song-preview-button').first.click()
    assert page.locator('#artist-preview-audio').evaluate('(a)=>a.paused')
    paused=page.locator('#artist-preview-audio').evaluate('(a)=>a.currentTime')
    page.wait_for_timeout(150)
    assert abs(page.locator('#artist-preview-audio').evaluate('(a)=>a.currentTime')-paused)<.02
    panel.locator('.song-preview-button').first.click()
    page.wait_for_function('(t)=>document.querySelector("#artist-preview-audio").currentTime>t+.1',arg=paused)
    page.wait_for_function('document.querySelector("#artist-preview-audio").paused && document.querySelector("#artist-preview-audio").currentTime>=15',timeout=18000)
    assert page.locator('#artist-preview-audio').evaluate('(a)=>a.currentTime')<15.1
    expect(panel.locator('.song-preview-button').first).to_have_attribute('aria-label','Replay Neon Avenue by Queen')
    print('PASS: automatic song list, identity filtering, five-track limit, no autoplay, real Play/Pause/resume, 15s cutoff, and unchanged game score',flush=True)

    play_preview(page)
    panel.locator('.song-preview-button').nth(1).click()
    page.wait_for_function('document.querySelector("#artist-preview-audio").currentTime>.1')
    assert 'sunday-somewhere' in page.locator('#artist-preview-audio').get_attribute('src')
    expect(panel.locator('.song-preview-button').first).to_have_attribute('aria-pressed','false')
    panel.locator('.song-preview-button').nth(2).click()
    expect(panel.locator('.song-preview-status')).to_contain_text('couldn’t play')
    assert page.locator('#artist-preview-audio').evaluate('(a)=>a.paused')
    play_preview(page)
    page.keyboard.press('Escape')
    expect(page.locator('#modal')).to_be_hidden()
    assert page.locator('#artist-preview-audio').evaluate('(a)=>a.paused')
    assert page.locator('#artist-preview-audio').get_attribute('src') is None
    print('PASS: one song at a time, unavailable audio recovery, and stopping on dialog close',flush=True)

    search(page)
    play_preview(page)
    page.get_by_role('button',name='Preview songs by Queen Tribute',exact=True).click()
    expect(page.locator('.artist-song-panel:not([hidden])')).to_contain_text('Tribute Song')
    assert page.locator('#artist-preview-audio').evaluate('(a)=>a.paused')
    page.get_by_role('button',name='Preview songs by Silent Artist',exact=True).click()
    expect(page.locator('.artist-song-panel:not([hidden])')).to_contain_text('No playable previews')
    page.get_by_role('button',name='Preview songs by Retry Artist',exact=True).click()
    expect(page.locator('.preview-retry')).to_be_visible()
    page.locator('.preview-retry').click()
    expect(page.locator('.artist-song-panel:not([hidden])')).to_contain_text('Recovered Song')
    page.get_by_role('button',name='Preview songs by Queen',exact=True).click()
    play_preview(page)
    page.locator('#filter-picker-query').fill('Other')
    assert page.locator('#artist-preview-audio').evaluate('(a)=>a.paused')
    expect(page.locator('.artist-search-result')).to_have_count(1)
    expect(page.locator('.artist-song-panel:not([hidden])')).to_contain_text('Tribute Song')
    page.locator('.filter-result').click()
    expect(page.locator('#artist-filter-value')).to_have_text('Queen Tribute')
    assert page.locator('#artist-preview-audio').get_attribute('src') is None
    print('PASS: artist switching, empty previews, retry after network failure, changing search, and choosing a filter',flush=True)

    legacy=new_page()
    legacy.locator('[data-preset="artist"]').click()
    legacy.locator('[data-artist="Queen"]').click()
    expect(legacy.locator('#artist-song-previews .song-preview-row')).to_have_count(5)
    expect(legacy.locator('#mix-label')).to_have_text('The everything mix')
    legacy.locator('#artist-song-previews .song-preview-button').first.click()
    legacy.wait_for_function('document.querySelector("#artist-preview-audio").currentTime>.1')
    legacy.locator('#start-artist-mix').click()
    expect(legacy.locator('#mix-label')).to_have_text('Queen mix')
    assert legacy.locator('#artist-preview-audio').get_attribute('src') is None
    print('PASS: artist-mix search previews before explicit start, and playback stops when starting the mix',flush=True)

    mobile=new_page(390)
    search(mobile)
    play_preview(mobile)
    assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert mobile.locator('#modal').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
    mobile.screenshot(path='/tmp/offbeat-artist-previews-mobile.png',full_page=True)
    mobile.locator('#close-modal').click()
    assert mobile.locator('#artist-preview-audio').evaluate('(a)=>a.paused')
    assert errors==[],errors
    print('PASS: mobile preview layout and controls, no horizontal overflow, no uncaught browser errors',flush=True)
    browser.close()
