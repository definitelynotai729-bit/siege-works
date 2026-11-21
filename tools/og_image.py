"""Render docs/og.png, the 1200x630 link-preview image, from a real frame of the game.
Usage: python3 tools/og_image.py [tick=215] [out=docs/og.png]"""
import pathlib, base64, sys
TICK = int(sys.argv[1]) if len(sys.argv) > 1 else 215
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1600, 'height': 1000}, device_scale_factor=2)
    pg.add_init_script("try { localStorage.clear(); localStorage.setItem('sw_muted', '1') } catch (e) {}")
    pg.goto((ROOT / 'docs' / 'index.html').as_uri())
    pg.wait_for_function("document.querySelector('#status').textContent.includes('hearts')")
    pg.select_option('#fort-pick', '2')                       # Watchtower
    pg.fill('#load-text', 'SP1.b2i~51~r3'); pg.click('#load-btn')  # the solver's one-boulder line
    pg.add_style_tag(content='.titleblock { visibility: hidden !important; }')
    pg.wait_for_function("(() => { const m = document.querySelector('#titleblock').textContent.match(/tick (\\d+)/); return m && +m[1] >= %d; })()" % TICK, polling=16, timeout=30000)
    shot = pg.locator('#field').screenshot()
    b.close()
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1200, 'height': 630})
    img = base64.b64encode(shot).decode()
    pg.set_content(f'''<!doctype html><html><head>
    <link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@900&family=IBM+Plex+Mono:wght@500&display=block" rel="stylesheet">
    <style>
      body {{ margin: 0; width: 1200px; height: 630px; background: #0a2746; position: relative; overflow: hidden; }}
      img {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 80% 75%; }}
      .t {{ position: absolute; left: 56px; top: 44px; color: #e6f0fa; font: 900 120px/0.85 "Big Shoulders Display"; letter-spacing: 0.02em; text-transform: uppercase; }}
      .s {{ position: absolute; left: 60px; top: 160px; color: #ffcd4d; font: 500 26px "IBM Plex Mono"; letter-spacing: 0.04em; }}
    </style></head><body><img src="data:image/png;base64,{img}"><div class="t">Siegeworks</div><div class="s">Build a fort. Share its code. Watch it fall.</div></body></html>''')
    pg.wait_for_timeout(1500)
    pg.screenshot(path=sys.argv[2] if len(sys.argv) > 2 else str(ROOT / 'docs' / 'og.png'))
    b.close()
print('wrote', sys.argv[2] if len(sys.argv) > 2 else 'docs/og.png')
