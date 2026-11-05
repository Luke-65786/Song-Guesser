"""Round choices, persistent favorites, and balanced artist playlists.

Catalog responses are mocked; all played previews use actual included audio.
"""
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('OFFBEAT_TEST_URL','http://127.0.0.1:3000').rstrip('/')+'/'
ARTISTS=[{'artistId':i,'artistName':name,'primaryGenreName':'Rock'} for i,name in [(10,'Aster'),(20,'Blue Hour'),(30,'Silent Artist'),(40,'Blocked Artist')]]
SLUGS=['neon-avenue','sunday-somewhere','after-hours','golden-state','paper-planes']
DEMO_TITLES=dict(zip(SLUGS,['Neon Avenue','Sunday Somewhere','After Hours','Golden State','Paper Planes']))
def songs(artist):
    name=next(item['artistName'] for item in ARTISTS if item['artistId']==artist)
    count=12 if artist==10 else 8 if artist==20 else 0 if artist==30 else 5
    return [{'kind':'song','trackId':artist*100+i,'trackName':f'{name} Track {i+1}','artistId':artist,'artistName':name,'collectionId':artist*10,'collectionName':'Artist Collection','primaryGenreName':'Rock','releaseDate':'2015-01-01','previewUrl':BASE+'audio/'+SLUGS[i%5]+f'.wav?artist={artist}&track={i+1}'} for i in range(count)]

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1100},reduced_motion='reduce')
    errors=[]
    blocked=True
    def respond(route):
        params=parse_qs(urlparse(route.request.url).query)
        if params.get('entity')==['musicArtist']:
            results=ARTISTS
        elif params.get('id'):
            artist=int(params['id'][0])
            if artist==40 and blocked:
                route.abort();return
            results=songs(artist)
        else:
            results=songs(10)+songs(20)
        route.fulfill(status=200,content_type='text/javascript',body=params['callback'][0]+'('+json.dumps({'results':results})+');')
    context.route('https://itunes.apple.com/**',respond)
    def new_page(width=1440):
        page=context.new_page()
        page.set_viewport_size({'width':width,'height':1100 if width>700 else 844})
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(BASE,wait_until='networkidle')
        return page
    def custom(page,count):
        page.locator('#rounds-select').select_option('custom')
        page.locator('#custom-round-count').fill(str(count))
    def listen(page):
        page.locator('#play-button').click()
        page.wait_for_function('document.querySelector("#audio").paused && document.querySelector("#audio").currentTime>=.1')
        return page.locator('#audio').get_attribute('src')
    def correct(page,title):
        page.locator('#guess-input').fill(title)
        page.locator('#guess-button').click()
        expect(page.locator('#result')).to_contain_text('THAT’S THE ONE!')
    def search(page):
        page.locator('#find-playlist-artists').click()
        page.locator('#filter-picker-query').fill('Artists')
        expect(page.locator('.artist-search-result')).to_have_count(4)

    page=new_page()
    expect(page.locator('#shuffle-playlist')).to_be_disabled()
    custom(page,1)
    page.locator('#demo-button').click()
    expect(page.locator('#round-total')).to_have_text('01')
    src=listen(page)
    custom(page,3)
    page.locator('#apply-filters').click()
    expect(page.locator('#modal-title')).to_have_text('A fresh set of songs?')
    page.locator('[data-action="cancel-restart"]').click()
    expect(page.locator('#round-total')).to_have_text('01')
    correct(page,DEMO_TITLES[Path(urlparse(src).path).stem])
    page.locator('#next-button').click()
    expect(page.locator('#modal-body')).to_contain_text('1/1')
    page.locator('[data-action="again"]').click()
    expect(page.locator('#custom-round-count')).to_have_value('1')
    print('PASS: arbitrary round count, a completed one-round session, confirmation cancel, and replay preserve active settings',flush=True)

    page.reload(wait_until='networkidle')
    custom(page,0)
    page.locator('#apply-filters').click()
    assert not page.locator('#custom-round-count').evaluate('(e)=>e.checkValidity()')
    expect(page.locator('#round-total')).to_have_text('05')
    custom(page,50)
    page.locator('#demo-button').click()
    expect(page.locator('#round-total')).to_have_text('05')
    expect(page.locator('#feedback')).to_contain_text('5 unique songs')
    page.reload(wait_until='networkidle')
    page.locator('#rounds-select').select_option('random')
    page.locator('#apply-filters').click()
    total=int(page.locator('#round-total').inner_text())
    assert 5<=total<=20,total
    listen(page)
    expect(page.locator('#round-total')).to_have_text(str(total).zfill(2))
    listen(page)
    expect(page.locator('#round-total')).to_have_text(str(total).zfill(2))
    custom(page,3)
    page.locator('#apply-filters').click()
    page.locator('[data-action="confirm-restart"]').click()
    expect(page.locator('#round-total')).to_have_text('03')
    print('PASS: invalid counts blocked, short libraries capped without repeats, random 5–20 drawn once per session, and confirmation applies a new count',flush=True)

    page=new_page()
    search(page)
    page.get_by_role('button',name='Like Aster',exact=True).click()
    page.get_by_role('button',name='Add Aster to playlist',exact=True).click()
    page.get_by_role('button',name='Like Blue Hour',exact=True).click()
    page.get_by_role('button',name='Add Blue Hour to playlist',exact=True).click()
    page.locator('.filter-result').first.click()
    expect(page.locator('.playlist-artist-chip')).to_have_count(2)
    page.locator('#clear-picker').click()
    page.reload(wait_until='networkidle')
    expect(page.locator('#liked-count')).to_have_text('2')
    expect(page.locator('.playlist-artist-chip')).to_have_count(2)
    page.locator('#liked-artists-button').click()
    expect(page.locator('.liked-artist-row')).to_have_count(2)
    page.get_by_role('button',name='Unlike Aster',exact=True).click()
    expect(page.locator('#liked-count')).to_have_text('1')
    expect(page.locator('.playlist-artist-chip')).to_have_count(2)
    page.locator('#add-liked-to-playlist').click()
    expect(page.locator('.playlist-artist-chip')).to_have_count(2)
    page.locator('#find-liked-artists').click()
    page.locator('#filter-picker-query').fill('Artists')
    page.get_by_role('button',name='Like Aster',exact=True).click()
    page.locator('#clear-picker').click()
    print('PASS: search hearts and multi-artist additions, duplicate prevention, saved favorites/playlist across reload, and independent unlike/remove behavior',flush=True)

    custom(page,6)
    page.locator('#shuffle-playlist').click()
    expect(page.locator('#mix-label')).to_contain_text('Artist playlist · 2 artists')
    artists=[];tracks=[]
    for index in range(6):
        src=listen(page)
        params=parse_qs(urlparse(src).query)
        artist=int(params['artist'][0]);track=int(params['track'][0])
        artists.append(artist);tracks.append((artist,track))
        if index==0:
            page.get_by_role('button',name='Remove Blue Hour from playlist',exact=True).click()
        name='Aster' if artist==10 else 'Blue Hour'
        correct(page,f'{name} Track {track}')
        page.locator('#next-button').click()
    assert artists.count(10)==3 and artists.count(20)==3,artists
    assert len(set(tracks))==6,tracks
    expect(page.locator('#modal-body')).to_contain_text('6/6')
    expect(page.locator('#modal-body')).to_contain_text('6,000')
    page.locator('[data-action="again"]').click()
    expect(page.locator('#custom-round-count')).to_have_value('6')
    page.reload(wait_until='networkidle')
    expect(page.locator('.playlist-artist-chip')).to_have_count(1)
    expect(page.locator('#liked-count')).to_have_text('2')
    page.locator('#clear-playlist').click()
    expect(page.locator('#shuffle-playlist')).to_be_disabled()
    page.locator('#liked-artists-button').click()
    page.locator('#add-liked-to-playlist').click()
    expect(page.locator('.playlist-artist-chip')).to_have_count(2)
    page.locator('#shuffle-liked-artists').click()
    expect(page.locator('#mix-label')).to_contain_text('Liked artists mix · 2 artists')
    print('PASS: completed six-round balanced shuffle, unique tracks, active playlist snapshot, saved removals, Add all liked, and Shuffle liked',flush=True)

    page=new_page()
    page.locator('#clear-playlist').click()
    search(page)
    page.get_by_role('button',name='Add Aster to playlist',exact=True).click()
    page.get_by_role('button',name='Add Blocked Artist to playlist',exact=True).click()
    page.locator('#clear-picker').click()
    page.locator('#shuffle-playlist').click()
    page.locator('#play-button').click()
    expect(page.locator('#feedback')).to_contain_text('Couldn’t load Blocked Artist')
    expect(page.locator('#play-button')).to_be_enabled()
    assert page.locator('#audio').get_attribute('src') is None
    blocked=False
    listen(page)
    expect(page.locator('#round-total')).to_have_text('05')
    print('PASS: one unavailable artist blocks silent omission and the same session recovers after a successful retry',flush=True)

    mobile=new_page(390)
    for width in [1440,768,390,320]:
        mobile.set_viewport_size({'width':width,'height':1100 if width>700 else 844})
        assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
    mobile.set_viewport_size({'width':390,'height':844})
    mobile.screenshot(path='/tmp/offbeat-library-mobile.png',full_page=True)
    custom(mobile,0)
    mobile.locator('#liked-artists-button').click()
    mobile.locator('#shuffle-liked-artists').click()
    expect(mobile.locator('#modal')).to_be_hidden()
    expect(mobile.locator('#custom-round-count')).to_be_focused()
    custom(mobile,1)
    mobile.locator('#liked-artists-button').click()
    assert mobile.locator('#modal').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
    mobile.screenshot(path='/tmp/offbeat-liked-artists-mobile.png',full_page=True)
    mobile.locator('#shuffle-liked-artists').click()
    expect(mobile.locator('#round-total')).to_have_text('01')
    assert errors==[],errors
    print('PASS: desktop/tablet/narrow-phone layouts, liked modal, validation from a modal action, and no browser errors',flush=True)
    browser.close()
