const det = process.argv[2] === 'det', n = +(process.argv[3] || 40);
if (det) require('../detmath.js').install();
const pl = require('planck'), SW = require('../core.js'), battery = require('./crosscheck.js');
const t0 = Date.now(); const out = battery(pl, SW, n);
console.log(JSON.stringify({ engine: 'node-v8', det, ms: Date.now() - t0, trig: [Math.sin(1e5 + 0.1234567), Math.cos(3.3), Math.sin(0.7)].join(','), out }));
