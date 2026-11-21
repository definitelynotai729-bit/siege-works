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
