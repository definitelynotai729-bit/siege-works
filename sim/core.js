// Siegeworks core simulation. Pure logic, no rendering.
// Shared verbatim by the browser page, the headless tests, the solver and (later) the validators.
// Fixed 1/60 s timestep; every shot is keyed to a tick so a siege replays exactly.
// Load detmath.js and call SWDetMath.install() BEFORE planck.js, or results differ between browsers.
(function (root) {
  const VERSION = 'sim-0.2';           // part of every result hash: a physics change must never silently match
  const DT = 1 / 60;
  const GRID = 0.5;                    // metres per build-grid cell
  const ZONE = { x0: 60, x1: 112, y1: 36 }; // build zone in grid cells (30..56 m wide, 18 m tall)
  const BUDGET = 800;
  const LAUNCH = { x: 5, y: 3 };
  const MAXV = 32;                     // m/s at full draw
  const SETTLE = 90;                   // ticks the fort settles before the first shot is allowed
  const CHECK_TICKS = SETTLE + 300;    // how long a fort must stand on its own to be valid

  const MAT = {
    w: { name: 'Wood',  density: 0.7, friction: 0.7,  hp: 70,  cost: 10 },
    s: { name: 'Stone', density: 2.4, friction: 0.85, hp: 320, cost: 25 },
    i: { name: 'Iron',  density: 5.5, friction: 0.55, hp: 900, cost: 60 },
    h: { name: 'Heart', density: 1.0, friction: 0.8,  hp: 26,  cost: 0 },
  };
  // shape -> [width, height] in grid cells
  const SHAPE = { S: [2, 2], H: [4, 1], V: [1, 4], L: [6, 1] };
  const AMMO = {
    stone:   { name: 'Stone shot', r: 0.35, density: 9 },
    boulder: { name: 'Boulder',    r: 0.62, density: 7 },
    pot:     { name: 'Fire pot',   r: 0.4,  density: 3, blast: 3.5, power: 900, burn: { w: 1, s: 0.25, i: 0.08, h: 0.04 } }, // burns wood, barely scorches stone
  };
  const DEFAULT_LOADOUT = { stone: 3, boulder: 1, pot: 1 };
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
  function cleanName(name) { return (name || 'Untitled').replace(/[^A-Za-z0-9 '-]/g, '').slice(0, 28).trim() || 'Untitled'; }
  function encodeFort(name, pieces) {
    return 'SW1.' + cleanName(name).replace(/ /g, '_') + '.' + pieces.map(p => p.m + p.s + b36(p.x) + b36(p.y)).join('');
  }
  function decodeFort(code) {
    const m = /^SW1\.([A-Za-z0-9_'-]*)\.([a-zA-Z0-9]*)$/.exec((code || '').trim());
    if (!m) throw new Error('That is not a fort code. Fort codes start with SW1.');
    const body = m[2];
    if (body.length % 6) throw new Error('This fort code is cut short. Copy the whole code and try again.');
    if (body.length / 6 > 400) throw new Error('This fort has more than 400 pieces.');
    const pieces = [];
    for (let k = 0; k < body.length; k += 6) {
      const p = { m: body[k], s: body[k + 1], x: parseInt(body.slice(k + 2, k + 4), 36), y: parseInt(body.slice(k + 4, k + 6), 36) };
      if (!MAT[p.m] || !SHAPE[p.s] || !(p.x >= 0) || !(p.y >= 0) || !canPlace(pieces, p)) throw new Error('This fort code has a piece in an impossible spot.');
      pieces.push(p);
    }
    return { name: m[1].replace(/_/g, ' '), pieces };
  }
  const AMMO_LETTER = { stone: 's', boulder: 'b', pot: 'p' }, LETTER_AMMO = { s: 'stone', b: 'boulder', p: 'pot' };
  function encodePlan(shots) {
    // one shot = ammo letter + tick + angle (0.1 deg) + power (0.1%), all base 36
    return 'SP1.' + shots.map(s => AMMO_LETTER[s.type] + s.t.toString(36) + '~' + Math.round(s.a * 10).toString(36) + '~' + Math.round(s.p * 1000).toString(36)).join('.');
  }
  function decodePlan(code) {
    const parts = (code || '').trim().split('.');
    if (parts[0] !== 'SP1') throw new Error('That is not a siege plan. Plans start with SP1.');
    if (parts.length > 41) throw new Error('This plan has too many shots.');
    return parts.slice(1).filter(Boolean).map(x => {
      const [a, b, c] = x.slice(1).split('~');
      const s = { type: LETTER_AMMO[x[0]], t: parseInt(a, 36), a: parseInt(b, 36) / 10, p: parseInt(c, 36) / 1000 };
      if (!s.type || !Number.isFinite(s.t) || !Number.isFinite(s.a) || !Number.isFinite(s.p)) throw new Error('This siege plan has a damaged shot.');
      return s;
    });
  }
  // Shots are stored rounded exactly as the plan code rounds them, so a live siege and its replay are bit-identical.
  function quantizeShot(type, t, angleDeg, power) {
    return { type, t, a: Math.round(Math.max(-10, Math.min(85, angleDeg)) * 10) / 10, p: Math.round(Math.max(0.05, Math.min(1, power)) * 1000) / 1000 };
  }

  // ---- result hash: FNV-1a over the rounded final state -------------------
  function stateHash(sim) {
    let h = 0x811c9dc5;
    const feed = (n) => { const s = String(n); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
    feed(VERSION); feed(sim.tick);
    for (const b of sim.blocks) {
      feed(b.alive ? 1 : 0);
      if (!b.alive) continue;
      const p = b.body.getPosition();
      feed(Math.round(p.x * 1000)); feed(Math.round(p.y * 1000)); feed(Math.round(b.body.getAngle() * 1000)); feed(Math.round(b.dmg));
    }
    return h.toString(16).padStart(8, '0');
  }

  // ---- the simulation ------------------------------------------------------
  function createSim(pl, pieces, plan, opts) {
    opts = opts || {};
    const world = new pl.World({ gravity: pl.Vec2(0, -10) });
    const ground = world.createBody();
    ground.createFixture(pl.Edge(pl.Vec2(-40, 0), pl.Vec2(140, 0)), { friction: 0.9 });
    // launcher mound
    ground.createFixture(pl.Polygon([pl.Vec2(0, 0), pl.Vec2(8, 0), pl.Vec2(6.5, 1.8), pl.Vec2(2, 1.8)]), { friction: 0.9 });

    const loadout = opts.loadout || DEFAULT_LOADOUT;
    const sim = { world, tick: 0, blocks: [], shots: [], plan: (plan || []).map(s => Object.assign({}, s)), fired: [], blasts: [], log: [],
                  events: [], lastShotTick: -1, ammo: {}, loadout, collapsed: false };
    for (const k in AMMO) sim.ammo[k] = loadout[k] || 0;
    let hitsThisTick = 0;
    const event = (k, x, y, e, m) => sim.events.push({ t: sim.tick, k, x, y, e, m });

    pieces.forEach((p, idx) => {
      const [w, h] = SHAPE[p.s];
      const mat = MAT[p.m];
      const body = world.createBody({ type: 'dynamic', position: pl.Vec2((p.x + w / 2) * GRID, (p.y + h / 2) * GRID) });
      body.createFixture(pl.Box(w * GRID / 2 - 0.005, h * GRID / 2 - 0.005), { density: mat.density, friction: mat.friction, restitution: 0.05 });
      const blk = { idx, piece: p, body, mat: p.m, hp: p.m === 'h' ? mat.hp : mat.hp * (w * h) / 4, dmg: 0, alive: true, w: w * GRID, h: h * GRID,
                    x0: (p.x + w / 2) * GRID, y0: (p.y + h / 2) * GRID };
      body.setUserData(blk);
      sim.blocks.push(blk);
    });
    sim.hearts = sim.blocks.filter(b => b.mat === 'h');

    const hurt = (ud, e) => { if (ud && ud.hp !== undefined && ud.alive) ud.dmg += e; };

    world.on('pre-solve', (contact) => {
      const ba = contact.getFixtureA().getBody(), bb = contact.getFixtureB().getBody();
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
      if (e > 6 && hitsThisTick < 10) { // for sound and effects only; never read back by the simulation
        hitsThisTick++;
        const blk = (ua && ua.hp !== undefined) ? ua : (ub && ub.hp !== undefined) ? ub : null;
        event('hit', pt.x, pt.y, e, blk ? blk.mat : 'g');
      }
    });

    const pendingOf = (type) => sim.plan.filter(s => !s.done && s.type === type).length;
    sim.ammoFree = (type) => (sim.ammo[type] || 0) - pendingOf(type);
    sim.ammoTotal = () => Object.keys(AMMO).reduce((a, k) => a + sim.ammoFree(k), 0);
    sim.canFire = (type) => sim.tick >= SETTLE && !sim.collapsed && sim.ammoFree(type) > 0;

    sim.fireNow = (type, angleDeg, power) => {
      // queue a shot at the current tick; applied at the start of the next step
      if (!sim.canFire(type)) return false;
      sim.plan.push(quantizeShot(type, sim.tick, angleDeg, power));
      return true;
    };

    function launch(s) {
      // validation: a plan may not fire before the fort settles or beyond its ammo
      if (!AMMO[s.type] || sim.tick < SETTLE || (sim.ammo[s.type] || 0) <= 0) { s.rejected = true; return; }
      sim.ammo[s.type]--;
      const A = AMMO[s.type];
      const rad = s.a * Math.PI / 180, v = Math.max(0.05, Math.min(1, s.p)) * MAXV;
      const body = world.createBody({ type: 'dynamic', bullet: true, position: pl.Vec2(LAUNCH.x, LAUNCH.y) });
      body.createFixture(pl.Circle(A.r), { density: A.density, friction: 0.5, restitution: 0.1 });
      body.setLinearVelocity(pl.Vec2(Math.cos(rad) * v, Math.sin(rad) * v));
      const ud = { kind: 'shot', type: s.type, body, r: A.r, armed: sim.tick + 6, born: sim.tick, trail: [LAUNCH.x, LAUNCH.y] };
      body.setUserData(ud);
      sim.shots.push(ud);
      sim.fired.push({ type: s.type, t: s.t, a: s.a, p: s.p });
      sim.lastShotTick = sim.tick;
      event('launch', LAUNCH.x, LAUNCH.y, v, s.type);
    }

    function explode(shot) {
      const A = AMMO.pot, c = shot.body.getPosition();
      sim.blasts.push({ x: c.x, y: c.y, t: sim.tick });
      event('blast', c.x, c.y, A.power, 'pot');
      for (const b of sim.blocks) {
        if (!b.alive) continue;
        const p = b.body.getPosition();
        const dx = p.x - c.x, dy = p.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > A.blast) continue;
        const f = 1 - d / A.blast, k = Math.max(d, 0.3);
        b.body.applyLinearImpulse(pl.Vec2(dx / k * f * 22, dy / k * f * 22 + f * 6), p, true);
        b.dmg += A.power * f * f * A.burn[b.mat];
      }
      world.destroyBody(shot.body);
      shot.dead = true;
    }

    sim.step = () => {
      hitsThisTick = 0;
      // planned shots for this tick (replays and live play go through the same path)
      for (const s of sim.plan) if (s.t === sim.tick && !s.done) { s.done = true; launch(s); }
      world.step(DT, 10, 4);
      sim.tick++;
      for (const sh of sim.shots) {
        if (sh.dead) continue;
        const p = sh.body.getPosition();
        if ((sim.tick & 1) === 0 && sh.trail.length < 800) sh.trail.push(p.x, p.y);
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
          event(b.mat === 'h' ? 'heart' : 'break', p.x, p.y, b.hp, b.mat);
          world.destroyBody(b.body);
          if (b.mat === 'h' && sim.lastShotTick < 0) sim.collapsed = true; // a heart lost before anyone fired: the fort fell apart by itself
        }
      }
    };

    sim.heartsLeft = () => sim.hearts.filter(h => h.alive).length;
    sim.isQuiet = () => {
      for (const b of sim.blocks) if (b.alive && b.body.isAwake() && b.body.getLinearVelocity().lengthSquared() > 0.02) return false;
      return sim.shots.every(s => s.dead);
    };
    // outcome: null while undecided
    sim.outcome = () => {
      if (sim.collapsed) return 'collapsed';
      if (sim.tick < SETTLE) return null;
      if (sim.heartsLeft() === 0) return 'breached';
      const pending = sim.plan.some(s => !s.done);
      if (sim.ammoTotal() === 0 && !pending && sim.tick - sim.lastShotTick > 120 && (sim.isQuiet() || sim.tick - sim.lastShotTick > 600)) return 'held';
      return null;
    };
    return sim;
  }

  // A fort is valid if it stands on its own: no heart may break and no piece may be destroyed while it settles.
  function checkFort(pl, pieces) {
    const hearts = pieces.filter(p => p.m === 'h').length;
    if (!hearts) return { ok: false, reason: 'Add at least one heart.', hearts };
    const sim = createSim(pl, pieces, []);
    while (sim.tick < CHECK_TICKS) sim.step();
    const lost = sim.blocks.filter(b => !b.alive);
    const heartsLost = lost.filter(b => b.mat === 'h').length;
    let moved = 0;
    for (const b of sim.blocks) {
      if (!b.alive) continue;
      const p = b.body.getPosition();
      if (Math.hypot(p.x - b.x0, p.y - b.y0) > 0.6) moved++;
    }
    let reason = '';
    if (heartsLost) reason = heartsLost === 1 ? 'A heart breaks while the fort settles.' : heartsLost + ' hearts break while the fort settles.';
    else if (lost.length) reason = lost.length + (lost.length === 1 ? ' piece breaks' : ' pieces break') + ' while the fort settles.';
    return { ok: !heartsLost && !lost.length, reason, hearts, heartsLost, broken: lost.length, moved, lostIdx: lost.map(b => b.idx) };
  }

  // ---- forts ---------------------------------------------------------------
  // Proving Grounds: the campaign. Every fort here is buildable with the same 800 gold a player has.
  // par = fewest shots the offline solver (sim/solve.js) needed; re-run it whenever the physics changes.
  function campaign() {
    const forts = [];
    const add = (name, blurb, loadout, par, P) => forts.push({ name, blurb, loadout, par, pieces: P });
    { // 1
      const P = [{ m: 'w', s: 'V', x: 80, y: 0 }, { m: 'w', s: 'V', x: 84, y: 0 }, { m: 'w', s: 'L', x: 79, y: 4 }, { m: 'h', s: 'S', x: 81, y: 5 }];
      add('Outpost', 'A heart on a wooden table. Hit it.', { stone: 3 }, 1, P);
    }
    { // 2
      const P = [];
      for (let x = 74; x < 80; x++) { P.push({ m: 'w', s: 'V', x, y: 0 }); P.push({ m: 'w', s: 'V', x, y: 4 }); }
      P.push({ m: 'h', s: 'S', x: 92, y: 0 });
      add('Palisade', 'A wooden wall. Burn it down or lob over it.', { stone: 2, pot: 1 }, 1, P);
    }
    { // 3
      const P = [];
      for (let k = 0; k < 3; k++) {
        const y = k * 5;
        P.push({ m: 's', s: 'V', x: 84, y }); P.push({ m: 's', s: 'V', x: 88, y });
        P.push({ m: 'w', s: 'L', x: 84, y: y + 4 });
      }
      P.push({ m: 'h', s: 'S', x: 86, y: 15 });
      P.push({ m: 'h', s: 'S', x: 85, y: 0 });
      for (let x = 74; x < 80; x++) P.push({ m: 'w', s: 'V', x, y: 0 });
      add('Watchtower', 'Two hearts: one at the top, one at the base.', DEFAULT_LOADOUT, 1, P);
    }
    { // 4
      const P = [];
      for (const x0 of [68, 100]) {
        P.push({ m: 's', s: 'V', x: x0, y: 0 }); P.push({ m: 's', s: 'V', x: x0 + 5, y: 0 });
        P.push({ m: 's', s: 'L', x: x0, y: 4 });
        P.push({ m: 'h', s: 'S', x: x0 + 2, y: 0 });
      }
      add('Twin Huts', 'Two huts, far apart. Plan your shots.', { stone: 3, boulder: 1 }, 2, P);
    }
    { // 5
      const P = [];
      for (let y = 0; y < 16; y += 4) { P.push({ m: 's', s: 'V', x: 72, y }); P.push({ m: 'w', s: 'V', x: 73, y }); }
      for (let y = 0; y < 8; y += 2) P.push({ m: 's', s: 'S', x: 96, y });
      for (let y = 0; y < 8; y += 2) P.push({ m: 's', s: 'S', x: 102, y });
      P.push({ m: 'i', s: 'L', x: 97, y: 8 }); P.push({ m: 'w', s: 'H', x: 97, y: 9 }); P.push({ m: 'w', s: 'H', x: 101, y: 9 });
      P.push({ m: 'h', s: 'S', x: 99, y: 0 }); P.push({ m: 'h', s: 'S', x: 99, y: 10 });
      add('Wall and Keep', 'A tall wall shields a keep with two hearts.', DEFAULT_LOADOUT, 2, P);
    }
    { // 6
      const P = [];
      for (let y = 0; y < 8; y += 2) P.push({ m: 'i', s: 'S', x: 70, y });
      for (let y = 0; y < 6; y += 2) { P.push({ m: 's', s: 'S', x: 90, y }); P.push({ m: 's', s: 'S', x: 96, y }); }
      P.push({ m: 's', s: 'L', x: 90, y: 6 }); P.push({ m: 'w', s: 'H', x: 92, y: 7 });
      P.push({ m: 'h', s: 'S', x: 93, y: 0 }); P.push({ m: 'h', s: 'S', x: 93, y: 8 });
      add('Iron Gate', 'An iron pillar guards the approach.', DEFAULT_LOADOUT, 2, P);
    }
    { // 7
      const P = [];
      for (const x of [74, 82, 90]) { P.push({ m: 's', s: 'V', x, y: 0 }); P.push({ m: 's', s: 'V', x: x + 5, y: 0 }); }
      P.push({ m: 'i', s: 'L', x: 74, y: 4 }); P.push({ m: 's', s: 'L', x: 82, y: 4 }); P.push({ m: 'i', s: 'L', x: 90, y: 4 });
      P.push({ m: 'h', s: 'S', x: 76, y: 0 }); P.push({ m: 'h', s: 'S', x: 92, y: 0 });
      P.push({ m: 's', s: 'V', x: 82, y: 5 }); P.push({ m: 's', s: 'V', x: 87, y: 5 });
      P.push({ m: 'w', s: 'L', x: 82, y: 9 }); P.push({ m: 'h', s: 'S', x: 84, y: 10 });
      P.push({ m: 's', s: 'S', x: 66, y: 0 }); P.push({ m: 's', s: 'S', x: 66, y: 2 });
      P.push({ m: 'w', s: 'V', x: 104, y: 0 }); P.push({ m: 'w', s: 'V', x: 104, y: 4 });
      add('Citadel', 'Three hearts across three halls.', DEFAULT_LOADOUT, 3, P);
    }
    { // 8
      const P = [];
      for (const x of [76, 80, 86, 90]) { P.push({ m: 's', s: 'S', x, y: 0 }); P.push({ m: 's', s: 'S', x, y: 2 }); }
      P.push({ m: 'h', s: 'S', x: 78, y: 0 }); P.push({ m: 'h', s: 'S', x: 88, y: 0 });
      P.push({ m: 'i', s: 'L', x: 76, y: 4 }); P.push({ m: 'i', s: 'L', x: 86, y: 4 });
      for (const x of [77, 80, 87, 90]) P.push({ m: 's', s: 'S', x, y: 5 });
      P.push({ m: 'w', s: 'L', x: 76, y: 7 }); P.push({ m: 'w', s: 'L', x: 86, y: 7 });
      add('Bunker', 'Low, heavy and roofed in iron. The final test.', DEFAULT_LOADOUT, 2, P);
    }
    return forts;
  }

  const api = { VERSION, DT, GRID, ZONE, BUDGET, LAUNCH, MAXV, SETTLE, CHECK_TICKS, MAT, SHAPE, AMMO, DEFAULT_LOADOUT,
                pieceCost, fortCost, rect, canPlace, cleanName, encodeFort, decodeFort, encodePlan, decodePlan, quantizeShot,
                stateHash, createSim, checkFort, campaign, sampleForts: campaign };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SW = api;
})(typeof window !== 'undefined' ? window : globalThis);
