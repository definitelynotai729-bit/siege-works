// Tests for the season 0 validator. Run: node ledger/test.js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const SW = require('../sim/core.js');
const { verifyChain } = require('./validate.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
function tx(author, labels, body, now) {
  const res = path.join(dir, 'res.md'), stat = path.join(dir, 'status.txt');
  let exit = 0;
  try {
    execFileSync('node', [path.join(__dirname, 'validate.js')], { stdio: 'pipe', env: Object.assign({}, process.env, {
      ISSUE_BODY: body, ISSUE_AUTHOR: author, ISSUE_NUMBER: String(Math.floor(Math.random() * 1e4) + 1), ISSUE_LABELS: labels,
      RESULT_FILE: res, STATUS_FILE: stat, LEDGER_DIR: dir, NOW: now || '2026-11-21T12:00:00.000Z' }) });
  } catch (e) { exit = e.status; }
  return { status: fs.readFileSync(stat, 'utf8'), text: fs.readFileSync(res, 'utf8'), exit };
}
const ledger = () => JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
const camp = SW.campaign();
const watch = camp.find(f => f.name === 'Watchtower'), bunker = camp.find(f => f.name === 'Bunker');
const form = (code) => `### Fort code\n\n${code}\n`;

let r = tx('alice', 'fort', form(SW.encodeFort('Watchtower', watch.pieces)));
ok(r.status === 'accepted' && /F1 · Watchtower/.test(r.text), 'a valid fort is accepted as F1');
r = tx('bob', 'fort', form(SW.encodeFort('Copycat', watch.pieces)));
ok(r.status === 'rejected' && /already on the board/.test(r.text), 'the same fort under another name is refused');
r = tx('bob', 'fort', 'no code here');
ok(r.status === 'rejected' && /No fort code/.test(r.text), 'an issue without a code is refused');
r = tx('bob', 'fort', form('SW1.Bad.hS2a3c'));
ok(r.status === 'rejected', 'a fort with a heart in mid-air is refused: ' + r.text.split('\n')[0]);
r = tx('bob', 'fort', form(SW.encodeFort('Bunker', bunker.pieces)));
ok(r.status === 'accepted' && /F2/.test(r.text), 'a second fort is accepted as F2');
r = tx('carol', 'siege', `### Fort ID\n\nF1\n\n### Siege plan\n\nSP1.b2i~51~r3\n`);
ok(r.status === 'accepted' && /breached F1 · Watchtower in 1 shot/.test(r.text) && /First breach/.test(r.text), 'a siege is replayed and verified: ' + r.text.split('\n')[0]);
const hash = (/Result hash `([0-9a-f]{8})`/.exec(r.text) || [])[1];
const sim = SW.createSim(require('../sim/node_modules/planck'), watch.pieces, SW.decodePlan('SP1.b2i~51~r3'));
let o; while (!(o = sim.outcome())) sim.step();
ok(hash === SW.stateHash(sim), `the validator's hash ${hash} matches an independent replay ${SW.stateHash(sim)}`);
r = tx('dave', 'siege', `F1 SP1.b2i~51~r3`);
ok(r.status === 'rejected' && /already submitted/.test(r.text), 'a copied plan is refused');
r = tx('alice', 'siege', `F1 SP1.b2i~50~r3`);
ok(r.status === 'accepted' && /your own fort/.test(r.text), 'a siege on your own fort is recorded but marked');
r = tx('dave', 'siege', `F9 SP1.b2i~51~r3`);
ok(r.status === 'rejected' && /no fort F9/.test(r.text), 'a siege on a missing fort is refused');
r = tx('dave', 'siege', `F2 SP1.s1~1~1`);
ok(r.status === 'accepted' && /held/.test(r.text) && /not fired/.test(r.text), 'a premature shot is not fired and the fort holds');
let L = ledger();
ok(!verifyChain(L) && L.seq === 5, 'the hash chain verifies over all 5 accepted entries');
ok(L.stats.F1.sieges === 1 && L.stats.F1.breaches === 1 && L.stats.F1.best.by === 'carol', 'F1 stats exclude the self-siege; record held by carol');
for (const n of ['A', 'B']) tx('erin', 'fort', form(SW.encodeFort('Hut ' + n, [{ m: 'h', s: 'S', x: 80 + (n === 'A' ? 0 : 10), y: 0 }])));
tx('erin', 'fort', form(SW.encodeFort('Hut C', [{ m: 'h', s: 'S', x: 100, y: 0 }])));
r = tx('erin', 'fort', form(SW.encodeFort('Hut D', [{ m: 'h', s: 'S', x: 104, y: 0 }])));
ok(r.status === 'rejected' && /3 forts today/.test(r.text), 'a fourth fort in one day is refused');
r = tx('erin', 'fort', form(SW.encodeFort('Hut D', [{ m: 'h', s: 'S', x: 104, y: 0 }])), '2026-11-22T00:00:01.000Z');
ok(r.status === 'accepted', 'the next UTC day it is accepted');
L = ledger(); L.sieges[0].shots = 0; fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(L));
ok(verifyChain(L) === 'entry 3', 'editing a recorded siege breaks the chain at that entry');
r = tx('frank', 'siege', `F2 SP1.s2i~1~1`);
ok(r.status === 'rejected' && /internal error/.test(r.text) && r.exit === 1, 'the validator refuses to append to a tampered ledger and fails the run');
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
