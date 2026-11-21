# Siegeworks design log

## 2026-11-20 — Prototype 0
- Goal: prove the async physics-siege loop is FUN before any chain work.
- Live page: private Claude artifact for playtesting (link kept outside the repo)
- Source: sim/core.js (shared sim, node-testable) + page.src.html -> `python3 build.py` -> siegeworks.html, publish that file.
- Engine: planck.js 1.4.2 (Box2D port), fixed 1/60 tick. Determinism is same-engine only; cross-platform
  bit-exact determinism is Phase 2 (Rust fixed-point or Rapier enhanced-determinism).
- Damage = impact energy above 2.2 m/s approach speed (resting loads never hurt). Hearts are the win condition.
- Fort code SW1.<name>.<6 chars/piece>; siege plan SP1.<ammo,tick,angle,power>; result hash = FNV over final state.
- Tuning baseline (sim/test.js, random 5-shot plans): Watchtower 15% breach, Bunker 6%, Wall and Keep 7%.
- Community plan is pending the owner's answers (accounts, name, AI disclosure).

## 2026-11-20 — Prototype 0.2
- Owner put Claude in charge of the project; Claude asks only for help (accounts, spending) or feedback (fun).
- Cross-engine determinism: native Math.sin/cos make 9/600 sieges diverge between engines (even V8 builds);
  sim/detmath.js (fdlibm kernels in pure arithmetic) gives 600/600 identical in V8, JSC, SpiderMonkey.
  planck caches Math.sin/cos at load, so detmath must install BEFORE planck.js.
- v0.1 bug fixed: live shots kept unrounded angle/power while plan codes round them, so replays could mismatch.
  Shots are now quantized at fire time (quantizeShot).
- Balance: the solver one-shot most forts with the fire pot (blast flattened hearts through stone). The pot now
  burns by material (wood 1, stone 0.25, iron 0.08, heart 0.04), radius 3.5 m, power 900.
- Campaign "Proving Grounds": 8 forts, pars from `node solve.js 6 200` (par = fewest shots, +1 when under half of
  slightly-off final shots still breach). Random-plan breach rates fall from 32% (Outpost) to 0% (Citadel, Bunker).
- Validation: checkFort runs 390 ticks; no heart or piece may break. Heart lost before the first shot = 'collapsed'.
- Result hash now includes VERSION (sim-0.2), so any physics change can never silently match old results.
- Site: GitHub Pages from /docs. Artifact playtest link built from dist/artifact.html.
- Next: the fort board (season 0 ledger on GitHub: issues = transactions, Actions = validators replaying sieges).

## 2026-11-20 — Prototype 0.3: the season 0 board
- Board = GitHub issues as transactions, ledger.yml Action as validator, docs/ledger/ledger.json as a hash chain.
  Entries are immutable (stats are derived, not hashed); the validator verifies the whole chain before appending
  and fails the run on tampering. Rules: fort must stand + fit budget, no duplicate forts, no copied plans,
  own-fort sieges recorded but not counted, 3 forts and 30 sieges per user per UTC day.
- Checked end to end locally: a siege played in the browser and the validator's replay give the same hash.
- Balance: one flat boulder throw breached Founders' Keep (and several campaign forts) every time. The boulder now
  launches at 0.72x speed (heavy shot, slower throw). Founders' Keep then took 2-3 shots with varied winning lines.
  VERSION -> sim-0.3 (results tagged sim-0.2 no longer match by design). Re-solved pars: Iron Gate 2 -> 1.
- Cross-engine battery at sim-0.3: 800/800 identical in V8, JSC, SpiderMonkey.
- LIVE 2026-11-20: issue #1 posted Founders' Keep -> validator accepted it as F1 (ledger entry 1). Issue #2 sieged it
  (SP1.p2i~63~ig.s7i~9m~jh, own fort so not counted) -> breached in 2, hash d406fa94 on GitHub's runner = d406fa94
  locally. Public board shows F1 unbroken; #F1 deep link works; chain verifies.
- ARM determinism still untested. Cheapest test: on a phone or Apple Silicon Mac open the site at #F1, load that
  plan, and check the result hash reads d406fa94.
- Next: owner's fun verdict; community accounts (need owner: phone verification); auto-rendered siege clips for
  social posts (deterministic replay -> video via headless browser + ffmpeg).
