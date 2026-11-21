// accuracy of the deterministic trig against the engine's own (V8 = fdlibm, itself <1 ulp)
const D = require('./detmath.js');
const f = new Float64Array(1), u = new BigInt64Array(f.buffer);
const bits = (x) => { f[0] = x; const b = u[0]; return b < 0n ? -(b & 0x7fffffffffffffffn) : b; };
const ulps = (a, b) => { const d = bits(a) - bits(b); return Number(d < 0n ? -d : d); };
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ranges = [[1e-9, 1e-6], [-0.8, 0.8], [-7, 7], [-1000, 1000], [-1e5, 1e5]];
for (const [fn, nat] of [['sin', Math.sin], ['cos', Math.cos], ['atan', Math.atan]]) {
  const out = [];
  for (const [lo, hi] of ranges) {
    let max = 0, n1 = 0, N = 200000;
    for (let i = 0; i < N; i++) { const x = lo + (hi - lo) * rnd(); const e = ulps(D[fn](x), nat(x)); if (e > max) max = e; if (e >= 1) n1++; }
    out.push(`[${lo},${hi}] max ${max} ulp, ${(n1 / N * 100).toFixed(3)}% differ`);
  }
  console.log(fn.padEnd(5), out.join(' | '));
}
let max = 0;
for (let i = 0; i < 200000; i++) { const y = (rnd() - 0.5) * 20, x = (rnd() - 0.5) * 20; max = Math.max(max, ulps(D.atan2(y, x), Math.atan2(y, x))); }
console.log('atan2 max', max, 'ulp; specials', [D.atan2(0, 1), D.atan2(-0, 1), D.atan2(0, -1), D.atan2(1, 0), D.atan2(-1, -1)].join(','), 'native', [Math.atan2(0, 1), Math.atan2(-0, 1), Math.atan2(0, -1), Math.atan2(1, 0), Math.atan2(-1, -1)].join(','));
