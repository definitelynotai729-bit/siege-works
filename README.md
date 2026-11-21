# Siegeworks

**Play: https://definitelynotai729-bit.github.io/siege-works/**

A physics siege game. Build a fort, share its code, and watch other people try to bring it down.

This is **prototype 0.2**. It tests one question: is the core loop fun? The long-term goal is a persistent world that players own, run on its own proof-of-stake chain. There, forts are owned objects, sieges are transactions, and validators agree on every outcome by replaying the physics. None of the chain exists yet. The game has to be fun first.

## What's in 0.2

- **Proving Grounds:** eight forts with par scores and stars. A search bot breached every one, so each is beatable, and its fewest-shot line sets the par.
- **Builder:** spend 800 gold on wood, stone and iron. A fort must stand on its own before you can share it.
- **Bot siege:** a search bot simulates about 200 shots against your fort, then replays its best attack.
- **Materials matter:** fire pots burn wood but barely scorch stone or iron. Boulders are heavy and you only get one.
- **Share codes:** fort codes (`SW1.…`) and siege plans (`SP1.…`) are short strings you can paste anywhere.
- **Same result in every browser:** see below.

## Deterministic across browsers

Validators can only agree on a siege if every machine computes the identical result. JavaScript's `Math.sin` and `Math.cos` are allowed to differ between engines, and they do. In a 600-siege test battery, **9 sieges (1.5%) ended differently** in Chromium, WebKit or Firefox than in Node, even though all use standard JavaScript. Even two builds of V8 disagreed.

`sim/detmath.js` replaces sine, cosine and arctangent with ports of the FreeBSD/fdlibm kernels written only in `+ − × ÷`, which IEEE 754 makes bit-exact everywhere. They stay within 1 ulp of the true value. With them installed, **all 600 sieges are bit-identical in V8, JavaScriptCore and SpiderMonkey**, and every result hash matches. The test is `sim/crossengine/run_all.py`.

That was measured on x86-64. ARM (phones, Apple Silicon) should match because JavaScript forbids fused multiply-add, but that has not been tested yet.

## How it works

| Piece | What it is | What it becomes on-chain |
|---|---|---|
| Fort code | The whole fort as one short string | An owned object others can attack |
| Siege plan | Each shot as ammo, tick, angle and power | The transaction an attacker submits |
| Result hash | A hash of the final world state, tagged with the sim version | What validators compare after replaying the siege |

The simulation runs at a fixed 1/60 s tick, and every shot is tied to a tick, so replaying a plan reproduces the siege exactly. Blocks take damage from impact energy above a 2.2 m/s approach speed, so resting weight never hurts a fort. A heart lost before the first shot counts as a collapse, never a win.

## Layout

```
sim/core.js              rules: simulation, validation, codes, hashing, campaign forts
sim/detmath.js           deterministic sin/cos/atan2 (load before planck.js)
sim/test.js              headless test suite
sim/solve.js             offline solver: proves forts are breachable and sets par
sim/crossengine/         determinism battery across V8, JavaScriptCore and SpiderMonkey
src/page.html, src/*.js  page, sound and game UI
build.py                 builds docs/index.html (the site) and dist/artifact.html
tools/qa.py              plays the built page in Chromium, WebKit and Firefox
tools/og_image.py        renders the link-preview image from a real game frame
NOTES.md                 design log
```

## Develop

```sh
cd sim && npm install && npm test        # rules, validation, replay determinism
node solve.js                            # re-derive campaign pars after any physics change
cd .. && python3 build.py                # rebuild docs/index.html
python3 tools/qa.py                      # browser checks (needs Playwright)
python3 sim/crossengine/run_all.py 200   # cross-engine determinism battery
```

## Feedback

Open an issue with what felt good, what felt wrong, and any fort codes or siege plans that show it.

Built by a human and an AI (Claude) working together.
