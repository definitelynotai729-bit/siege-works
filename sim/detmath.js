// Deterministic sin / cos / atan2 for JavaScript.
//
// ECMAScript leaves Math.sin, Math.cos and Math.atan2 "implementation-approximated", so V8,
// JavaScriptCore and SpiderMonkey may disagree in the last bit. In a chaotic physics simulation that
// one bit grows until two players see different outcomes for the same siege.
//
// Basic arithmetic (+ - * /) and Math.sqrt are exactly specified by IEEE 754 in every engine, so these
// ports of the fdlibm/FreeBSD msun kernels, written only with that arithmetic, give bit-identical
// results everywhere. Accuracy is within about 1 ulp of the true value.
//
// install() must run BEFORE planck.js loads: planck caches Math.sin/Math.cos at load time.
(function (root) {
  'use strict';
  // __kernel_sin / __kernel_cos (FreeBSD msun k_sin.c, k_cos.c), valid on [-pi/4, pi/4]
  const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
        S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
        C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
  function ksin(x, y, iy) {
    const z = x * x, w = z * z, r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6), v = z * x;
    return iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
  }
  function kcos(x, y) {
    const z = x * x, w = z * z, r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
    const hz = 0.5 * z, u = 1 - hz;
    return u + (((1 - u) - hz) + (z * r - x * y));
  }
  // Cody-Waite reduction by pi/2 in three pieces (e_rem_pio2.c medium path, all rounds always taken)
  const INVPIO2 = 6.36619772367581382433e-01,
        PIO2_1 = 1.57079632673412561417e+00, PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21,
        PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
  const PIO4 = 7.85398163397448278999e-01, TINY = 7.450580596923828125e-9; // 2^-27
  let y0 = 0, y1 = 0;
  function rem(x) {
    const fn = Math.round(x * INVPIO2);
    let r = x - fn * PIO2_1;
    let t = r, w = fn * PIO2_2;
    r = t - w; w = fn * PIO2_2T - ((t - r) - w);
    t = r; w = fn * PIO2_3;
    r = t - w; w = fn * PIO2_3T - ((t - r) - w);
    y0 = r - w; y1 = (r - y0) - w;
    return ((fn % 4) + 4) % 4;
  }
  function sin(x) {
    x = +x;
    if (x !== x || x === Infinity || x === -Infinity) return NaN;
    const ax = x < 0 ? -x : x;
    if (ax <= PIO4) return ax < TINY ? x : ksin(x, 0, 0);
    switch (rem(x)) {
      case 0: return ksin(y0, y1, 1);
      case 1: return kcos(y0, y1);
      case 2: return -ksin(y0, y1, 1);
      default: return -kcos(y0, y1);
    }
  }
  function cos(x) {
    x = +x;
    if (x !== x || x === Infinity || x === -Infinity) return NaN;
    const ax = x < 0 ? -x : x;
    if (ax <= PIO4) return ax < TINY ? 1 : kcos(x, 0);
    switch (rem(x)) {
      case 0: return kcos(y0, y1);
      case 1: return -ksin(y0, y1, 1);
      case 2: return -kcos(y0, y1);
      default: return ksin(y0, y1, 1);
    }
  }
  // atan (s_atan.c) and atan2 (e_atan2.c); high-word thresholds rewritten as exact value comparisons
  const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
  const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
  const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
              9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
              4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
  function atan(x) {
    x = +x;
    if (x !== x) return NaN;
    const neg = x < 0 || Object.is(x, -0);
    let ax = neg ? -x : x;
    if (ax >= 73786976294838206464) return neg ? -(ATANHI[3] + ATANLO[3]) : ATANHI[3] + ATANLO[3]; // 2^66
    let id;
    if (ax < 0.4375) {
      if (ax < TINY) return x;
      id = -1; ax = x; // keep the sign; the polynomial is odd
    } else if (ax < 1.1875) {
      if (ax < 0.6875) { id = 0; ax = (2 * ax - 1) / (2 + ax); } else { id = 1; ax = (ax - 1) / (ax + 1); }
    } else if (ax < 2.4375) { id = 2; ax = (ax - 1.5) / (1 + 1.5 * ax); } else { id = 3; ax = -1 / ax; }
    const z = ax * ax, w = z * z;
    const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
    const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    if (id < 0) return ax - ax * (s1 + s2);
    const r = ATANHI[id] - ((ax * (s1 + s2) - ATANLO[id]) - ax);
    return neg ? -r : r;
  }
  const PI = 3.1415926535897931160E+00, PI_O_2 = 1.5707963267948965580E+00, PI_O_4 = 7.8539816339744827900E-01, PI_LO = 1.2246467991473531772E-16;
  function atan2(y, x) {
    y = +y; x = +x;
    if (x !== x || y !== y) return NaN;
    if (x === 1) return atan(y);
    const sy = y < 0 || Object.is(y, -0), sx = x < 0 || Object.is(x, -0);
    const m = (sy ? 1 : 0) | (sx ? 2 : 0);
    if (y === 0) return m === 0 || m === 1 ? y : m === 2 ? PI : -PI;
    if (x === 0) return sy ? -PI_O_2 : PI_O_2;
    if (x === Infinity || x === -Infinity) {
      if (y === Infinity || y === -Infinity) return [PI_O_4, -PI_O_4, 3 * PI_O_4, -3 * PI_O_4][m];
      return [0, -0, PI, -PI][m];
    }
    if (y === Infinity || y === -Infinity) return sy ? -PI_O_2 : PI_O_2;
    const q = Math.abs(y / x);
    let z, mm = m;
    if (q > 1152921504606846976) { z = PI_O_2 + 0.5 * PI_LO; mm = m & 1; } // 2^60
    else if (sx && q < 8.673617379884035e-19) z = 0; // 2^-60
    else z = atan(q);
    switch (mm) {
      case 0: return z;
      case 1: return -z;
      case 2: return PI - (z - PI_LO);
      default: return (z - PI_LO) - PI;
    }
  }
  const api = {
    sin, cos, atan, atan2,
    installed: false,
    install() {
      if (api.installed) return;
      Math.sin = sin; Math.cos = cos; Math.atan = atan; Math.atan2 = atan2;
      api.installed = true;
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SWDetMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
