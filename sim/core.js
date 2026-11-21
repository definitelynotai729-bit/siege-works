// Siegeworks core simulation. Pure logic, no rendering.
// Shared verbatim by the browser page and the headless node tests.
// Fixed 1/60 s timestep; every shot is keyed to a tick so a siege replays exactly.
(function (root) {
  const DT = 1 / 60;
  const GRID = 0.5;                    // metres per build-grid cell
  const ZONE = { x0: 60, x1: 112, y1: 36 }; // build zone in grid cells (30..56 m wide, 18 m tall)
  const BUDGET = 800;
  const LAUNCH = { x: 5, y: 3 };
  const MAXV = 32;                     // m/s at full draw
  const SETTLE = 90;                   // ticks the fort settles before the first shot is allowed

  const MAT = {
    w: { name: 'Wood',  density: 0.7, friction: 0.7,  hp: 70,  cost: 10 },
    s: { name: 'Stone', density: 2.4, friction: 0.85, hp: 320, cost: 25 },
    i: { name: 'Iron',  density: 5.5, friction: 0.55, hp: 900, cost: 60 },
    h: { name: 'Heart', density: 1.0, friction: 0.8,  hp: 26,  cost: 0 },
  };
  // shape -> [width, height] in grid cells
  const SHAPE = { S: [2, 2], H: [4, 1], V: [1, 4], L: [6, 1] };
  const AMMO = {
    stone:   { name: 'Stone shot', r: 0.35, density: 9, count: 3 },
    boulder: { name: 'Boulder',    r: 0.62, density: 7, count: 1 },
    pot:     { name: 'Fire pot',   r: 0.4,  density: 3, count: 1, blast: 4.5, power: 1400 },
  };
  const MIN_HIT = 2.2; // m/s approach speed below which contacts do no damage (resting loads never hurt)

  function pieceCost(p) {
    const [w, h] = SHAPE[p.s];
    return p.m === 'h' ? 0 : Math.round(MAT[p.m].cost * (w * h) / 4);
  }
  function fortCost(pieces) { return pieces.reduce((a, p) => a + pieceCost(p), 0); }
  function rect(p) { const [w, h] = SHAPE[p.s]; return { x0: p.x, y0: p.y, x1: p.x + w, y1: p.y + h }; }
  function overlaps(a, b) { return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1; }
  function canPlace(pieces, p) {
    const r = rect(p);
    if (r.x0 < ZONE.x0 || r.x1 > ZONE.x1 || r.y0 < 0 || r.y1 > ZONE.y1) return false;
    if (p.m === 'h' && p.s !== 'S') return false;
    return !pieces.some(q => overlaps(r, rect(q)));
  }

  // ---- compact share codes -------------------------------------------------
  const b36 = (n) => n.toString(36).padStart(2, '0');
  function encodeFort(name, pieces) {
    const safe = (name || 'Untitled').replace(/[^A-Za-z0-9 '-]/g, '').slice(0, 28).trim().replace(/ /g, '_');
    return 'SW1.' + safe + '.' + pieces.map(p => p.m + p.s + b36(p.x) + b36(p.y)).join('');
  }
  function decodeFort(code) {
    const m = /^SW1\.([A-Za-z0-9_'-]*)\.([a-z0-9A-Z]*)$/.exec((code || '').trim());
    if (!m) throw new Error('That is not a fort code. Fort codes start with SW1.');
    const body = m[2];
    if (body.length % 6) throw new Error('This fort code is cut short. Copy the whole code and try again.');
    const pieces = [];
    for (let k = 0; k < body.length; k += 6) {
      const p = { m: body[k], s: body[k + 1], x: parseInt(body.slice(k + 2, k + 4), 36), y: parseInt(body.slice(k + 4, k + 6), 36) };
      if (!MAT[p.m] || !SHAPE[p.s] || !canPlace(pieces, p)) throw new Error('This fort code has a piece in an impossible spot.');
      pieces.push(p);
    }
    return { name: m[1].replace(/_/g, ' '), pieces };
  }
  function encodePlan(shots) {
    // one shot = ammo letter + tick + angle (0.1 deg) + power (0.1%)
    return 'SP1.' + shots.map(s => s.type[0] + s.t.toString(36) + '~' + Math.round(s.a * 10).toString(36) + '~' + Math.round(s.p * 1000).toString(36)).join('.');
  }
  function decodePlan(code) {
    const parts = (code || '').trim().split('.');
    if (parts[0] !== 'SP1') throw new Error('That is not a siege plan. Plans start with SP1.');
    const types = { s: 'stone', b: 'boulder', p: 'pot' };
    return parts.slice(1).filter(Boolean).map(x => {
      const [a, b, c] = x.slice(1).split('~');
      return { type: types[x[0]], t: parseInt(a, 36), a: parseInt(b, 36) / 10, p: parseInt(c, 36) / 1000 };
    });
  }

  // ---- result hash: FNV-1a over the rounded final state -------------------
  function stateHash(sim) {
    let h = 0x811c9dc5;
    const feed = (n) => { const s = String(n); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
    feed(sim.tick);
    for (const b of sim.blocks) {
      feed(b.alive ? 1 : 0);
      if (!b.alive) continue;
      const p = b.body.getPosition();
      feed(Math.round(p.x * 1000)); feed(Math.round(p.y * 1000)); feed(Math.round(b.body.getAngle() * 1000)); feed(Math.round(b.dmg));
    }
    return h.toString(16).padStart(8, '0');
  }

  // ---- the simulation ------------------------------------------------------
  function createSim(pl, pieces, plan) {
    const world = new pl.World({ gravity: pl.Vec2(0, -10) });
    const ground = world.createBody();
    ground.createFixture(pl.Edge(pl.Vec2(-40, 0), pl.Vec2(140, 0)), { friction: 0.9 });
    // launcher mound
    ground.createFixture(pl.Polygon([pl.Vec2(0, 0), pl.Vec2(8, 0), pl.Vec2(6.5, 1.8), pl.Vec2(2, 1.8)]), { friction: 0.9 });

    const sim = { world, tick: 0, blocks: [], shots: [], plan: (plan || []).slice(), fired: [], blasts: [], log: [], lastShotTick: -1, ammo: {} };
    for (const k in AMMO) sim.ammo[k] = AMMO[k].count;

    pieces.forEach((p, idx) => {
      const [w, h] = SHAPE[p.s];
      const mat = MAT[p.m];
      const body = world.createBody({ type: 'dynamic', position: pl.Vec2((p.x + w / 2) * GRID, (p.y + h / 2) * GRID) });
      body.createFixture(pl.Box(w * GRID / 2 - 0.005, h * GRID / 2 - 0.005), { density: mat.density, friction: mat.friction, restitution: 0.05 });
      const blk = { idx, piece: p, body, mat: p.m, hp: mat.hp * (w * h) / 4 * (p.m === 'h' ? 4 / (w * h) : 1), dmg: 0, alive: true, w: w * GRID, h: h * GRID };
      body.setUserData(blk);
      sim.blocks.push(blk);
    });
    sim.hearts = sim.blocks.filter(b => b.mat === 'h');

    const hurt = (ud, e) => { if (ud && ud.hp !== undefined && ud.alive) ud.dmg += e; };

    world.on('pre-solve', (contact) => {
      const fa = contact.getFixtureA(), fb = contact.getFixtureB();
      const ba = fa.getBody(), bb = fb.getBody();
      const wm = contact.getWorldManifold(null);
      if (!wm || !wm.points.length) return;
      const pt = wm.points[0], n = wm.normal;
      const va = ba.getLinearVelocityFromWorldPoint(pt), vb = bb.getLinearVelocityFromWorldPoint(pt);
      const vn = (va.x - vb.x) * n.x + (va.y - vb.y) * n.y; // positive = approaching (normal points A->B)
      if (vn < MIN_HIT) return;
      const ma = ba.isDynamic() ? ba.getMass() : Infinity, mb = bb.isDynamic() ? bb.getMass() : Infinity;
      const mred = ma === Infinity ? mb : mb === Infinity ? ma : (ma * mb) / (ma + mb);
      const e = 0.5 * mred * (vn * vn - MIN_HIT * MIN_HIT);
      const ua = ba.getUserData(), ub = bb.getUserData();
      hurt(ua, e); hurt(ub, e);
      if (ua && ua.kind === 'shot' && ua.type === 'pot' && sim.tick > ua.armed) ua.boom = true;
      if (ub && ub.kind === 'shot' && ub.type === 'pot' && sim.tick > ub.armed) ub.boom = true;
    });

    const pendingOf = (type) => sim.plan.filter(s => !s.done && s.type === type).length;
    sim.ammoFree = (type) => sim.ammo[type] - pendingOf(type);
    sim.canFire = (type) => sim.tick >= SETTLE && sim.ammoFree(type) > 0;

    sim.fireNow = (type, angleDeg, power) => {
      // queue a shot at the current tick; applied at the start of the next step
      if (!sim.canFire(type)) return false;
      sim.plan.push({ type, t: sim.tick, a: angleDeg, p: power });
      return true;
    };

    function launch(s) {
      // validation: a plan may not fire before the fort settles or beyond its ammo
      if (!AMMO[s.type] || sim.tick < SETTLE || sim.ammo[s.type] <= 0) { s.rejected = true; return; }
      sim.ammo[s.type]--;
      const A = AMMO[s.type];
      const rad = s.a * Math.PI / 180, v = Math.max(0.05, Math.min(1, s.p)) * MAXV;
      const body = world.createBody({ type: 'dynamic', bullet: true, position: pl.Vec2(LAUNCH.x, LAUNCH.y) });
      body.createFixture(pl.Circle(A.r), { density: A.density, friction: 0.5, restitution: 0.1 });
      body.setLinearVelocity(pl.Vec2(Math.cos(rad) * v, Math.sin(rad) * v));
      const ud = { kind: 'shot', type: s.type, body, r: A.r, armed: sim.tick + 6, born: sim.tick };
      body.setUserData(ud);
      sim.shots.push(ud);
      sim.fired.push(s);
      sim.lastShotTick = sim.tick;
    }

    function explode(shot) {
      const A = AMMO.pot, c = shot.body.getPosition();
      sim.blasts.push({ x: c.x, y: c.y, t: sim.tick });
      for (const b of sim.blocks) {
        if (!b.alive) continue;
        const p = b.body.getPosition();
        const dx = p.x - c.x, dy = p.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > A.blast) continue;
        const f = 1 - d / A.blast, k = Math.max(d, 0.3);
        b.body.applyLinearImpulse(pl.Vec2(dx / k * f * 22, dy / k * f * 22 + f * 6), p, true);
        b.dmg += A.power * f * f;
      }
      world.destroyBody(shot.body);
      shot.dead = true;
    }

    sim.step = () => {
      // planned shots for this tick (replays and live play go through the same path)
      for (const s of sim.plan) if (s.t === sim.tick && !s.done) { s.done = true; launch(s); }
      world.step(DT, 10, 4);
      sim.tick++;
      for (const sh of sim.shots) {
        if (sh.dead) continue;
        const p = sh.body.getPosition();
        if (sh.boom) { explode(sh); continue; }
        const slow = sh.body.getLinearVelocity().lengthSquared() < 0.05 && sim.tick - sh.born > 30;
        if (p.x > 120 || p.x < -20 || p.y < -5 || slow || sim.tick - sh.born > 900) {
          if (sh.type === 'pot' && !(p.x > 120 || p.x < -20)) { explode(sh); continue; }
          world.destroyBody(sh.body); sh.dead = true;
        }
      }
      for (const b of sim.blocks) {
        if (!b.alive) continue;
        const p = b.body.getPosition();
        const fell = p.y < -2 || p.x > 125 || p.x < -25;
        if (b.dmg >= b.hp || fell) {
          b.alive = false; b.diedAt = sim.tick;
          sim.log.push({ t: sim.tick, x: p.x, y: p.y, mat: b.mat, w: b.w, h: b.h, a: b.body.getAngle() });
          world.destroyBody(b.body);
        }
      }
    };

    sim.heartsLeft = () => sim.hearts.filter(h => h.alive).length;
    sim.ammoLeft = () => Object.keys(sim.ammo).reduce((a, k) => a + sim.ammo[k], 0);
    sim.isQuiet = () => {
      for (const b of sim.blocks) if (b.alive && b.body.isAwake() && b.body.getLinearVelocity().lengthSquared() > 0.02) return false;
      return sim.shots.every(s => s.dead);
    };
    // outcome: null while undecided
    sim.outcome = () => {
      if (sim.tick < SETTLE) return null;
      if (sim.heartsLeft() === 0) return 'breached';
      const pending = sim.plan.some(s => !s.done);
      if (sim.ammoLeft() === 0 && !pending && sim.tick - sim.lastShotTick > 120 && (sim.isQuiet() || sim.tick - sim.lastShotTick > 600)) return 'held';
      return null;
    };
    return sim;
  }

  // ---- sample forts ---------------------------------------------------------
  function sampleForts() {
    const forts = [];
    // 1. Watchtower: a stone tower with a heart on top behind a wooden fence
    {
      const P = [];
      for (let y = 0; y < 12; y += 4) { P.push({ m: 's', s: 'V', x: 84, y }); P.push({ m: 's', s: 'V', x: 88, y }); P.push({ m: 's', s: 'L', x: 83, y: y + 4 }); }
      P.length = 0;
      // two stone posts, plank roof, repeated 3 storeys
      for (let k = 0; k < 3; k++) {
        const y = k * 5;
        P.push({ m: 's', s: 'V', x: 84, y }); P.push({ m: 's', s: 'V', x: 88, y });
        P.push({ m: 'w', s: 'L', x: 84, y: y + 4 });
      }
      P.push({ m: 'h', s: 'S', x: 86, y: 15 });
      P.push({ m: 'h', s: 'S', x: 85, y: 0 });
      for (let x = 74; x < 80; x += 1) P.push({ m: 'w', s: 'V', x, y: 0 });
      forts.push({ name: 'Watchtower', pieces: P });
    }
    // 2. Bunker: low, wide stone with iron lintels
    {
      const P = [];
      for (const x of [76, 84, 92]) { P.push({ m: 's', s: 'S', x, y: 0 }); P.push({ m: 's', s: 'S', x, y: 2 }); }
      P.push({ m: 'i', s: 'L', x: 76, y: 4 }); P.push({ m: 'i', s: 'L', x: 88, y: 4 });
      P.push({ m: 's', s: 'H', x: 82, y: 4 });
      P.push({ m: 'h', s: 'S', x: 79, y: 0 }); P.push({ m: 'h', s: 'S', x: 87, y: 0 });
      P.push({ m: 's', s: 'S', x: 78, y: 5 }); P.push({ m: 's', s: 'S', x: 90, y: 5 });
      P.push({ m: 'w', s: 'L', x: 77, y: 7 }); P.push({ m: 'w', s: 'L', x: 87, y: 7 });
      forts.push({ name: 'Bunker', pieces: P });
    }
    // 3. Wall and keep: a thick front wall shields a heart in a back keep
    {
      const P = [];
      for (let y = 0; y < 16; y += 4) { P.push({ m: 's', s: 'V', x: 72, y }); P.push({ m: 'w', s: 'V', x: 73, y }); }
      for (let y = 0; y < 8; y += 2) P.push({ m: 's', s: 'S', x: 96, y });
      for (let y = 0; y < 8; y += 2) P.push({ m: 's', s: 'S', x: 102, y });
      P.push({ m: 'i', s: 'L', x: 97, y: 8 }); P.push({ m: 'w', s: 'H', x: 97, y: 9 }); P.push({ m: 'w', s: 'H', x: 101, y: 9 });
      P.push({ m: 'h', s: 'S', x: 99, y: 0 }); P.push({ m: 'h', s: 'S', x: 99, y: 10 });
      forts.push({ name: 'Wall and Keep', pieces: P });
    }
    return forts;
  }

  const api = { DT, GRID, ZONE, BUDGET, LAUNCH, MAXV, SETTLE, MAT, SHAPE, AMMO, pieceCost, fortCost, rect, canPlace, encodeFort, decodeFort, encodePlan, decodePlan, stateHash, createSim, sampleForts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SW = api;
})(typeof window !== 'undefined' ? window : globalThis);
