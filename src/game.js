// Siegeworks page: input, rendering, campaign, builder and the search bot.
// All game rules live in sim/core.js; nothing here may change what a siege does, only how it looks and sounds.
(function () {
  'use strict';
  const pl = window.planck, S = window.SW, AU = window.SWAudio;
  const $ = (id) => document.getElementById(id);
  if (!pl || !S) { const s = $('status'); if (s) s.textContent = 'The physics engine did not load. Reload the page to try again.'; return; }
  const css = getComputedStyle(document.documentElement);
  const C = {};
  ['sheet', 'rule', 'chalk', 'chalk-dim', 'pencil', 'wood', 'stone', 'iron', 'heart', 'bad', 'good'].forEach(k => C[k] = css.getPropertyValue('--' + k).trim());
  const MATCOL = { w: C.wood, s: C.stone, i: C.iron, h: C.heart };
  const VIEW = { x0: -1, x1: 61, y0: -2.5, y1: 23 };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cv = $('field'), ctx = cv.getContext('2d');
  let scale = 10, dpr = 1;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const starsFor = (shots, par) => shots <= par ? 3 : shots <= par + 1 ? 2 : 1;
  const AMMO_SHORT = { stone: ['stone shot', 'stone shots'], boulder: ['boulder', 'boulders'], pot: ['fire pot', 'fire pots'] };
  const loadoutText = (lo) => Object.keys(S.AMMO).filter(k => (lo[k] || 0) > 0).map(k => lo[k] + ' ' + AMMO_SHORT[k][lo[k] === 1 ? 0 : 1]).join(', ');

  function toast(msg) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  function copy(text, ok) {
    const fallback = () => { const ta = $('load-text'); ta.value = text; ta.focus(); ta.select(); toast('Selected in the box below. Press Ctrl+C to copy.'); };
    try { navigator.clipboard.writeText(text).then(() => toast(ok), fallback); } catch (e) { fallback(); }
  }

  // ------------------------------------------------------------------ forts
  const campaign = S.campaign().map((f, i) => Object.assign({}, f, { kind: 'campaign', num: i + 1, key: 'c' + (i + 1) }));
  const st = {
    mode: 'siege', forts: campaign.slice(), fortIdx: 0, sim: null, result: null, replayOf: null, readonly: false, label: null,
    ammoSel: 'stone', aim: null, acc: 0, last: 0, evSeen: 0, parts: [], flashes: [], shake: 0, slow: 0,
    build: { mat: 's', shape: 'S', erase: false, pieces: store.get('sw_draft', []), name: store.get('sw_draft_name', 'My Fort'), undo: [], bad: [] },
    hover: null, stars: store.get('sw_stars', {}), job: null,
  };
  if (!Array.isArray(st.build.pieces)) st.build.pieces = [];
  st.build.pieces = st.build.pieces.filter((p, i, all) => p && S.MAT[p.m] && S.SHAPE[p.s] && S.canPlace(all.slice(0, i), p));
  store.get('sw_loaded', []).forEach(code => { try { const d = S.decodeFort(code); st.forts.push(customFort(d.name, d.pieces)); } catch (e) {} });
  function customFort(name, pieces) { return { name, pieces, kind: 'custom', loadout: S.DEFAULT_LOADOUT, par: null, key: null, blurb: 'Built with ' + S.fortCost(pieces) + ' gold.' }; }
  const firstUnbeaten = campaign.findIndex(f => !(st.stars[f.key] > 0));
  st.fortIdx = firstUnbeaten < 0 ? 0 : firstUnbeaten;
  const currentFort = () => st.forts[st.fortIdx];
  function addCustomFort(name, pieces) {
    const code = S.encodeFort(name, pieces);
    let idx = st.forts.findIndex(x => x.kind === 'custom' && S.encodeFort(x.name, x.pieces) === code);
    if (idx < 0) {
      st.forts.push(customFort(S.cleanName(name), pieces.slice())); idx = st.forts.length - 1;
      const list = store.get('sw_loaded', []).filter(c => c !== code); list.push(code); store.set('sw_loaded', list.slice(-12));
    }
    return idx;
  }

  // ------------------------------------------------------------------ layout
  function resize() {
    const w = cv.clientWidth || 800;
    const h = Math.round(w * (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    scale = w / (VIEW.x1 - VIEW.x0);
  }
  const X = (x) => (x - VIEW.x0) * scale, Y = (y) => (VIEW.y1 - y) * scale;
  const toWorld = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) / scale + VIEW.x0, y: VIEW.y1 - (ev.clientY - r.top) / scale }; };

  function renderCard() {
    const card = $('fort-card');
    if (st.mode === 'build') {
      const spent = S.fortCost(st.build.pieces);
      card.innerHTML = `<span class="eyebrow">Builder</span><span class="name">${escapeHtml(st.build.name || 'My Fort')}</span><span class="meta">${spent} / ${S.BUDGET} gold</span>
        <span class="blurb">Wood is cheap, stone is solid, iron is nearly unbreakable. Fire pots burn wood.</span>`;
      return;
    }
    const f = currentFort();
    if (f.kind === 'campaign') {
      const best = st.stars[f.key] || 0;
      card.innerHTML = `<span class="eyebrow">Proving Grounds · Fort ${f.num} of ${campaign.length}</span><span class="name">${escapeHtml(f.name)}</span>
        <span class="stars" aria-label="${best} of 3 stars">${starText(best)}</span>
        <span class="blurb">${escapeHtml(f.blurb)}</span><span class="meta">Par ${plural(f.par, 'shot')} · ${loadoutText(f.loadout)}</span>`;
    } else {
      card.innerHTML = `<span class="eyebrow">Your forts</span><span class="name">${escapeHtml(f.name)}</span><span class="meta">${f.pieces.length} pieces</span>
        <span class="blurb">${escapeHtml(f.blurb)}</span><span class="meta">${loadoutText(f.loadout)}</span>`;
    }
  }

  // ------------------------------------------------------------------ siege
  function startSiege(plan, label) {
    const f = currentFort();
    st.sim = S.createSim(pl, f.pieces, plan || [], { loadout: f.loadout });
    st.result = null; st.evSeen = 0; st.parts = []; st.flashes = []; st.acc = 0; st.slow = 0; st.shake = 0;
    st.readonly = !!plan; st.label = label || null;
    if (!plan) st.replayOf = null;
    const avail = Object.keys(S.AMMO).filter(k => st.sim.ammoFree(k) > 0);
    if (!avail.includes(st.ammoSel)) st.ammoSel = avail[0];
    renderResult(); renderSiegeUI(); renderCard();
  }
  function fire() {
    const sim = st.sim;
    if (!sim || st.result || st.readonly || st.job) return;
    AU.unlock();
    if (!sim.fireNow(st.ammoSel, +$('angle').value, +$('power').value / 100)) {
      toast(sim.tick < S.SETTLE ? 'Wait a moment while the fort settles.' : 'No ' + AMMO_SHORT[st.ammoSel][1] + ' left.');
      return;
    }
    if (sim.ammoFree(st.ammoSel) <= 0) { const next = Object.keys(S.AMMO).find(k => sim.ammoFree(k) > 0); if (next) st.ammoSel = next; }
    renderSiegeUI();
  }
  function renderSiegeUI() {
    const sel = $('fort-pick');
    const opt = (f, i) => `<option value="${i}">${f.kind === 'campaign' ? f.num + '. ' : ''}${escapeHtml(f.name)}${f.kind === 'campaign' && st.stars[f.key] ? '  ' + starText(st.stars[f.key]) : ''}</option>`;
    const customs = st.forts.map((f, i) => [f, i]).filter(([f]) => f.kind === 'custom');
    sel.innerHTML = `<optgroup label="Proving Grounds">${campaign.map((f, i) => opt(f, i)).join('')}</optgroup>` +
      (customs.length ? `<optgroup label="Your forts">${customs.map(([f, i]) => opt(f, i)).join('')}</optgroup>` : '');
    sel.value = String(st.fortIdx);
    const sim = st.sim, f = currentFort();
    $('ammo').innerHTML = Object.keys(S.AMMO).filter(k => (f.loadout[k] || 0) > 0).map(k => {
      const n = sim ? sim.ammoFree(k) : f.loadout[k];
      return `<button class="chip" data-ammo="${k}" aria-pressed="${st.ammoSel === k}" ${n <= 0 || st.readonly ? 'disabled' : ''}>${S.AMMO[k].name} <span class="count">×${n}</span></button>`;
    }).join('');
    $('fire').disabled = st.readonly;
    updateStatus();
  }
  function updateStatus() {
    const sim = st.sim; if (!sim) return;
    const total = sim.hearts.length, left = sim.heartsLeft(), shots = sim.fired.length;
    let tail = '';
    if (st.label === 'bot') tail = ' · the bot is attacking';
    else if (st.readonly) tail = ' · replaying';
    else if (sim.tick < S.SETTLE) tail = ' · settling…';
    $('status').innerHTML = `<span class="heart-ink">♦</span> ${left}/${total} hearts standing · ${plural(shots, 'shot')} fired${tail}`;
  }
  function onOutcome(o) {
    const sim = st.sim, f = currentFort();
    const r = { outcome: o, tick: sim.tick, hash: S.stateHash(sim), plan: sim.fired.slice(), code: S.encodePlan(sim.fired), destroyed: sim.blocks.filter(b => !b.alive).length, shots: sim.fired.length, stars: 0, newBest: false };
    if (o === 'breached' && f.kind === 'campaign' && !st.readonly) {
      r.stars = starsFor(r.shots, f.par);
      if (r.stars > (st.stars[f.key] || 0)) { st.stars[f.key] = r.stars; store.set('sw_stars', st.stars); r.newBest = true; }
    }
    st.result = r;
    if (o === 'breached') AU.win(); else AU.lose();
    renderResult(); renderSiegeUI(); renderCard();
  }
  function renderResult() {
    const box = $('result-box');
    if (!st.result || st.mode !== 'siege') { box.hidden = true; box.innerHTML = ''; return; }
    const r = st.result, f = currentFort();
    const breached = r.outcome === 'breached', bot = st.label === 'bot';
    let title, sub = '';
    if (r.outcome === 'collapsed') { title = 'The fort collapsed on its own'; sub = 'A heart broke before the first shot, so this siege does not count.'; }
    else if (bot) { title = breached ? 'The bot breached it in ' + plural(r.shots, 'shot') : 'Your fort held against the bot'; sub = breached ? 'The bot simulated about 200 shots before choosing these. Strengthen the weak spot and send it again.' : 'The bot simulated about 200 shots and found no way in. Try it yourself, or share the code and let a friend try.'; }
    else if (breached) { title = 'Breached in ' + plural(r.shots, 'shot'); if (f.kind === 'campaign' && !st.readonly) sub = `Par is ${plural(f.par, 'shot')}. Three stars at par, two at one over.${r.newBest ? ' New best.' : ''}`; }
    else title = 'The fort held';
    let replayLine = '';
    if (st.replayOf) {
      const same = st.replayOf.hash === r.hash;
      replayLine = `<dt>Replay check</dt><dd class="${same ? 'match' : 'mismatch'}">${same ? 'Match. The replay reached the identical state ' + r.hash : 'Mismatch: ' + st.replayOf.hash + ' vs ' + r.hash}</dd>`;
    }
    const next = f.kind === 'campaign' && breached && f.num < campaign.length;
    box.hidden = false;
    box.innerHTML = `<div class="result ${r.outcome}">
      <h2>${escapeHtml(title)}${r.stars ? `<span class="stars" aria-label="${r.stars} of 3 stars">${starText(r.stars)}</span>` : ''}</h2>
      ${sub ? `<p class="sub">${escapeHtml(sub)}</p>` : ''}
      <dl class="kv">
        <dt>Fort</dt><dd>${escapeHtml(f.name)} · ${f.pieces.length} pieces · ${S.fortCost(f.pieces)} gold</dd>
        <dt>Blocks destroyed</dt><dd>${r.destroyed} of ${f.pieces.length}</dd>
        <dt>Decided at tick</dt><dd>${r.tick} (${(r.tick / 60).toFixed(1)} s of simulated time)</dd>
        <dt>Result hash</dt><dd>${r.hash} · ${S.VERSION}</dd>
        <dt>Siege plan</dt><dd>${r.code}</dd>
        ${replayLine}
      </dl>
      <div class="row">
        ${next ? '<button class="act" id="next-fort">Next fort</button>' : ''}
        ${bot ? '<button class="act" id="back-build">Back to building</button>' : ''}
        <button class="act ${next || bot ? 'ghost' : ''}" id="replay">Replay this siege</button>
        <button class="act ghost" id="copy-plan">Copy siege plan</button>
        <button class="act ghost" id="again">${bot ? 'Siege it yourself' : 'Try again'}</button>
      </div>
    </div>`;
    if (next) $('next-fort').onclick = () => { st.fortIdx = f.num; startSiege(); };
    if (bot) $('back-build').onclick = () => setMode('build');
    $('replay').onclick = () => { st.replayOf = { hash: r.hash }; startSiege(S.decodePlan(r.code), st.label === 'bot' ? 'bot' : 'replay'); };
    $('copy-plan').onclick = () => copy(r.code, 'Siege plan copied');
    $('again').onclick = () => { st.replayOf = null; startSiege(); };
  }

  // ------------------------------------------------------------------ build
  function renderBuildUI() {
    const b = st.build;
    $('mats').innerHTML = Object.keys(S.MAT).map(k => `<button class="chip" data-mat="${k}" aria-pressed="${!b.erase && b.mat === k}"><span class="swatch" style="background:${MATCOL[k]}"></span>${S.MAT[k].name} <span class="count">${k === 'h' ? 'free' : S.MAT[k].cost + 'g'}</span></button>`).join('')
      + `<button class="chip" data-erase="1" aria-pressed="${b.erase}">Erase</button>`;
    const shapeNames = { S: 'Block 1×1 m', H: 'Plank 2 m', V: 'Post 2 m', L: 'Beam 3 m' };
    $('shapes').innerHTML = Object.keys(S.SHAPE).map(k => `<button class="chip" data-shape="${k}" aria-pressed="${b.shape === k}" ${b.mat === 'h' && k !== 'S' ? 'disabled' : ''}>${shapeNames[k]}</button>`).join('');
    const spent = S.fortCost(b.pieces), hearts = b.pieces.filter(p => p.m === 'h').length;
    $('meter').classList.toggle('over', spent > S.BUDGET);
    $('meter').firstElementChild.style.width = Math.min(100, spent / S.BUDGET * 100) + '%';
    $('spent').innerHTML = `${spent} / ${S.BUDGET} gold · <span class="heart-ink">♦</span> ${plural(hearts, 'heart')}`;
    if (document.activeElement !== $('fort-name')) $('fort-name').value = b.name;
    $('undo').disabled = !b.undo.length;
    store.set('sw_draft', b.pieces); store.set('sw_draft_name', b.name);
    renderCard();
  }
  function setCheck(msg, kind) { const el = $('check'); el.textContent = msg || ''; el.className = 'check' + (kind ? ' ' + kind : ''); }
  function editPieces(fn) { st.build.undo.push(st.build.pieces.slice()); if (st.build.undo.length > 100) st.build.undo.shift(); fn(); st.build.bad = []; setCheck(''); renderBuildUI(); }
  function ghostAt(w) {
    const b = st.build, shape = b.mat === 'h' ? 'S' : b.shape, [gw, gh] = S.SHAPE[shape];
    const p = { m: b.mat, s: shape, x: Math.round(w.x / S.GRID - gw / 2), y: Math.max(0, Math.round(w.y / S.GRID - gh / 2)) };
    const fits = S.canPlace(b.pieces, p), affordable = p.m === 'h' || S.pieceCost(p) <= S.BUDGET - S.fortCost(b.pieces);
    return { p, ok: fits && affordable, fits };
  }
  function pieceAt(w) {
    const gx = w.x / S.GRID, gy = w.y / S.GRID;
    for (let i = st.build.pieces.length - 1; i >= 0; i--) { const r = S.rect(st.build.pieces[i]); if (gx >= r.x0 && gx < r.x1 && gy >= r.y0 && gy < r.y1) return i; }
    return -1;
  }
  // Validate the draft; returns true when the fort may be sieged or shared.
  function validateDraft() {
    const b = st.build;
    if (S.fortCost(b.pieces) > S.BUDGET) { setCheck('This fort costs more than ' + S.BUDGET + ' gold. Remove some pieces.', 'bad'); return false; }
    const c = S.checkFort(pl, b.pieces);
    b.bad = c.lostIdx || [];
    if (!c.ok) { setCheck(c.reason + (c.lostIdx && c.lostIdx.length ? ' The broken pieces are outlined in red.' : ''), 'bad'); return false; }
    setCheck('Stands on its own' + (c.moved ? ', though ' + plural(c.moved, 'piece shifts', 'pieces shift') + ' while settling.' : '.'), 'good');
    return true;
  }

  // ------------------------------------------------------------------ bot
  // A small version of the offline solver: greedy, one shot at a time, run in slices between frames.
  function evaluate(f, plan) {
    const sim = S.createSim(pl, f.pieces, plan, { loadout: f.loadout });
    const lastT = plan.length ? plan[plan.length - 1].t : S.SETTLE;
    while (sim.tick < lastT + 420) {
      sim.step();
      if (sim.heartsLeft() === 0) break;
      if (sim.tick > lastT + 90 && sim.isQuiet()) break;
    }
    const dead = sim.hearts.filter(h => !h.alive).length;
    const dmg = sim.hearts.reduce((a, h) => a + (h.alive ? Math.min(1, h.dmg / h.hp) : 1), 0);
    const broken = sim.blocks.filter(b => !b.alive).length;
    const breached = dead === sim.hearts.length && !sim.collapsed;
    return { breached, score: (breached ? 1000 : 0) + dead * 10 + dmg * 3 + broken * 0.05 };
  }
  function* botSearch(f) {
    const lo = f.loadout, left = Object.assign({}, lo);
    const total = Object.values(lo).reduce((a, b) => a + b, 0);
    const SAMPLES = 26, REFINE = 8, perShot = SAMPLES + 2 * REFINE;
    const plan = []; let evals = 0;
    for (let k = 0; k < total; k++) {
      const t = S.SETTLE + k * 180;
      const types = Object.keys(left).filter(x => left[x] > 0);
      const cands = [];
      for (let n = 0; n < SAMPLES; n++) {
        const s = S.quantizeShot(types[Math.floor(Math.random() * types.length)], t, -5 + Math.random() * 85, 0.25 + Math.random() * 0.75);
        cands.push({ s, ev: evaluate(f, plan.concat([s])) });
        yield ++evals / (total * perShot);
      }
      cands.sort((a, b) => b.ev.score - a.ev.score);
      let best = cands[0];
      for (const c of cands.slice(0, 2)) for (let n = 0; n < REFINE; n++) {
        const s = S.quantizeShot(c.s.type, t, c.s.a + (Math.random() - 0.5) * 4, c.s.p + (Math.random() - 0.5) * 0.08);
        const ev = evaluate(f, plan.concat([s]));
        if (ev.score > best.ev.score) best = { s, ev };
        yield ++evals / (total * perShot);
      }
      plan.push(best.s); left[best.s.type]--;
      if (best.ev.breached) break;
    }
    return plan;
  }
  function runJob(gen, done) { st.job = { gen, done, progress: 0 }; }
  function pumpJob() {
    const j = st.job; if (!j) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 12) {
      const r = j.gen.next();
      if (r.done) { st.job = null; j.done(r.value); return; }
      j.progress = r.value;
    }
  }

  // ------------------------------------------------------------------ mode
  function setMode(m) {
    st.mode = m;
    $('tab-siege').setAttribute('aria-selected', m === 'siege'); $('tab-build').setAttribute('aria-selected', m === 'build');
    $('siege-tray').hidden = m !== 'siege'; $('build-tray').hidden = m !== 'build';
    if (m === 'build') renderBuildUI(); else renderSiegeUI();
    renderResult(); // hides the result card outside siege mode
    renderCard();
  }

  // ------------------------------------------------------------------ input
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    AU.unlock();
    if (st.job) return;
    const w = toWorld(e);
    if (st.mode === 'siege') {
      if (!st.sim || st.result || st.readonly) return;
      cv.setPointerCapture(e.pointerId);
      st.aim = { sx: e.clientX, sy: e.clientY };
    } else {
      const b = st.build;
      if (e.button === 2 || b.erase) { const i = pieceAt(w); if (i >= 0) editPieces(() => b.pieces.splice(i, 1)); return; }
      const g = ghostAt(w);
      if (g.ok) { editPieces(() => b.pieces.push(g.p)); AU.click(); }
      else toast(g.fits ? 'Not enough gold for that piece.' : 'That spot is taken or outside the build zone.');
    }
  });
  cv.addEventListener('pointermove', e => {
    st.hover = toWorld(e);
    if (st.mode === 'siege' && st.aim) {
      const dx = st.aim.sx - e.clientX, dy = e.clientY - st.aim.sy; // pull back: the shot flies opposite to the drag
      const len = Math.hypot(dx, dy);
      if (len > 6) setAim(Math.max(-10, Math.min(85, Math.atan2(dy, dx) * 180 / Math.PI)), Math.max(5, Math.min(100, len / (cv.clientWidth * 0.32) * 100)));
    }
  });
  cv.addEventListener('pointerup', () => { if (st.aim) { st.aim = null; fire(); } });
  cv.addEventListener('pointercancel', () => { st.aim = null; });
  cv.addEventListener('pointerleave', () => { st.hover = null; });
  function setAim(a, p) { $('angle').value = a.toFixed(1); $('power').value = p.toFixed(1); syncAimOut(); }
  function syncAimOut() { $('angle-out').textContent = (+$('angle').value).toFixed(1) + '°'; $('power-out').textContent = (+$('power').value).toFixed(1) + '%'; }
  $('angle').addEventListener('input', syncAimOut); $('power').addEventListener('input', syncAimOut);
  $('fire').onclick = fire;
  $('reset').onclick = () => { st.replayOf = null; startSiege(); };
  $('fort-pick').onchange = (e) => { st.fortIdx = +e.target.value; st.replayOf = null; startSiege(); };
  $('ammo').onclick = (e) => { const b = e.target.closest('[data-ammo]'); if (b && !b.disabled) { st.ammoSel = b.dataset.ammo; renderSiegeUI(); } };
  $('tab-siege').onclick = () => { if (!st.job) setMode('siege'); };
  $('tab-build').onclick = () => { if (!st.job) setMode('build'); };
  $('sound').onclick = () => { AU.setMuted(!AU.isMuted()); syncSound(); };
  function syncSound() { const on = !AU.isMuted(); $('sound').textContent = on ? 'Sound on' : 'Sound off'; $('sound').setAttribute('aria-pressed', on); }
  $('mats').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.erase) st.build.erase = !st.build.erase; else { st.build.mat = b.dataset.mat; st.build.erase = false; }
    renderBuildUI();
  };
  $('shapes').onclick = (e) => { const b = e.target.closest('[data-shape]'); if (b && !b.disabled) { st.build.shape = b.dataset.shape; renderBuildUI(); } };
  $('fort-name').oninput = (e) => { st.build.name = e.target.value; store.set('sw_draft_name', st.build.name); renderCard(); };
  $('undo').onclick = () => undo();
  function undo() { const prev = st.build.undo.pop(); if (prev) { st.build.pieces = prev; st.build.bad = []; setCheck(''); renderBuildUI(); } }
  $('clear-fort').onclick = () => { if (st.build.pieces.length) editPieces(() => { st.build.pieces = []; }); };
  $('copy-fort').onclick = () => { if (!st.job && validateDraft()) copy(S.encodeFort(st.build.name, st.build.pieces), 'Fort code copied'); };
  $('test-fort').onclick = () => {
    if (st.job || !validateDraft()) return;
    st.fortIdx = addCustomFort(st.build.name, st.build.pieces); setMode('siege'); startSiege();
  };
  $('bot-fort').onclick = () => {
    if (st.job || !validateDraft()) return;
    AU.unlock();
    const idx = addCustomFort(st.build.name, st.build.pieces), f = st.forts[idx];
    setCheck('The bot is planning its attack…', '');
    runJob(botSearch(f), (plan) => { st.fortIdx = idx; st.replayOf = null; setCheck(''); setMode('siege'); startSiege(plan, 'bot'); });
  };
  $('load-btn').onclick = () => {
    const txt = $('load-text').value.trim(); $('load-err').textContent = '';
    if (st.job) return;
    try {
      if (txt.startsWith('SP1')) {
        const plan = S.decodePlan(txt); st.replayOf = null; setMode('siege'); startSiege(plan, 'replay');
        toast('Replaying the plan against ' + currentFort().name);
      } else {
        const f = S.decodeFort(txt);
        const c = S.checkFort(pl, f.pieces);
        if (!c.ok) throw new Error('This fort cannot be sieged: ' + c.reason);
        if (S.fortCost(f.pieces) > S.BUDGET) throw new Error('This fort costs more than ' + S.BUDGET + ' gold.');
        st.fortIdx = addCustomFort(f.name, f.pieces); setMode('siege'); startSiege();
        toast('Loaded ' + f.name);
      }
    } catch (e) { $('load-err').textContent = e.message; }
  };
  window.addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input[type=text], textarea, select')) return;
    if (st.mode === 'build') { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); } return; }
    const fine = e.shiftKey ? 0.2 : 1;
    if (e.key === ' ' || e.key === 'Enter') { if (e.target.tagName === 'BUTTON') return; e.preventDefault(); fire(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setAim(Math.max(-10, Math.min(85, +$('angle').value + (e.key === 'ArrowRight' ? -0.5 : 0.5) * fine)), +$('power').value); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setAim(+$('angle').value, Math.max(5, Math.min(100, +$('power').value + (e.key === 'ArrowUp' ? 1 : -1) * fine))); }
  });

  // ------------------------------------------------------------------ loop
  function tickSim(dt) {
    const sim = st.sim; if (!sim) return;
    if (st.slow > 0) { st.slow -= dt; dt *= 0.3; }
    st.acc += dt; let n = 0;
    while (st.acc >= S.DT && n < 6) {
      st.acc -= S.DT; n++;
      sim.step();
      while (st.evSeen < sim.events.length) handleEvent(sim.events[st.evSeen++]);
      if (!st.result) { const o = sim.outcome(); if (o) onOutcome(o); }
      if (st.result && sim.tick > st.result.tick + 400) { st.acc = 0; break; } // freeze once the dust settles
    }
    if (n) updateStatus();
  }
  function handleEvent(ev) {
    switch (ev.k) {
      case 'launch': AU.launch(ev.m); break;
      case 'hit':
        AU.hit(ev.m, ev.e);
        if (ev.e > 120) { st.flashes.push({ x: ev.x, y: ev.y, life: 1, r: Math.min(1.6, 0.3 + Math.log10(ev.e) * 0.3) }); bump(Math.min(9, Math.log10(ev.e) * 2.4)); }
        break;
      case 'break': AU.breakBlock(ev.m); debris(ev, 9); break;
      case 'heart': AU.heart(); debris(ev, 16); bump(8); if (!reduceMotion) st.slow = 0.9; break;
      case 'blast': AU.blast(); bump(14); break;
    }
  }
  function bump(px) { if (!reduceMotion) st.shake = Math.max(st.shake, px); }
  function debris(ev, k) {
    if (reduceMotion) k = Math.ceil(k / 3);
    const sz = ev.m === 'h' ? 0.5 : 0.6;
    for (let i = 0; i < k; i++) st.parts.push({ x: ev.x + (Math.random() - 0.5) * sz, y: ev.y + (Math.random() - 0.5) * sz, vx: (Math.random() - 0.5) * 9, vy: Math.random() * 8, life: 1, s: 0.1 + Math.random() * 0.22, c: MATCOL[ev.m] || C.chalk, rot: Math.random() * 6 });
  }

  // ------------------------------------------------------------------ draw
  function draw(dt) {
    const W = cv.width / dpr, H = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.sheet; ctx.fillRect(0, 0, W, H);
    if (st.shake > 0.2) { ctx.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake); st.shake *= Math.pow(0.0025, dt); } else st.shake = 0;
    // grid: 1 m minor, 5 m major
    ctx.lineWidth = 1;
    for (let x = Math.ceil(VIEW.x0); x <= VIEW.x1; x++) { ctx.strokeStyle = x % 5 ? 'rgba(120,170,220,0.10)' : 'rgba(140,190,240,0.24)'; ctx.beginPath(); ctx.moveTo(X(x) + 0.5, -20); ctx.lineTo(X(x) + 0.5, H + 20); ctx.stroke(); }
    for (let y = Math.ceil(VIEW.y0); y <= VIEW.y1; y++) { ctx.strokeStyle = y % 5 ? 'rgba(120,170,220,0.10)' : 'rgba(140,190,240,0.24)'; ctx.beginPath(); ctx.moveTo(-20, Y(y) + 0.5); ctx.lineTo(W + 20, Y(y) + 0.5); ctx.stroke(); }
    // ground and hatching
    ctx.strokeStyle = C.chalk; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-20, Y(0)); ctx.lineTo(W + 20, Y(0)); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(-20, Y(0), W + 40, H - Y(0) + 20); ctx.clip(); ctx.strokeStyle = 'rgba(230,240,250,0.22)'; ctx.lineWidth = 1;
    for (let x = -H; x < W + 20; x += 9) { ctx.beginPath(); ctx.moveTo(x, H + 20); ctx.lineTo(x + (H + 20 - Y(0)), Y(0)); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = C['chalk-dim']; ctx.font = `${Math.max(9, scale * 0.9)}px "IBM Plex Mono", monospace`; ctx.textAlign = 'center';
    for (let x = 0; x <= 60; x += 10) ctx.fillText(x + ' m', X(x), Y(-1.6));
    // launcher mound and trebuchet
    ctx.fillStyle = C.sheet; ctx.strokeStyle = C.chalk; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(8), Y(0)); ctx.lineTo(X(6.5), Y(1.8)); ctx.lineTo(X(2), Y(1.8)); ctx.closePath(); ctx.fill(); ctx.stroke();
    drawTrebuchet();
    // build zone
    const z = S.ZONE, G = S.GRID;
    ctx.setLineDash([6, 5]); ctx.strokeStyle = st.mode === 'build' ? C.pencil : 'rgba(255,205,77,0.22)'; ctx.lineWidth = 1;
    ctx.strokeRect(X(z.x0 * G), Y(z.y1 * G), (z.x1 - z.x0) * G * scale, z.y1 * G * scale); ctx.setLineDash([]);

    if (st.mode === 'build') {
      ctx.fillStyle = C.pencil; ctx.textAlign = 'left'; ctx.font = `${Math.max(9, scale * 0.9)}px "IBM Plex Mono", monospace`;
      ctx.fillText('BUILD ZONE  26 × 18 m', X(z.x0 * G) + 4, Y(z.y1 * G) - 6);
      st.build.pieces.forEach((p, i) => {
        const [w, h] = S.SHAPE[p.s];
        drawBlock(p.m, (p.x + w / 2) * G, (p.y + h / 2) * G, w * G, h * G, 0, 0);
        if (st.build.bad.includes(i)) { ctx.strokeStyle = C.bad; ctx.lineWidth = 2.5; ctx.strokeRect(X(p.x * G) - 1, Y((p.y + h) * G) - 1, w * G * scale + 2, h * G * scale + 2); }
      });
      if (st.hover && !st.job) {
        if (st.build.erase) {
          const i = pieceAt(st.hover);
          if (i >= 0) { const r = S.rect(st.build.pieces[i]); ctx.strokeStyle = C.bad; ctx.lineWidth = 2; ctx.strokeRect(X(r.x0 * G), Y(r.y1 * G), (r.x1 - r.x0) * G * scale, (r.y1 - r.y0) * G * scale); }
        } else {
          const g = ghostAt(st.hover), [w, h] = S.SHAPE[g.p.s];
          ctx.globalAlpha = 0.55; drawBlock(g.p.m, (g.p.x + w / 2) * G, (g.p.y + h / 2) * G, w * G, h * G, 0, 0); ctx.globalAlpha = 1;
          ctx.strokeStyle = g.ok ? C.pencil : C.bad; ctx.lineWidth = 1.5; ctx.strokeRect(X(g.p.x * G), Y((g.p.y + h) * G), w * G * scale, h * G * scale);
        }
      }
      if (st.job) drawJob(W, H);
      return;
    }
    const sim = st.sim; if (!sim) return;
    drawTrails(sim);
    for (const b of sim.blocks) { if (!b.alive) continue; const p = b.body.getPosition(); drawBlock(b.mat, p.x, p.y, b.w, b.h, b.body.getAngle(), Math.min(1, b.dmg / b.hp)); }
    for (const s of sim.shots) {
      if (s.dead) continue; const p = s.body.getPosition();
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), s.r * scale, 0, Math.PI * 2);
      ctx.fillStyle = s.type === 'pot' ? '#ff9a3c' : C.chalk; ctx.fill();
      if (s.type === 'pot') { ctx.strokeStyle = C.pencil; ctx.lineWidth = 2; ctx.stroke(); }
      if (s.type === 'boulder') { ctx.strokeStyle = C.sheet; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), s.r * scale * 0.55, 0.4, 2.2); ctx.stroke(); }
    }
    for (const bl of sim.blasts) {
      const age = sim.tick - bl.t; if (age > 30) continue;
      const k = age / 30, r = k * S.AMMO.pot.blast;
      ctx.beginPath(); ctx.arc(X(bl.x), Y(bl.y), r * scale, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,154,60,${0.25 * (1 - k)})`; ctx.fill();
      ctx.strokeStyle = `rgba(255,205,77,${1 - k})`; ctx.lineWidth = 3; ctx.stroke();
    }
    for (const fl of st.flashes) {
      fl.life -= dt * 4;
      if (fl.life <= 0) continue;
      ctx.beginPath(); ctx.arc(X(fl.x), Y(fl.y), (1 - fl.life) * fl.r * scale + 2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(230,240,250,${fl.life})`; ctx.lineWidth = 2; ctx.stroke();
    }
    st.flashes = st.flashes.filter(fl => fl.life > 0);
    // debris (visual only, not part of the simulation)
    for (const q of st.parts) {
      q.vy -= 18 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt * 0.8; q.rot += dt * 5;
      if (q.y < q.s / 2) { q.y = q.s / 2; q.vy *= -0.3; q.vx *= 0.7; }
      ctx.save(); ctx.globalAlpha = Math.max(0, q.life); ctx.translate(X(q.x), Y(q.y)); ctx.rotate(q.rot); ctx.fillStyle = q.c; ctx.fillRect(-q.s * scale / 2, -q.s * scale / 2, q.s * scale, q.s * scale); ctx.restore();
    }
    st.parts = st.parts.filter(q => q.life > 0);
    if (!st.result && !st.readonly && sim.tick >= S.SETTLE && sim.ammoFree(st.ammoSel) > 0) drawArc();
    if (sim.tick < S.SETTLE && !st.readonly) banner('FORT SETTLING…');
    if (st.result) {
      const r = st.result, f = currentFort();
      const txt = r.outcome === 'breached' ? (st.label === 'bot' ? 'BOT BREACHED IT' : 'BREACHED') : r.outcome === 'held' ? 'THE FORT HELD' : 'COLLAPSED';
      banner(txt + (r.stars ? '   ' + starText(r.stars) : ''), true);
    } else if (st.label === 'bot') banner('BOT ATTACK');
  }
  function banner(text, big) {
    const W = cv.width / dpr;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.pencil; ctx.textAlign = 'center';
    ctx.font = `${big ? 900 : 700} ${Math.max(big ? 18 : 13, scale * (big ? 2.4 : 1.3))}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
    ctx.fillText(text, W / 2, Y(19.5));
    ctx.restore();
  }
  function drawJob(W, H) {
    const p = st.job.progress;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(10,39,70,0.72)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.pencil; ctx.textAlign = 'center';
    ctx.font = `700 ${Math.max(14, scale * 1.6)}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
    ctx.fillText('THE BOT IS PLANNING ITS ATTACK  ' + Math.round(p * 100) + '%', W / 2, H / 2 - 10);
    const bw = Math.min(320, W * 0.6);
    ctx.strokeStyle = C.pencil; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - bw / 2, H / 2 + 4, bw, 8);
    ctx.fillRect(W / 2 - bw / 2, H / 2 + 4, bw * Math.min(1, p), 8);
    ctx.restore();
  }
  function drawTrails(sim) {
    const n = sim.shots.length;
    sim.shots.forEach((s, i) => {
      const latest = i === n - 1, a = latest ? 0.75 : 0.28, tr = s.trail;
      ctx.fillStyle = latest ? `rgba(255,205,77,${a})` : `rgba(230,240,250,${a})`;
      for (let k = 0; k + 1 < tr.length; k += 6) { ctx.beginPath(); ctx.arc(X(tr[k]), Y(tr[k + 1]), latest ? 1.8 : 1.3, 0, Math.PI * 2); ctx.fill(); }
    });
  }
  function drawTrebuchet() {
    const L = S.LAUNCH, a = +$('angle').value * Math.PI / 180;
    ctx.strokeStyle = C.chalk; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(3), Y(1.8)); ctx.lineTo(X(L.x - 0.4), Y(L.y - 0.2)); ctx.lineTo(X(6), Y(1.8)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(L.x), Y(L.y)); ctx.lineTo(X(L.x - Math.cos(a) * 2.2), Y(L.y - Math.sin(a) * 2.2)); ctx.stroke();
    ctx.beginPath(); ctx.arc(X(L.x), Y(L.y), 3, 0, Math.PI * 2); ctx.fillStyle = C.pencil; ctx.fill();
  }
  function drawArc() {
    const L = S.LAUNCH, a = +$('angle').value * Math.PI / 180, v = +$('power').value / 100 * S.MAXV;
    const vx = Math.cos(a) * v, vy = Math.sin(a) * v;
    ctx.fillStyle = C.pencil;
    for (let t = 0.05; t < 0.9; t += 0.05) {
      const x = L.x + vx * t, y = L.y + vy * t - 5 * t * t;
      if (y < 0) break;
      ctx.globalAlpha = 1 - t; ctx.beginPath(); ctx.arc(X(x), Y(y), 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawBlock(m, x, y, w, h, ang, dmg) {
    ctx.save(); ctx.translate(X(x), Y(y)); ctx.rotate(-ang);
    const pw = w * scale, ph = h * scale;
    if (m === 'h') {
      const t = performance.now() / 600;
      ctx.shadowColor = C.heart; ctx.shadowBlur = reduceMotion ? 8 : 8 + Math.sin(t) * 4;
      ctx.beginPath(); ctx.moveTo(0, -ph / 2); ctx.lineTo(pw / 2, 0); ctx.lineTo(0, ph / 2); ctx.lineTo(-pw / 2, 0); ctx.closePath();
      ctx.fillStyle = C.heart; ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = C.chalk; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-pw / 4, -ph / 4); ctx.lineTo(0, -ph / 2 + 2); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
      if (dmg > 0.2) { ctx.strokeStyle = `rgba(10,25,45,${0.3 + dmg * 0.6})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-pw * 0.15, -ph * 0.3); ctx.lineTo(pw * 0.05, 0); ctx.lineTo(-pw * 0.05, ph * 0.3); ctx.stroke(); }
    } else {
      ctx.fillStyle = MATCOL[m]; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.strokeStyle = 'rgba(10,30,55,0.55)'; ctx.lineWidth = 1;
      if (m === 'w') { for (let i = 1; i < 3; i++) { const yy = -ph / 2 + ph * i / 3; ctx.beginPath(); ctx.moveTo(-pw / 2 + 2, yy); ctx.lineTo(pw / 2 - 2, yy); ctx.stroke(); } }
      if (m === 's') { ctx.beginPath(); ctx.moveTo(-pw / 2, 0); ctx.lineTo(pw / 2, 0); ctx.stroke(); }
      if (m === 'i') { ctx.fillStyle = 'rgba(230,240,250,0.8)'; const r = Math.max(1, scale * 0.06); for (const sx of [-1, 1]) for (const sy of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * (pw / 2 - r * 3), sy * (ph / 2 - r * 3), r, 0, Math.PI * 2); ctx.fill(); } }
      if (dmg > 0.15) { ctx.strokeStyle = `rgba(10,25,45,${0.25 + dmg * 0.6})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-pw * 0.3, -ph / 2); ctx.lineTo(-pw * 0.05, -ph * 0.05); ctx.lineTo(pw * 0.2, ph * 0.1); if (dmg > 0.5) { ctx.moveTo(-pw * 0.05, -ph * 0.05); ctx.lineTo(-pw * 0.25, ph / 2); } ctx.stroke(); }
      ctx.strokeStyle = C.chalk; ctx.lineWidth = 1; ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
    }
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.1, st.last ? (now - st.last) / 1000 : 0); st.last = now;
    pumpJob();
    if (st.mode === 'siege') tickSim(dt);
    draw(dt);
    const name = st.mode === 'build' ? (st.build.name || 'My Fort') : currentFort().name;
    $('titleblock').innerHTML = `<b>${escapeHtml(name)}</b><br>${st.mode === 'siege' && st.sim ? 'tick ' + st.sim.tick : 'grid 0.5 m'} · ${S.VERSION}`;
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  $('simver').textContent = S.VERSION;
  resize(); syncAimOut(); syncSound(); startSiege(); setMode('siege');
  requestAnimationFrame(frame);
})();
