"""Browser QA for the built page: plays a fort, runs a bot siege, checks the replay, takes screenshots.
Usage: python3 tools/qa.py [path-or-url] [outdir]"""
import sys, pathlib
from playwright.sync_api import sync_playwright

target = sys.argv[1] if len(sys.argv) > 1 else 'docs/index.html'
URL = target if target.startswith('http') else pathlib.Path(target).resolve().as_uri()
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/siege-qa'); out.mkdir(parents=True, exist_ok=True)
fails = []
hashes = {}

def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    for name, bt in (('chromium', p.chromium), ('webkit', p.webkit), ('firefox', p.firefox)):
        print(name)
        b = bt.launch()
        pg = b.new_page(viewport={'width': 1280, 'height': 900})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.add_init_script("try { localStorage.clear() } catch (e) {}")
        pg.goto(URL)
        pg.wait_for_function("document.querySelector('#status') && document.querySelector('#status').textContent.includes('hearts')", timeout=20000)
        check('outpost' in pg.inner_text('#fort-card').lower(), 'opens on fort 1, Outpost')
        check(pg.evaluate("Math.sin(1e5 + 0.1234567)") == -0.08758790441220896, 'deterministic trig installed')
        # the solver's one-shot line for Outpost: 20.0 degrees, 71.6% power
        t0 = pg.evaluate("performance.now()")
        pg.wait_for_function("!document.querySelector('#status').textContent.includes('settling')", timeout=20000)
        ms = pg.evaluate("performance.now()") - t0
        print(f'       fort settled (90 ticks) after {ms:.0f} ms of wall time')
        pg.evaluate("document.getElementById('angle').value='20.0'; document.getElementById('power').value='71.6'; document.getElementById('angle').dispatchEvent(new Event('input'))")
        pg.click('#fire')
        pg.wait_for_selector('#result-box:not([hidden]) .result', timeout=30000)
        res = pg.inner_text('#result-box')
        check('breached in 1 shot' in res.lower(), 'solver line breaches Outpost in one shot: ' + res.splitlines()[0])
        check('★★★' in res, 'three stars at par')
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(out / f'{name}-siege.png'))
        h1 = pg.evaluate("document.querySelector('.kv').innerText.match(/Result hash\\s+([0-9a-f]{8})/)[1]")
        pg.click('#replay')
        pg.wait_for_selector('#result-box:not([hidden]) .result', timeout=30000)
        check('Match.' in pg.inner_text('#result-box'), f'replay reproduces hash {h1}')
        # the same plan code must give the same hash in every engine
        pg.fill('#load-text', 'SP1.s2i~5k~jw'); pg.click('#load-btn')
        pg.wait_for_selector('#result-box:not([hidden]) .result', timeout=30000)
        plan_hash = pg.evaluate("document.querySelector('.kv').innerText.match(/Result hash\\s+([0-9a-f]{8})/)[1]")
        hashes[name] = plan_hash
        print('       plan SP1.s2i~5k~jw on Outpost -> hash', plan_hash)
        # builder: a small fort, then the bot
        pg.click('#tab-build')
        check(not pg.is_visible('#result-box'), 'result card hidden in build mode')
        pg.click('button[data-mat="s"]'); pg.click('button[data-shape="V"]')
        box = pg.locator('#field').bounding_box()
        def at(x, y):  # world metres -> page pixels
            sc = box['width'] / 62
            return box['x'] + (x + 1) * sc, box['y'] + (23 - y) * sc
        for x in (40.25, 43.25):
            pg.mouse.click(*at(x, 1.0))
        pg.click('button[data-mat="w"]'); pg.click('button[data-shape="L"]')
        pg.mouse.click(*at(41.75, 2.25))
        pg.click('button[data-mat="h"]')
        pg.mouse.click(*at(41.75, 3.0))
        n = pg.evaluate("JSON.parse(localStorage.getItem('sw_draft')||'[]').length")
        check(n == 4, f'placed 4 pieces by clicking (got {n})')
        pg.screenshot(path=str(out / f'{name}-build.png'))
        pg.click('#bot-fort')
        pg.wait_for_function("document.querySelector('#result-box:not([hidden]) .result') && /bot/i.test(document.querySelector('#result-box').innerText)", timeout=120000)
        res = pg.inner_text('#result-box')
        check('bot' in res.lower(), 'bot siege ran and replayed: ' + res.splitlines()[0])
        pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f'{name}-bot.png'))
        if name == 'chromium':
            ph = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            ph.on('pageerror', lambda e: errors.append(str(e)))
            ph.goto(URL)
            ph.wait_for_function("document.querySelector('#status').textContent.includes('hearts')", timeout=20000)
            ph.wait_for_timeout(1200)
            wide = ph.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
            check(not wide, 'no horizontal scroll at 390 px')
            ph.screenshot(path=str(out / 'phone.png'), full_page=True)
        check(not errors, 'no console errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))
        b.close()
check(len(set(hashes.values())) == 1, f'same plan, same hash in every engine: {hashes}')
print('\nall passed' if not fails else f'\n{len(fails)} FAILED')
sys.exit(1 if fails else 0)
