# Run the siege battery in V8 (node + Chromium), JavaScriptCore (WebKit) and SpiderMonkey (Firefox), with and without deterministic trig.
import json, subprocess, sys, pathlib
from playwright.sync_api import sync_playwright
here = pathlib.Path(__file__).resolve().parent
n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
results = {}
for det in (False, True):
    r = json.loads(subprocess.run(['node', str(here / 'node_run.js'), 'det' if det else 'native', str(n)], capture_output=True, text=True, check=True).stdout)
    results[('node-v8', det)] = r
with sync_playwright() as p:
    for name, bt in (('chromium-v8', p.chromium), ('webkit-jsc', p.webkit), ('firefox-sm', p.firefox)):
        b = bt.launch()
        for det in (False, True):
            pg = b.new_page()
            pg.goto((here / 'harness.html').as_uri() + f'?n={n}' + ('&det=1' if det else ''))
            pg.wait_for_function('window.__out !== undefined', timeout=600000)
            results[(name, det)] = {'out': pg.evaluate('window.__out'), 'ms': pg.evaluate('window.__ms'), 'trig': pg.evaluate('window.__trig')}
            pg.close()
        b.close()
for det in (False, True):
    ref = results[('node-v8', det)]['out']
    print(('DETERMINISTIC trig' if det else 'NATIVE trig'), f'- {len(ref)} sieges, compared with node/V8')
    for (name, d), r in results.items():
        if d != det: continue
        diff = sum(1 for a, b in zip(ref, r['out']) if a != b)
        print(f"   {name:12s} {diff:4d} differ   {r['ms']/1000:6.1f}s   trig sample {r['trig']}")
json.dump({f'{k[0]}|{k[1]}': v for k, v in results.items()}, open(here / 'last_results.json', 'w'))
