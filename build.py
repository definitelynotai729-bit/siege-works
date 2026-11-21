# Inline sim/core.js into the page so the published artifact is one file.
import pathlib
root = pathlib.Path(__file__).parent
page = (root / 'page.src.html').read_text().replace('/*CORE*/', (root / 'sim' / 'core.js').read_text())
(root / 'siegeworks.html').write_text(page)
print('wrote siegeworks.html', len(page), 'bytes')
