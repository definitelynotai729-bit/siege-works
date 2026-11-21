// Season 0 validator. Runs in a GitHub Action for every new issue labelled "fort" or "siege".
// Each issue is a transaction; this script replays it with the same deterministic core the game uses,
// appends it to docs/ledger/ledger.json (a hash chain), and writes the reply posted on the issue.
//
// Inputs (environment): ISSUE_BODY, ISSUE_AUTHOR, ISSUE_NUMBER, ISSUE_LABELS (comma-separated),
//   RESULT_FILE (reply markdown), STATUS_FILE ("accepted" | "rejected"), optional LEDGER_DIR and NOW.
// Issue text is untrusted data: it is only ever matched against strict patterns, never evaluated.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
require('../sim/detmath.js').install();                 // before planck, exactly as in the browser
const pl = require(path.join(__dirname, '..', 'sim', 'node_modules', 'planck'));
const SW = require('../sim/core.js');

const SITE = 'https://definitelynotai729-bit.github.io/siege-works/';
const LEDGER_DIR = process.env.LEDGER_DIR || path.join(__dirname, '..', 'docs', 'ledger');
const FILE = path.join(LEDGER_DIR, 'ledger.json');
const MAX_FORTS_PER_DAY = 3, MAX_SIEGES_PER_DAY = 30;

const body = String(process.env.ISSUE_BODY || '').slice(0, 20000);
const author = String(process.env.ISSUE_AUTHOR || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 39);
const issue = parseInt(process.env.ISSUE_NUMBER, 10) || 0;
const labels = String(process.env.ISSUE_LABELS || '').split(',').map(s => s.trim());
const now = process.env.NOW || new Date().toISOString();
const day = now.slice(0, 10);

function loadLedger() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { return { season: 0, sim: SW.VERSION, seq: 0, head: '0'.repeat(64), forts: [], sieges: [] }; }
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Entries are immutable once appended; each one's head commits to the previous head and its own content.
const entryHash = (e) => sha256(e.prev + JSON.stringify(Object.assign({}, e, { head: undefined })));
function append(ledger, list, entry) {
  entry.seq = ledger.seq + 1;
  entry.prev = ledger.head;
  entry.head = entryHash(entry);
  ledger.seq = entry.seq; ledger.head = entry.head;
  list.push(entry);
}
function verifyChain(ledger) {
  const all = ledger.forts.concat(ledger.sieges).sort((a, b) => a.seq - b.seq);
  let head = '0'.repeat(64);
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (e.seq !== i + 1 || e.prev !== head || entryHash(e) !== e.head) return 'entry ' + (i + 1);
    head = e.head;
  }
  return head === ledger.head && all.length === ledger.seq ? null : 'head';
}
// Derived, not hashed: recomputed from the sieges every time the ledger is saved.
function recomputeStats(ledger) {
  ledger.stats = {};
  for (const fort of ledger.forts) {
    const sieges = ledger.sieges.filter(s => s.fort === fort.id && !s.self);
    const wins = sieges.filter(s => s.outcome === 'breached').sort((a, b) => a.shots - b.shots || a.seq - b.seq);
    ledger.stats[fort.id] = { sieges: sieges.length, breaches: wins.length, best: wins.length ? { shots: wins[0].shots, by: wins[0].attacker, siege: wins[0].id } : null };
  }
}
function finish(status, lines) {
  const text = lines.join('\n') + '\n';
  if (process.env.RESULT_FILE) fs.writeFileSync(process.env.RESULT_FILE, text); else process.stdout.write(text);
  if (process.env.STATUS_FILE) fs.writeFileSync(process.env.STATUS_FILE, status); else console.log('status:', status);
}
const reject = (why) => finish('rejected', ['**Not accepted.** ' + why, '', 'Fix it and open a new issue. Nothing was added to the ledger.']);
const mention = (login) => '@' + login;

