"""Scoped song suggestions with mocked catalog responses and real local audio."""
import json
import os
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('OFFBEAT_TEST_URL','http://127.0.0.1:3000').rstrip('/')+'/'
ARTISTS=[{'artistId':10,'artistName':'Queen','primaryGenreName':'Rock'},{'artistId':20,'artistName':'ABBA','primaryGenreName':'Pop'},{'artistId':30,'artistName':'Other Artist','primaryGenreName':'Rock'}]
DATA=[(1,'Shared Hit',10,100,'1981','Rock'),(2,'Shared Hit',20,200,'1981','Rock'),(3,'Deep Cut',10,100,'1985','Rock'),(4,'Shared Remix',10,101,'1991','Rock'),(5,'Shared Pop',10,100,'1983','Pop'),(6,'Shared Other',30,300,'1982','Rock'),(7,'Shared Disco',20,200,'1982','Pop'),(8,'Shared Second',10,101,'1984','Rock')]
SONGS=[{'kind':'song','trackId':i,'trackName':title,'artistId':artist,'artistName':next(a['artistName'] for a in ARTISTS if a['artistId']==artist),'collectionId':album,'collectionName':'Record A' if album==100 else 'Record B','releaseDate':year+'-01-01','primaryGenreName':genre,'previewUrl':BASE+'audio/neon-avenue.wav'} for i,title,artist,album,year,genre in DATA]
ALBUMS=[{'collectionId':100,'collectionName':'Record A','artistId':10,'artistName':'Queen'},{'collectionId':101,'collectionName':'Record B','artistId':10,'artistName':'Queen'}]

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1100},reduced_motion='reduce')
    errors=[]
    def fulfill(route,results):
        params=parse_qs(urlparse(route.request.url).query)
        route.fulfill(status=200,content_type='text/javascript',body=params['callback'][0]+'('+json.dumps({'results':results})+');')
    def respond(route):
        entity=parse_qs(urlparse(route.request.url).query).get('entity')
        fulfill(route,ARTISTS if entity==['musicArtist'] else ALBUMS if entity==['album'] else SONGS)
    context.route('https://itunes.apple.com/**',respond)
    def new_page():
        page=context.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(BASE,wait_until='networkidle')
        return page
    def search(page,query,count):
        page.locator('#guess-input').fill(query)
        expect(page.locator('#suggestions')).to_be_visible()
        expect(page.locator('.suggestion')).to_have_count(count)
        return page.locator('.suggestion').evaluate_all('(els)=>els.map(e=>e.querySelector("strong").textContent+"|"+e.querySelector("small").textContent)')
    def choose_artist(page):
        page.locator('#artist-filter').click()
        page.locator('#filter-picker-query').fill('Queen')
        expect(page.locator('.filter-result')).to_have_count(3)
        page.locator('.filter-result').first.click()
    def play(page):
        page.locator('#play-button').click()
        page.wait_for_function('document.querySelector("#audio").paused && document.querySelector("#audio").currentTime>=.1')

    artist=new_page()
    artist.locator('#rounds-select').select_option('custom')
    artist.locator('#custom-round-count').fill('1')
    choose_artist(artist)
    artist.locator('#apply-filters').click()
    assert all(pair.endswith('|Queen') for pair in search(artist,'Shared',4))
    expect(artist.locator('#guess-input')).to_have_value('Shared')
    expect(artist.locator('#search-scope')).to_contain_text('Queen')
    play(artist)
    expect(artist.locator('#round-total')).to_have_text('01')
    pairs=search(artist,'Queen',5)
    assert 'Deep Cut|Queen' in pairs
    requests=[]
    artist.on('request',lambda req:requests.append(req.url) if 'itunes.apple.com' in req.url else None)
    artist.route('https://itunes.apple.com/**',lambda route:route.abort())
    assert all(pair.endswith('|Queen') for pair in search(artist,'Shared',4))
    assert not requests,requests
    print('PASS: exact artist scope before/after starting, whole collection beyond a one-round deck, cached search without a network request',flush=True)

    album=new_page()
    choose_artist(album)
    album.locator('#album-filter').click()
    expect(album.locator('.filter-result')).to_have_count(2)
    album.locator('.filter-result').filter(has_text='Record A').click()
    album.locator('#era-filter').select_option('1980')
    album.locator('#genre-filter').select_option('rock')
    album.locator('#apply-filters').click()
    assert search(album,'Shared',1)==['Shared Hit|Queen']
    assert search(album,'Queen deep',1)==['Deep Cut|Queen']
    album.locator('#guess-input').fill('Not a matching title')
    expect(album.locator('.suggestion-message')).to_contain_text('No matching songs in this mix')
    print('PASS: album, artist, era and genre intersect; artist/title query word order and empty-result behavior',flush=True)

    genre=new_page()
    genre.locator('#era-filter').select_option('1980')
    genre.locator('#genre-filter').select_option('rock')
    genre.locator('#apply-filters').click()
    expected={'Shared Hit|Queen','Shared Hit|ABBA','Shared Other|Other Artist','Shared Second|Queen'}
    assert set(search(genre,'Shared',4))==expected
    genre.locator('#genre-filter').select_option('pop')
    assert set(search(genre,'Shared ',4))==expected
    expect(genre.locator('#search-scope')).to_contain_text('Rock')
    genre.locator('#apply-filters').click()
    assert set(search(genre,'Shared',2))=={'Shared Pop|Queen','Shared Disco|ABBA'}
    print('PASS: genre/era exclude unrelated releases and draft changes only apply to a newly started mix',flush=True)

    playlist=new_page()
    playlist.locator('#find-playlist-artists').click()
    playlist.locator('#filter-picker-query').fill('Artists')
    playlist.get_by_role('button',name='Add Queen to playlist',exact=True).click()
    playlist.get_by_role('button',name='Add ABBA to playlist',exact=True).click()
    playlist.locator('#clear-picker').click()
    playlist.locator('#era-filter').select_option('1980')
    playlist.locator('#genre-filter').select_option('rock')
    playlist.locator('#shuffle-playlist').click()
    expected_playlist={'Shared Hit|Queen','Shared Hit|ABBA','Shared Second|Queen'}
    assert set(search(playlist,'Shared',3))==expected_playlist
    playlist.locator('#find-playlist-artists').click()
    playlist.locator('#filter-picker-query').fill('Artists')
    playlist.get_by_role('button',name='Add Other Artist to playlist',exact=True).click()
    playlist.locator('#clear-picker').click()
    assert set(search(playlist,'Shared ',3))==expected_playlist
    playlist.locator('#shuffle-playlist').click()
    assert set(search(playlist,'Shared',4))==expected
    print('PASS: playlist searches use selected artist IDs and shared genre/era filters, with a stable active-session snapshot',flush=True)

    broad=new_page()
    assert 'Shared Other|Other Artist' in search(broad,'Shared',7)
    broad.locator('#demo-button').click()
    assert search(broad,'Offbeat Neon',1)==['Neon Avenue|Offbeat Originals']
    print('PASS: unrestricted catalog stays broad and demo searches stay in the local library',flush=True)

    stale=new_page()
    pending=[]
    def delay(route):
        params=parse_qs(urlparse(route.request.url).query)
        if params.get('term')==['Delayed']:
            pending.append(route)
        else:
            route.fallback()
    stale.route('https://itunes.apple.com/**',delay)
    stale.locator('#guess-input').fill('Delayed')
    for _ in range(100):
        if pending:break
        stale.wait_for_timeout(20)
    assert pending
    choose_artist(stale)
    stale.locator('#apply-filters').click()
    fulfill(pending[0],[{**SONGS[5],'trackName':'Delayed Wrong Artist'}])
    assert search(stale,'Deep',1)==['Deep Cut|Queen']
    stale.wait_for_timeout(100)
    expect(stale.locator('.suggestion')).to_have_count(1)
    expect(stale.locator('#suggestions')).not_to_contain_text('Wrong Artist')
    stale.set_viewport_size({'width':390,'height':844})
    assert stale.evaluate('document.documentElement.scrollWidth<=innerWidth')
    stale.screenshot(path='/tmp/offbeat-scoped-search-mobile.png',full_page=True)
    assert errors==[],errors
    print('PASS: old search replies cannot overwrite a new mix; mobile layout and no uncaught browser errors',flush=True)
    browser.close()
