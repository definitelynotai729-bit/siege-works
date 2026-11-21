"""Build Siegeworks into two single-file pages from one source.

  dist/artifact.html  body-only page for the Claude artifact playtest link (the host adds the document skeleton)
  docs/index.html     complete standalone page served by GitHub Pages; also opens straight from disk

Run: python3 build.py
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent
PLANCK = ('https://cdn.jsdelivr.net/npm/planck@1.4.2/dist/planck.min.js',
          'sha384-xY4S6dc6Vu+8Cv16ym4qwZBihhOsPVvNvPeQVZqiD5DGVIT01vWU/UYBqvERy4Io')
SITE = 'https://definitelynotai729-bit.github.io/siege-works/'


def read(rel):
    text = (ROOT / rel).read_text()
    if '</script' in text.lower():
        raise SystemExit(f'{rel} contains a closing script tag and cannot be inlined')
    return text


page = (ROOT / 'src' / 'page.html').read_text()
head, body = page.split('<!--BODY-->')
head = head.replace('<!--HEAD-->', '').strip()
body = body.replace('<!--SCRIPTS-->', '').strip()

# detmath must be installed before planck loads, because planck caches Math.sin/Math.cos at load time
scripts = '\n'.join([
    '<script>\n' + read('sim/detmath.js') + '\nSWDetMath.install();\n</script>',
    f'<script src="{PLANCK[0]}" integrity="{PLANCK[1]}" crossorigin="anonymous"></script>',
    '<script>\n' + read('sim/core.js') + '\n</script>',
    '<script>\n' + read('src/audio.js') + '\n</script>',
    '<script>\n' + read('src/game.js') + '\n</script>',
])

artifact = head + '\n' + body + '\n' + scripts + '\n'
(ROOT / 'dist').mkdir(exist_ok=True)
(ROOT / 'dist' / 'artifact.html').write_text(artifact)

desc = re.search(r'<meta name="description" content="([^"]*)"', head).group(1)
pages_head = head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
standalone = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta property="og:title" content="Siegeworks">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="{SITE}">
<meta property="og:image" content="{SITE}og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%230e3358'/%3E%3Cpath d='M8 2l5 6-5 6-5-6z' fill='%23ff5a6a'/%3E%3C/svg%3E">
{pages_head}
<style>:root {{ padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }}</style>
</head>
<body>
{body}
{scripts}
</body>
</html>
'''
(ROOT / 'docs').mkdir(exist_ok=True)
(ROOT / 'docs' / 'index.html').write_text(standalone)
(ROOT / 'docs' / '.nojekyll').write_text('')
print(f'dist/artifact.html {len(artifact):,} bytes, docs/index.html {len(standalone):,} bytes')
