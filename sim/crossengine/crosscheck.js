// Runs a fixed battery of sieges and returns one result hash per siege.
// Plans come from a seeded LCG, never Math.random, so every engine runs the identical battery.
(function (root) {
  function battery(pl, SW, perFort) {
    let seed = 20261120;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out = [];
    for (const f of SW.sampleForts()) {
      for (let k = 0; k < perFort; k++) {
        const plan = []; let t = SW.SETTLE;
        for (const type of ['stone', 'stone', 'stone', 'boulder', 'pot']) { plan.push({ type, t, a: 5 + rnd() * 70, p: 0.4 + rnd() * 0.6 }); t += 120 + Math.floor(rnd() * 60); }
        const sim = SW.createSim(pl, f.pieces, plan);
        let o = null;
        while (!(o = sim.outcome()) && sim.tick < 2400) sim.step();
        out.push(f.name[0] + k + ':' + (o || 'none')[0] + ':' + SW.stateHash(sim));
      }
    }
    return out;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = battery; else root.battery = battery;
})(typeof window !== 'undefined' ? window : globalThis);
