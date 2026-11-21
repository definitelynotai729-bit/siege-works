// Offline siege solver: proves every campaign fort can be breached and measures par.
// Greedy search, one shot at a time: sample random shots, refine the best few, keep the winner.
// Usage: node solve.js [restarts=4] [samples=150]   (one worker thread per fort and restart)
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

if (isMainThread) {
  const SW = require('./core.js');
  const restarts = +(process.argv[2] || 4), samples = +(process.argv[3] || 150);
  const forts = SW.campaign();
  const jobs = [];
  forts.forEach((f, i) => { for (let r = 0; r < restarts; r++) jobs.push({ i, r, samples }); });
  const results = [];
  let running = 0, next = 0;
  const cores = Math.min(12, Math.max(1, os.cpus().length - 4));
  const t0 = Date.now();
  function launch() {
    while (running < cores && next < jobs.length) {
      const job = jobs[next++]; running++;
      const w = new Worker(__filename, { workerData: job });
      w.on('message', (m) => results.push(m));
      w.on('error', (e) => { console.error(e); });
      w.on('exit', () => { running--; if (next < jobs.length) launch(); else if (running === 0) report(); });
    }
  }
  function report() {
    console.log(`solver: ${restarts} restarts x ${samples} samples per shot, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
    console.log('fort            par  solver  best-shots-by-restart  robust  random-breach  plan');
    forts.forEach((f, i) => {
      const rs = results.filter(x => x.i === i).sort((a, b) => a.r - b.r);
      const wins = rs.filter(x => x.breached);
      const best = wins.length ? wins.reduce((a, b) => (b.shots < a.shots || (b.shots === a.shots && b.robust > a.robust)) ? b : a) : null;
      const rnd = rs.length ? rs[0].randomBreach : 0;
      const suggested = best ? best.shots + (best.robust < 0.5 ? 1 : 0) : '-';
      console.log(`${f.name.padEnd(15)} ${String(f.par).padStart(3)}  ${String(suggested).padStart(6)}  ${rs.map(x => x.breached ? x.shots : 'x').join(',').padEnd(21)}  ${best ? (best.robust * 100).toFixed(0).padStart(4) + '%' : '    -'}  ${(rnd * 100).toFixed(1).padStart(12)}%  ${best ? best.code : ''}`);
    });
  }
  launch();
} else {
  require('./detmath.js').install();
  const pl = require('planck');
  const SW = require('./core.js');
  const { i, r, samples } = workerData;
  const f = SW.campaign()[i];
  let seed = 977 + i * 7919 + r * 104729;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const gauss = () => { let u = 0; for (let k = 0; k < 6; k++) u += rnd(); return u - 3; };
  const GAP = 180; // ticks between shots, roughly a human's pace

  function evaluate(plan) {
    const sim = SW.createSim(pl, f.pieces, plan, { loadout: f.loadout });
    const lastT = plan.length ? plan[plan.length - 1].t : SW.SETTLE;
    while (sim.tick < lastT + 420) {
      sim.step();
      if (sim.heartsLeft() === 0) break;
      if (sim.tick > lastT + 90 && sim.isQuiet()) break;
    }
    const dead = sim.hearts.filter(h => !h.alive).length;
    const dmg = sim.hearts.reduce((a, h) => a + (h.alive ? Math.min(1, h.dmg / h.hp) : 1), 0);
    const broken = sim.blocks.filter(b => !b.alive).length;
    const breached = dead === sim.hearts.length;
    return { breached, score: (breached ? 1000 : 0) + dead * 10 + dmg * 3 + broken * 0.05 };
  }
  function ammoLeft(plan) {
    const left = Object.assign({}, f.loadout);
    for (const s of plan) left[s.type]--;
    return Object.keys(left).filter(k => left[k] > 0);
  }
  const shotAt = (type, t, a, p) => SW.quantizeShot(type, t, a, p);

  const plan = [];
  let breached = false;
  const total = Object.values(f.loadout).reduce((a, b) => a + b, 0);
  for (let k = 0; k < total && !breached; k++) {
    const t = SW.SETTLE + k * GAP, types = ammoLeft(plan);
    const cands = [];
    for (let n = 0; n < samples; n++) {
      const s = shotAt(types[Math.floor(rnd() * types.length)], t, -5 + rnd() * 85, 0.25 + rnd() * 0.75);
      cands.push({ s, ev: evaluate(plan.concat([s])) });
    }
    cands.sort((a, b) => b.ev.score - a.ev.score);
    let best = cands[0];
    for (const c of cands.slice(0, 5)) {
      for (let n = 0; n < 20; n++) {
        const s = shotAt(c.s.type, t, c.s.a + gauss() * 1.5, c.s.p + gauss() * 0.03);
        const ev = evaluate(plan.concat([s]));
        if (ev.score > best.ev.score) best = { s, ev };
      }
    }
    plan.push(best.s);
    breached = best.ev.breached;
  }
  // robustness: how often does a slightly-off final shot still breach?
  let robust = 0;
  if (breached) {
    const last = plan[plan.length - 1], N = 30;
    let ok = 0;
    for (let n = 0; n < N; n++) {
      const s = shotAt(last.type, last.t, last.a + (rnd() - 0.5), last.p + (rnd() - 0.5) * 0.02);
      if (evaluate(plan.slice(0, -1).concat([s])).breached) ok++;
    }
    robust = ok / N;
  }
  // difficulty for a careless attacker: fully random plans
  let randomBreach = 0;
  if (r === 0) {
    const N = 150; let ok = 0;
    for (let n = 0; n < N; n++) {
      const p = []; const left = Object.assign({}, f.loadout); let t = SW.SETTLE;
      for (const type of Object.keys(left)) for (let c = 0; c < left[type]; c++) { p.push(shotAt(type, t, rnd() * 75, 0.4 + rnd() * 0.6)); t += GAP; }
      if (evaluate(p).breached) ok++;
    }
    randomBreach = ok / N;
  }
  parentPort.postMessage({ i, r, breached, shots: plan.length, robust, randomBreach, code: SW.encodePlan(plan) });
}