function main() {
  if (!author || !issue) return reject('The validator could not read who opened this issue.');
  const kind = labels.includes('siege') ? 'siege' : labels.includes('fort') ? 'fort' : null;
  if (!kind) return reject('This issue has neither the fort nor the siege label.');
  const ledger = loadLedger();
  const broken = verifyChain(ledger);
  if (broken) throw new Error('ledger hash chain does not verify at ' + broken + '; refusing to append');

  if (kind === 'fort') {
    const m = /SW1\.[A-Za-z0-9_'-]*\.[A-Za-z0-9]+/.exec(body);
    if (!m) return reject('No fort code found. Fort codes start with `SW1.` and come from the builder\'s "Copy fort code" button.');
    let fort;
    try { fort = SW.decodeFort(m[0]); } catch (e) { return reject(e.message); }
    const cost = SW.fortCost(fort.pieces);
    if (cost > SW.BUDGET) return reject(`This fort costs ${cost} gold; the limit is ${SW.BUDGET}.`);
    const check = SW.checkFort(pl, fort.pieces);
    if (!check.ok) return reject(check.reason);
    const code = SW.encodeFort(fort.name, fort.pieces);
    const dup = ledger.forts.find(f => f.code.split('.')[2] === code.split('.')[2]);
    if (dup) return reject(`This exact fort is already on the board as **${dup.id} · ${dup.name}** by ${mention(dup.builder)}.`);
    const today = ledger.forts.filter(f => f.builder === author && f.at.slice(0, 10) === day).length;
    if (today >= MAX_FORTS_PER_DAY) return reject(`You have already posted ${today} forts today (UTC). The limit is ${MAX_FORTS_PER_DAY} a day.`);
    const entry = { id: 'F' + (ledger.forts.length + 1), name: fort.name, code, builder: author, issue, at: now, sim: SW.VERSION,
                    cost, pieces: fort.pieces.length, hearts: check.hearts };
    append(ledger, ledger.forts, entry);
    save(ledger);
    return finish('accepted', [
      `**Accepted as ${entry.id} · ${entry.name}.**`, '',
      `The validator replayed ${SW.CHECK_TICKS} ticks and the fort stands on its own: ${entry.pieces} pieces, ${entry.hearts} ${entry.hearts === 1 ? 'heart' : 'hearts'}, ${cost} gold.`, '',
      `Siege it: ${SITE}#${entry.id}`, '',
      `Ledger entry ${entry.seq}, head \`${entry.head.slice(0, 16)}\`.`,
    ]);
  }

  // siege
  const fm = /\bF(\d{1,6})\b/.exec(body);
  const pm = /SP1(?:\.[a-z][0-9a-z]{1,8}~[0-9a-z]{1,6}~[0-9a-z]{1,6}){1,40}/.exec(body);
  if (!fm) return reject('No fort ID found. Board fort IDs look like `F12`.');
  if (!pm) return reject('No siege plan found. Plans start with `SP1.` and come from the "Copy siege plan" button after a siege.');
  const fort = ledger.forts.find(f => f.id === 'F' + parseInt(fm[1], 10));
  if (!fort) return reject(`There is no fort F${parseInt(fm[1], 10)} on the board.`);
  let plan;
  try { plan = SW.decodePlan(pm[0]); } catch (e) { return reject(e.message); }
  const planCode = SW.encodePlan(plan);
  const copy = ledger.sieges.find(s => s.fort === fort.id && s.plan === planCode);
  if (copy) return reject(`This exact plan was already submitted against ${fort.id} by ${mention(copy.attacker)} (${copy.id}).`);
  const today = ledger.sieges.filter(s => s.attacker === author && s.at.slice(0, 10) === day).length;
  if (today >= MAX_SIEGES_PER_DAY) return reject(`You have already submitted ${today} sieges today (UTC). The limit is ${MAX_SIEGES_PER_DAY} a day.`);
  const pieces = SW.decodeFort(fort.code).pieces;
  const sim = SW.createSim(pl, pieces, plan);
  let outcome = null;
  while (!(outcome = sim.outcome()) && sim.tick < 20000) sim.step();
  outcome = outcome || 'held';
  const rejected = sim.plan.filter(s => s.rejected).length;
  recomputeStats(ledger);
  const before = ledger.stats[fort.id].best;
  const entry = { id: 'S' + (ledger.sieges.length + 1), fort: fort.id, attacker: author, plan: SW.encodePlan(sim.fired), outcome,
                  shots: sim.fired.length, tick: sim.tick, hash: SW.stateHash(sim), self: author === fort.builder, issue, at: now, sim: SW.VERSION };
  append(ledger, ledger.sieges, entry);
  save(ledger);
  const best = ledger.stats[fort.id].best;
  const record = !entry.self && outcome === 'breached' && best && best.siege === entry.id;
  const lines = [
    outcome === 'breached' ? `**Verified: breached ${fort.id} · ${fort.name} in ${entry.shots} ${entry.shots === 1 ? 'shot' : 'shots'}.**`
                           : `**Verified: ${fort.id} · ${fort.name} held.**`, '',
    `The validator replayed your plan to tick ${entry.tick}. Result hash \`${entry.hash}\` (${SW.VERSION}); your browser shows the same hash for the same plan.`,
  ];
  if (rejected) lines.push('', `${rejected} planned ${rejected === 1 ? 'shot was' : 'shots were'} not fired (before the fort settled or beyond the ammo).`);
  if (entry.self) lines.push('', 'This is your own fort, so the siege is recorded but does not count toward its stats.');
  else if (record) lines.push('', before ? `**New record**, beating ${before.shots} ${before.shots === 1 ? 'shot' : 'shots'} by ${mention(before.by)}.` : '**First breach of this fort.**');
  lines.push('', `Ledger entry ${entry.seq}, head \`${entry.head.slice(0, 16)}\`.`);
  return finish('accepted', lines);
}
function save(ledger) {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
  ledger.updated = now;
  recomputeStats(ledger);
  fs.writeFileSync(FILE, JSON.stringify(ledger, null, 1) + '\n');
}
if (require.main !== module) { module.exports = { verifyChain, recomputeStats }; return; }
try { main(); } catch (e) { console.error(e); finish('rejected', ['**The validator hit an internal error**, so nothing was recorded. The maintainers have been notified by this failed run.']); process.exitCode = 1; }
