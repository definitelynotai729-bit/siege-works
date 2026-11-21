# Siegeworks

A physics siege game where players build forts and other players lay siege to them.

This is **Prototype 0**. It tests one question: is the core loop fun? Building a fort, sharing it, and watching someone else try to bring it down.

The long-term goal is a persistent world that players own, run on its own proof-of-stake chain. In that world, forts and items are owned objects, sieges are transactions, and validators agree on outcomes by replaying the physics. None of that is built yet. The game has to be fun first.

## Play

Open `siegeworks.html` in a browser. It is a single self-contained file.

- **Siege:** drag backwards on the field to aim, or use the sliders, then release or press Fire. Destroy every red heart to win.
- **Build:** spend 800 gold on wood, stone and iron. Place at least one heart, then press "Siege it" or copy the fort code to share it.
- **Load:** paste a fort code (`SW1.…`) or a siege plan (`SP1.…`).

## How it works

| Piece | What it is | What it becomes on-chain |
|---|---|---|
| Fort code | The whole fort as one short string | An owned object others can attack |
| Siege plan | Each shot as ammo, tick, angle and power | The transaction an attacker submits |
| Result hash | A hash of the final world state | What validators compare after replaying the siege |

The simulation runs at a fixed 1/60 s tick, and every shot is tied to a tick, so replaying a plan gives the same result hash. Blocks take damage from impact energy above a 2.2 m/s approach speed, so resting weight never hurts a fort.

Determinism currently holds within one JavaScript engine. Bit-exact determinism across machines is the next technical milestone, likely through a fixed-point Rust engine.

## Layout

```
sim/core.js      simulation, codes, hashing (shared by the page and the tests)
sim/test.js      headless checks: forts stand, breach rates, replay hashes match
page.src.html    page template
build.py         inlines core.js into the page -> siegeworks.html
NOTES.md         design log
```

## Develop

```sh
cd sim && npm install && node test.js   # headless checks
cd .. && python3 build.py               # rebuild siegeworks.html
```

Built by a human and an AI (Claude) working together.
