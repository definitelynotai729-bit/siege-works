"""Board QA: serves docs/ locally with a sample ledger made by the real validator, then checks the Board tab,
deep links, and the GitHub submit links. Usage: python3 tools/qa_board.py"""
import json, os, pathlib, shutil, subprocess, sys, tempfile, threading, http.server, functools, urllib.parse
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
site = pathlib.Path(tempfile.mkdtemp(prefix='siege-board-'))
shutil.copy(ROOT / 'docs' / 'index.html', site / 'index.html')
(site / 'ledger').mkdir()
node = r'''
const SW = require('%s/sim/core.js'); const c = SW.campaign();
console.log(JSON.stringify([SW.encodeFort('Watchtower', c[2].pieces), SW.encodeFort('Bunker', c[7].pieces)]));
''' % ROOT
codes = json.loads(subprocess.run(['node', '-e', node], capture_output=True, text=True, check=True).stdout)
def tx(author, labels, body, n):
    env = dict(os.environ, ISSUE_BODY=body, ISSUE_AUTHOR=author, ISSUE_NUMBER=str(n), ISSUE_LABELS=labels, LEDGER_DIR=str(site / 'ledger'),
               RESULT_FILE=str(site / 'r.md'), STATUS_FILE=str(site / 's.txt'))
    subprocess.run(['node', str(ROOT / 'ledger' / 'validate.js')], env=env, check=True)
    return (site / 's.txt').read_text()
assert tx('alice', 'fort', codes[0], 1) == 'accepted'
assert tx('bob', 'fort', codes[1], 2) == 'accepted'
assert tx('carol', 'siege', 'F1 SP1.b2i~51~r3', 3) == 'accepted'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=str(site))
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/'
fails = []
def check(c, m):
    print(('  ok   ' if c else '  FAIL ') + m)
    if not c: fails.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(URL + '#board')
    pg.wait_for_selector('table.board tr[data-id]', timeout=20000)
    rows = pg.locator('table.board tbody tr').all_inner_texts()
    check(len(rows) == 2 and rows[0].startswith('F2') and 'Bunker' in rows[0], 'board lists 2 forts, newest first')
    check('1 shot · @carol' in rows[1], 'F1 shows the verified record by carol: ' + rows[1].replace('\t', ' | '))
    check('entry 3' in pg.inner_text('.board-head'), 'ledger entry count shown')
    pg.screenshot(path=str(site / 'board.png'))
    pg.click('button[data-siege="F2"]')
    pg.wait_for_function("document.querySelector('#fort-card').innerText.includes('F2')")
    check(pg.is_visible('#siege-tray') and 'BUNKER' in pg.inner_text('#fort-card').upper(), 'Siege button opens F2 in siege mode')
    pg.wait_for_function("!document.querySelector('#status').textContent.includes('settling')", timeout=20000)
    for k in range(5):
        pg.click('#fire'); pg.wait_for_timeout(300)
    pg.wait_for_selector('#result-box:not([hidden]) .result', timeout=60000)
    href = pg.get_attribute('#result-box a.act', 'href') or ''
    q = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
    check(href.startswith('https://github.com/definitelynotai729-bit/siege-works/issues/new') and q.get('template') == ['siege.yml'] and q.get('fort_id') == ['F2'] and q.get('plan_code', [''])[0].startswith('SP1.'),
          'result card links to a pre-filled siege issue: fort F2, ' + q.get('plan_code', ['?'])[0])
    plan = q.get('plan_code', [''])[0]
    status = tx('dave', 'siege', 'F2 ' + plan, 4)
    resmd = (site / 'r.md').read_text()
    page_hash = pg.evaluate("document.querySelector('.kv').innerText.match(/Result hash\\s+([0-9a-f]{8})/)[1]")
    check(status == 'accepted' and page_hash in resmd, f'the validator replays the browser siege to the same hash {page_hash}')
    pg2 = ctx.new_page(); pg2.on('pageerror', lambda e: errors.append(str(e)))
    pg2.goto(URL + '#F1')
    pg2.wait_for_function("document.querySelector('#fort-card').innerText.includes('F1')", timeout=20000)
    check(pg2.is_visible('#siege-tray'), 'deep link #F1 opens a siege on F1')
    pg2.click('#tab-build')
    box = pg2.locator('#field').bounding_box(); sc = box['width'] / 62
    pg2.click('button[data-mat="h"]'); pg2.mouse.click(box['x'] + 46 * sc, box['y'] + (23 - 0.5) * sc)
    with pg2.expect_popup() as pop:
        pg2.click('#post-fort')
    u = pop.value.url
    if '/login' in u:  # signed-out browsers go through GitHub's login first
        u = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)['return_to'][0]
    q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
    check(q.get('template') == ['fort.yml'] and q.get('fort_code', [''])[0].startswith('SW1.'), 'Post to the board opens a pre-filled fort issue: ' + q.get('fort_code', ['?'])[0])
    check(not errors, 'no page errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))
    b.close()
srv.shutdown()
print('\nall passed' if not fails else f'\n{len(fails)} FAILED'); print('artifacts in', site)
sys.exit(1 if fails else 0)
