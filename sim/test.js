// Headless test suite. Run: node test.js
require('./detmath.js').install();          // must precede planck, exactly as in the page
const pl = require('planck'), SW = require('./core.js');
let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { fails++; console.log('  FAIL', msg); } };
const runOut = (sim, cap = 6000) => { let o; while (!(o = sim.outcome()) && sim.tick < cap) sim.step(); return o; };

console.log('campaign forts');
for (const f of SW.campaign()) {
  const c = SW.checkFort(pl, f.pieces);
  ok(c.ok && SW.fortCost(f.pieces) <= SW.BUDGET, `${f.name}: stands on its own, ${SW.fortCost(f.pieces)}/${SW.BUDGET} gold`);
  const back = SW.decodeFort(SW.encodeFort(f.name, f.pieces));
  ok(back.name === f.name && JSON.stringify(back.pieces) === JSON.stringify(f.pieces), `${f.name}: fort code round-trips`);
}

console.log('live siege vs replay of its plan code');
for (const f of SW.campaign().slice(2, 5)) {
  const live = SW.createSim(pl, f.pieces, [], { loadout: f.loadout });
  const shots = [[110, 'boulder', 31.37, 0.81234], [330, 'stone', 22.04, 0.7577], [560, 'stone', 12.2, 0.95], [700, 'stone', 44.4, 0.5], [800, 'pot', 40, 0.6]];
  let o;
  while (!(o = live.outcome()) && live.tick < 6000) {
    for (const [t, type, a, p] of shots) if (live.tick === t && live.ammoFree(type) > 0) live.fireNow(type, a, p);
    live.step();
  }
  const code = SW.encodePlan(live.fired);
  const rep = SW.createSim(pl, f.pieces, SW.decodePlan(code), { loadout: f.loadout });
  const o2 = runOut(rep);
  ok(o === o2 && live.tick === rep.tick && SW.stateHash(live) === SW.stateHash(rep), `${f.name}: ${o} at tick ${live.tick}, replay ${o2} at ${rep.tick}, hash ${SW.stateHash(live)} = ${SW.stateHash(rep)}`);
}

console.log('validation');
const floating = [{ m: 'h', s: 'S', x: 90, y: 30 }];
const fc = SW.checkFort(pl, floating);
ok(!fc.ok && fc.heartsLost === 1, `a heart dropped from 15 m is rejected: "${fc.reason}"`);
const csim = SW.createSim(pl, floating, []);
ok(runOut(csim) === 'collapsed', 'a siege on a self-collapsing fort ends as collapsed, never as a win');
ok(!SW.checkFort(pl, [{ m: 's', s: 'S', x: 90, y: 0 }]).ok, 'a fort with no heart is rejected');
const f0 = SW.campaign()[0];
const early = SW.createSim(pl, f0.pieces, [{ type: 'stone', t: 10, a: 30, p: 0.8 }], { loadout: f0.loadout });
runOut(early, 800);
ok(early.fired.length === 0 && early.plan[0].rejected, 'a shot before the fort settles is rejected');
const greedy = SW.createSim(pl, f0.pieces, [0, 1, 2, 3].map(k => ({ type: 'stone', t: 100 + k * 50, a: 70, p: 0.2 })), { loadout: f0.loadout });
runOut(greedy);
ok(greedy.fired.length === 3, `a plan with 4 stones against a 3-stone loadout fires only 3 (fired ${greedy.fired.length})`);
const boulderless = SW.createSim(pl, f0.pieces, [{ type: 'boulder', t: 100, a: 30, p: 0.8 }], { loadout: f0.loadout });
runOut(boulderless, 600);
ok(boulderless.fired.length === 0, 'ammo outside the loadout is rejected');
let threw = 0;
for (const junk of ['', 'SW1', 'SW1.x.', 'SW1.x.zz0000', 'SW1.x.hS0000', 'SW1.x.sS1c0', 'SW2.x.sS1c00', 'SW1.x.hSzz00']) { try { const d = SW.decodeFort(junk); if (junk === 'SW1.x.' && d.pieces.length === 0) threw++; } catch (e) { threw++; } }
ok(threw === 8, 'malformed fort codes are refused');
let pthrew = 0;
for (const junk of ['', 'SP2.s2i~1~1', 'SP1.q2i~1~1', 'SP1.s2i~~']) { try { SW.decodePlan(junk); } catch (e) { pthrew++; } }
ok(pthrew === 4, 'malformed siege plans are refused');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
