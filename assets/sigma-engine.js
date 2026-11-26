/* SigmaEngine 0.1.0 — Can Sasmaz Studio sigma tasarım motoru (tarayıcı paketi).
   Kaynak: sigma-designer/engine ve export. Bu dosya üretilir: node tools/build-site.mjs. Elle düzenleme. */
(function (g) {
'use strict';
var __m = {};
__m['engine/expr.js'] = (function () {
// engine/expr.js — güvenli ifade değerlendirici (eval yok).
// Tasarım JSON'undaki boy/konum ifadelerini ("width - 2*P") sayıya çevirir.
// Saf ES modülü: Node ve tarayıcıda aynen çalışır. Tüm değerler mm ya da derece.

const FUNCS = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x, step = 1) => Math.round(x / step) * step,
  sqrt: Math.sqrt,
  hypot: Math.hypot,
  sin: (deg) => Math.sin((deg * Math.PI) / 180),
  cos: (deg) => Math.cos((deg * Math.PI) / 180),
  tan: (deg) => Math.tan((deg * Math.PI) / 180),
  atan2: (y, x) => (Math.atan2(y, x) * 180) / Math.PI,
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  if: (c, a, b) => (c ? a : b),
};

class ExprError extends Error {
  constructor(message, expr) {
    super(expr === undefined ? message : `${message} — ifade: "${expr}"`);
    this.name = 'ExprError';
    this.expr = expr;
  }
}

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_.]*)|(<=|>=|==|!=|&&|\|\||[-+*/%()<>,?:!]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new ExprError(`Tanınmayan karakter (konum ${pos})`, src);
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] });
    pos = re.lastIndex;
  }
  return tokens;
}

// AST: {k:'num',v} | {k:'id',v} | {k:'call',f,args} | {k:'un',op,a} | {k:'bin',op,a,b} | {k:'cond',c,a,b}
function parse(src) {
  if (typeof src === 'number') return { k: 'num', v: src };
  if (typeof src !== 'string') throw new ExprError(`İfade sayı ya da metin olmalı, gelen: ${JSON.stringify(src)}`);
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const eat = (v) => {
    if (!isOp(v)) throw new ExprError(`"${v}" bekleniyordu`, src);
    i++;
  };
  const binLevel = (ops, next) => () => {
    let a = next();
    while (toks[i] && toks[i].t === 'op' && ops.includes(toks[i].v)) {
      const op = toks[i++].v;
      a = { k: 'bin', op, a, b: next() };
    }
    return a;
  };
  function primary() {
    const t = peek();
    if (!t) throw new ExprError('İfade beklenmedik şekilde bitti', src);
    if (t.t === 'num') { i++; return { k: 'num', v: t.v }; }
    if (t.t === 'id') {
      i++;
      if (isOp('(')) {
        i++;
        const args = [];
        if (!isOp(')')) {
          args.push(ternary());
          while (isOp(',')) { i++; args.push(ternary()); }
        }
        eat(')');
        return { k: 'call', f: t.v, args };
      }
      return { k: 'id', v: t.v };
    }
    if (isOp('(')) { i++; const e = ternary(); eat(')'); return e; }
    throw new ExprError(`Beklenmeyen simge "${t.v}"`, src);
  }
  function unary() {
    if (isOp('-') || isOp('+') || isOp('!')) {
      const op = toks[i++].v;
      return { k: 'un', op, a: unary() };
    }
    return primary();
  }
  const mul = binLevel(['*', '/', '%'], unary);
  const add = binLevel(['+', '-'], mul);
  const cmp = binLevel(['<', '<=', '>', '>=', '==', '!='], add);
  const and = binLevel(['&&'], cmp);
  const or = binLevel(['||'], and);
  function ternary() {
    const c = or();
    if (isOp('?')) {
      i++;
      const a = ternary();
      eat(':');
      const b = ternary();
      return { k: 'cond', c, a, b };
    }
    return c;
  }
  const ast = ternary();
  if (i < toks.length) throw new ExprError(`Fazladan simge "${toks[i].v}"`, src);
  return ast;
}

/** İfadede geçen değişken adları (bağımlılık sıralaması için). */
function identifiers(src) {
  const out = new Set();
  (function walk(n) {
    if (n.k === 'id') out.add(n.v);
    else if (n.k === 'call') n.args.forEach(walk);
    else if (n.k === 'un') walk(n.a);
    else if (n.k === 'bin') { walk(n.a); walk(n.b); }
    else if (n.k === 'cond') { walk(n.c); walk(n.a); walk(n.b); }
  })(parse(src));
  return [...out];
}

function evalAst(n, scope, src) {
  switch (n.k) {
    case 'num': return n.v;
    case 'id': {
      if (!Object.prototype.hasOwnProperty.call(scope, n.v)) throw new ExprError(`Tanımsız değişken "${n.v}"`, src);
      const v = scope[n.v];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ExprError(`"${n.v}" sayı değil`, src);
      return v;
    }
    case 'call': {
      const f = Object.prototype.hasOwnProperty.call(FUNCS, n.f) ? FUNCS[n.f] : null;
      if (!f) throw new ExprError(`Tanımsız fonksiyon "${n.f}"`, src);
      return f(...n.args.map((a) => evalAst(a, scope, src)));
    }
    case 'un': {
      const a = evalAst(n.a, scope, src);
      return n.op === '-' ? -a : n.op === '!' ? (a ? 0 : 1) : a;
    }
    case 'cond': return evalAst(n.c, scope, src) ? evalAst(n.a, scope, src) : evalAst(n.b, scope, src);
    case 'bin': {
      const a = evalAst(n.a, scope, src);
      if (n.op === '&&') return a ? (evalAst(n.b, scope, src) ? 1 : 0) : 0;
      if (n.op === '||') return a ? 1 : (evalAst(n.b, scope, src) ? 1 : 0);
      const b = evalAst(n.b, scope, src);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw new ExprError('Sıfıra bölme', src); return a / b;
        case '%': if (b === 0) throw new ExprError('Sıfıra bölme', src); return a % b;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return Math.abs(a - b) < 1e-9 ? 1 : 0;
        case '!=': return Math.abs(a - b) < 1e-9 ? 0 : 1;
      }
    }
  }
  throw new ExprError('Geçersiz ifade ağacı', src);
}

/** Tek ifadeyi verilen kapsamda (ad → sayı) değerlendirir. Sayı verilirse aynen döner. */
function evaluate(src, scope = {}) {
  if (typeof src === 'number') {
    if (!Number.isFinite(src)) throw new ExprError('Sonlu olmayan sayı');
    return src;
  }
  const v = evalAst(parse(src), scope, src);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ExprError('Sonuç sonlu bir sayı değil', src);
  return v;
}

/**
 * Birbirine bağlı adlandırılmış ifadeleri (derived) bağımlılık sırasıyla çözer.
 * @param {Object<string, number|string>} defs  ad → ifade
 * @param {Object<string, number>} base  önceden bilinen değerler (params, sabitler)
 * @returns {Object<string, number>} base + çözülen değerler
 */
function resolveAll(defs, base = {}) {
  const scope = { ...base };
  const state = {}; // ad → 1 (işleniyor) | 2 (bitti)
  const visit = (name, chain) => {
    if (state[name] === 2) return;
    if (state[name] === 1) throw new ExprError(`Döngüsel tanım: ${[...chain, name].join(' → ')}`);
    state[name] = 1;
    const src = defs[name];
    if (typeof src === 'string') {
      for (const dep of identifiers(src)) {
        if (Object.prototype.hasOwnProperty.call(defs, dep)) visit(dep, [...chain, name]);
      }
    }
    try {
      scope[name] = evaluate(src, scope);
    } catch (e) {
      throw new ExprError(`"${name}" çözülemedi: ${e.message}`);
    }
    state[name] = 2;
  };
  for (const name of Object.keys(defs)) {
    if (Object.prototype.hasOwnProperty.call(base, name)) throw new ExprError(`"${name}" hem parametre/sabit hem türetilmiş ad olarak tanımlı`);
    visit(name, []);
  }
  return scope;
}

return { ExprError, parse, identifiers, evaluate, resolveAll };
})();

__m['engine/geom.js'] = (function () {
// engine/geom.js — kutu geometrisi, temas ve çarpışma (katlanma kinematiği için OBB/SAT).
// Koordinat sistemi: X = genişlik (sol→sağ), Y = derinlik (ön→arka), Z = yükseklik (yukarı). Birim mm, açı derece.
// Saf ES modülü; bağımlılık yok.

const AXES = ['x', 'y', 'z'];
const axisIndex = (a) => {
  const i = AXES.indexOf(a);
  if (i < 0) throw new Error(`Geçersiz eksen "${a}" (x, y ya da z olmalı)`);
  return i;
};

const EPS = 0.05; // mm; bunun altındaki fark "aynı" sayılır

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (i) => [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];

/** Eksen hizalı kutu: { min:[x,y,z], max:[x,y,z] } */
function box(min, max) {
  for (let i = 0; i < 3; i++) {
    if (!(max[i] >= min[i])) throw new Error(`Geçersiz kutu: ${AXES[i]} ekseninde max < min (${min[i]} … ${max[i]})`);
  }
  return { min: [...min], max: [...max] };
}
const boxSize = (b) => sub(b.max, b.min);
const boxCenter = (b) => scale(add(b.min, b.max), 0.5);
function boxUnion(boxes) {
  if (!boxes.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], b.min[i]);
    max[i] = Math.max(max[i], b.max[i]);
  }
  return { min, max };
}

/** Her eksende örtüşme miktarı (negatif = aralık). */
function overlap(a, b) {
  return [0, 1, 2].map((i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]));
}

/** İki kutu hacimce iç içe mi? (yüzey teması çarpışma sayılmaz) */
function boxesCollide(a, b, tol = EPS) {
  const o = overlap(a, b);
  return o[0] > tol && o[1] > tol && o[2] > tol;
}

/**
 * Yüzey teması: bir eksende aralık ≈ 0 (|aralık| ≤ tol), diğer iki eksende örtüşme > tol.
 * @returns {null | {axis:number, dir:1|-1, plane:number, area:number, rect:{min:number[],max:number[]}}}
 *   dir: b, a'nın + tarafındaysa +1.
 */
function boxContact(a, b, tol = EPS) {
  const o = overlap(a, b);
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, k = (i + 2) % 3;
    if (Math.abs(o[i]) <= tol && o[j] > tol && o[k] > tol) {
      const dir = boxCenter(b)[i] >= boxCenter(a)[i] ? 1 : -1;
      const plane = dir === 1 ? a.max[i] : a.min[i];
      const rmin = [0, 0, 0], rmax = [0, 0, 0];
      for (const m of [j, k]) {
        rmin[m] = Math.max(a.min[m], b.min[m]);
        rmax[m] = Math.min(a.max[m], b.max[m]);
      }
      rmin[i] = rmax[i] = plane;
      return { axis: i, dir, plane, area: o[j] * o[k], rect: { min: rmin, max: rmax } };
    }
  }
  return null;
}

// ---------- Yönlü kutu (OBB) ve dönme ----------

/** Rodrigues: v'yi birim eksen k etrafında deg derece döndürür. */
function rotateVec(v, k, deg) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** Noktayı, pivot noktasından geçen eksen etrafında döndürür. */
function rotatePoint(p, pivot, axisVec, deg) {
  return add(pivot, rotateVec(sub(p, pivot), axisVec, deg));
}

/** OBB: { c:merkez, u:[3 birim eksen], e:[3 yarı boy] } */
function obbFromBox(b) {
  return { c: boxCenter(b), u: [unit(0), unit(1), unit(2)], e: scale(boxSize(b), 0.5) };
}

/** Kutuyu pivot ekseninde döndürüp OBB verir. axis: 'x'|'y'|'z' ya da birim vektör. */
function rotateBox(b, pivot, axis, deg) {
  const k = typeof axis === 'string' ? unit(axisIndex(axis)) : scale(axis, 1 / norm(axis));
  const o = obbFromBox(b);
  return { c: rotatePoint(o.c, pivot, k, deg), u: o.u.map((u) => rotateVec(u, k, deg)), e: o.e };
}

/** Kutuyu öteleme (çekmece vb.). */
function translateBox(b, d) {
  return { min: add(b.min, d), max: add(b.max, d) };
}

/** OBB'yi saran eksen hizalı kutu. */
function obbAabb(o) {
  const r = [0, 1, 2].map((i) => Math.abs(o.u[0][i]) * o.e[0] + Math.abs(o.u[1][i]) * o.e[1] + Math.abs(o.u[2][i]) * o.e[2]);
  return { min: sub(o.c, r), max: add(o.c, r) };
}

/**
 * İki OBB hacimce iç içe mi? Ayırıcı eksen teoremi (15 eksen).
 * tol: bu kadar mm'ye kadar girişim (temas, sıkı geçme) çarpışma sayılmaz.
 */
function obbCollide(a, b, tol = EPS) {
  const d = sub(b.c, a.c);
  const axes = [...a.u, ...b.u];
  for (const ua of a.u) for (const ub of b.u) {
    const c = cross(ua, ub);
    const n = norm(c);
    if (n > 1e-6) axes.push(scale(c, 1 / n));
  }
  for (const L of axes) {
    const ra = a.e[0] * Math.abs(dot(a.u[0], L)) + a.e[1] * Math.abs(dot(a.u[1], L)) + a.e[2] * Math.abs(dot(a.u[2], L));
    const rb = b.e[0] * Math.abs(dot(b.u[0], L)) + b.e[1] * Math.abs(dot(b.u[1], L)) + b.e[2] * Math.abs(dot(b.u[2], L));
    if (Math.abs(dot(d, L)) > ra + rb - tol) return false; // ayırıcı eksen bulundu
  }
  return true;
}

/** Yuvarlama: kesim boyları 0,1 mm çözünürlükte tutulur (kayan nokta artıklarını siler). */
const round01 = (x) => Math.round(x * 10) / 10;

return { AXES, axisIndex, EPS, add, sub, scale, dot, cross, norm, unit, box, boxSize, boxCenter, boxUnion, overlap, boxesCollide, boxContact, rotateVec, rotatePoint, obbFromBox, rotateBox, translateBox, obbAabb, obbCollide, round01 };
})();

__m['engine/loads.js'] = (function () {
// engine/loads.js — kiriş sehim ve gerilme hesabı (Euler-Bernoulli, küçük sehim).
// Birimler: mm, N, MPa (N/mm²). Kütle → kuvvet: N = kg * 9.81.
// Sigma birleşimleri tam ankastre değildir; varsayılan mesnet "simple" (güvenli taraf).

const G = 9.81; // m/s²
const E_ALU = 70000; // MPa, alüminyum 6063

// [sehim katsayısı k_d, moment katsayısı k_m]:  δ = k_d · F·L³/(E·I),  M = k_m · F·L   (F = toplam yük, N)
const CASES = {
  'simple:point': [1 / 48, 1 / 4], // iki ucu mesnetli, ortada tekil yük
  'simple:udl': [5 / 384, 1 / 8], // iki ucu mesnetli, yayılı yük (toplam F)
  'cantilever:point': [1 / 3, 1], // konsol, uçta tekil yük
  'cantilever:udl': [1 / 8, 1 / 2], // konsol, yayılı yük (toplam F)
  'fixed:point': [1 / 192, 1 / 8], // iki ucu ankastre, ortada tekil yük
  'fixed:udl': [1 / 384, 1 / 12], // iki ucu ankastre, yayılı yük
};

/**
 * @param {object} o
 * @param {number} o.L       serbest açıklık (mm)
 * @param {number} o.F       toplam yük (N)
 * @param {number} o.I       atalet momenti (mm⁴)
 * @param {number} o.W       mukavemet momenti (mm³)
 * @param {'simple'|'cantilever'|'fixed'} [o.support='simple']
 * @param {'point'|'udl'} [o.load='udl']
 * @param {number} [o.E=E_ALU]
 * @returns {{deflection:number, stress:number, ratio:number}} sehim (mm), eğilme gerilmesi (MPa), L/δ oranı
 */
function beam({ L, F, I, W, support = 'simple', load = 'udl', E = E_ALU }) {
  const c = CASES[`${support}:${load}`];
  if (!c) throw new Error(`Bilinmeyen kiriş durumu: ${support}:${load}`);
  for (const [k, v] of Object.entries({ L, F, I, W })) {
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw new Error(`Kiriş hesabı: "${k}" geçersiz (${v})`);
  }
  const deflection = (c[0] * F * L ** 3) / (E * I);
  const stress = (c[1] * F * L) / W;
  return { deflection, stress, ratio: deflection > 0 ? L / deflection : Infinity };
}

/** Verilen sehim sınırı (L/limitRatio) ve gerilme sınırı için taşınabilir en büyük toplam yük (N). */
function maxLoad({ L, I, W, support = 'simple', load = 'udl', E = E_ALU, limitRatio = 200, stressLimit = 70 }) {
  const c = CASES[`${support}:${load}`];
  if (!c) throw new Error(`Bilinmeyen kiriş durumu: ${support}:${load}`);
  const byDeflection = (L / limitRatio) * E * I / (c[0] * L ** 3);
  const byStress = (stressLimit * W) / (c[1] * L);
  return { F: Math.min(byDeflection, byStress), byDeflection, byStress, governs: byDeflection <= byStress ? 'sehim' : 'gerilme' };
}

/** Verilen toplam yük için izin verilen en büyük açıklık (mm), ikiye bölme ile. */
function maxSpan({ F, I, W, support = 'simple', load = 'udl', E = E_ALU, limitRatio = 200, stressLimit = 70 }) {
  let lo = 1, hi = 6000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (maxLoad({ L: mid, I, W, support, load, E, limitRatio, stressLimit }).F >= F) lo = mid; else hi = mid;
  }
  return lo;
}

return { G, E_ALU, beam, maxLoad, maxSpan };
})();

__m['engine/solver.js'] = (function () {
// engine/solver.js — tasarım JSON'unu (sigma-design/1) çözülmüş modele (sigma-solved/1) çevirir.
// Profil boyları burada HESAPLANIR; tasarım dosyasında boy yazılmaz. Kesim listesi, BOM, montaj ve 3D
// yalnızca bu fonksiyonun çıktısını okur. Saf ES modülü (Node + tarayıcı). Birim mm, kg, derece.
//
// Koordinatlar: X genişlik, Y derinlik, Z yükseklik. Üyenin "a" ucu düşük, "b" ucu yüksek koordinattır.
// Uç tipleri:
//   { pos: ifade }      serbest uç, tam o koordinatta biter (uç kapağı ya da "with" aksesuarı takılır)
//   { onto: üyeId }     alın birleşimi: uç, o üyenin yan yüzüne kadar gelir (boy kendiliğinden kısalır)
//   { corner: ifade }   3 yollu köşede boydan geçen üye: dış ölçü koordinatı verilir, uç through_deduct kadar içeride biter

const { evaluate, resolveAll } = __m['engine/expr.js'];
const { AXES, axisIndex, box, boxContact, boxUnion, boxSize, boxCenter, boxesCollide, round01, EPS } = __m['engine/geom.js'];
const CONSTANTS = { P20: 20, P40: 40 };
const KEYS = {
  design: ['schema', 'name', 'title', 'description', 'class', 'params', 'derived', 'members', 'panels', 'mechanisms', 'accessories', 'loads'],
  member: ['id', 'profile', 'axis', 'at', 'a', 'b', 'group', 'role', 'note'],
  end: ['pos', 'onto', 'corner', 'with', 'cap'],
  panel: ['id', 'material', 'mount', 'between', 'insert', 'normal', 'origin', 'size', 'fix', 'group', 'note'],
  mechanism: ['id', 'type', 'group', 'axis', 'pivot', 'range', 'travel', 'hardware', 'count', 'note'],
  accessory: ['item', 'qty', 'on', 'note'],
  load: ['on', 'kg', 'type', 'support', 'span', 'note'],
};
const HINTS = {
  length: 'boy yazılmaz; solver uçlardan hesaplar',
  from: 'uçlar "a" ve "b" ile tanımlanır',
  to: 'uçlar "a" ve "b" ile tanımlanır',
  start: 'konum "at", uçlar "a" ve "b" ile verilir',
  position: 'konum "at" ile verilir',
  fasteners: 'cıvatalar birleşim tipinin reçetesinden gelir',
  joints: 'birleşimler üye uçlarındaki "onto" / "corner" tanımlarından kendiliğinden çıkar',
};
const END_NAMES = ['a', 'b'];

/** Tanınmayan alanları hata olarak bildirir (yazım hatası ya da elle yazılmış boy sessizce yok sayılmasın). */
function unknownKeys(list, obj, kind, ref) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const k of Object.keys(obj)) {
    if (!KEYS[kind].includes(k)) issue(list, 'E-SCHEMA', `Tanınmayan alan "${k}"${HINTS[k] ? ` (${HINTS[k]})` : ''}. Geçerli alanlar: ${KEYS[kind].join(', ')}`, ref);
  }
}

function issue(list, code, msg, ref) {
  list.push({ level: 'error', code, msg, ref: ref ?? null });
}

/** Reçeteyi ({item, qty}) çözer. '@tnut:self' / '@tnut:onto' birleşimdeki profillerin, '@tnut:on' (M5) ve '@tnut4:on' (M4)
 *  donanımın takıldığı üyenin profiline uygun T-somuna çevrilir. */
function resolveRecipe(recipe, ctx, times = 1) {
  const out = [];
  for (const r of recipe || []) {
    let item = r.item;
    if (item === '@tnut:self') item = ctx.self?.tnut;
    else if (item === '@tnut:onto') item = (ctx.onto ?? ctx.self)?.tnut;
    else if (item === '@tnut:on') item = ctx.on?.tnut;
    else if (item === '@tnut4:on') item = ctx.on?.tnut_m4;
    if (!item) continue;
    out.push({ item, qty: r.qty * times });
  }
  return out;
}

/**
 * @param {object} design   sigma-design/1 nesnesi
 * @param {object} catalog  engine/catalog.js loadCatalog() çıktısı
 * @returns {{ ok: boolean, issues: object[], model: object|null }}
 */
function solve(design, catalog) {
  const issues = [];
  const err = (code, msg, ref) => issue(issues, code, msg, ref);
  const fail = () => ({ ok: false, issues, model: null });

  if (!design || typeof design !== 'object') { err('E-SCHEMA', 'Tasarım bir JSON nesnesi olmalı'); return fail(); }
  if (design.schema !== 'sigma-design/1') err('E-SCHEMA', `schema "sigma-design/1" olmalı (gelen: ${JSON.stringify(design.schema)})`);
  if (!design.name || !/^[a-z0-9-]+$/.test(design.name)) err('E-SCHEMA', 'name zorunlu; küçük harf, rakam ve tire içermeli');
  if (!Array.isArray(design.members) || design.members.length === 0) { err('E-SCHEMA', 'members boş olamaz'); return fail(); }
  unknownKeys(issues, design, 'design', 'tasarım');
  design.members.forEach((m, i) => {
    const ref = `members[${i}]${m && m.id ? ` (${m.id})` : ''}`;
    unknownKeys(issues, m, 'member', ref);
    for (const e of END_NAMES) unknownKeys(issues, m?.[e], 'end', `${ref}.${e}`);
  });
  (design.panels || []).forEach((x, i) => unknownKeys(issues, x, 'panel', `panels[${i}]${x && x.id ? ` (${x.id})` : ''}`));
  (design.mechanisms || []).forEach((x, i) => unknownKeys(issues, x, 'mechanism', `mechanisms[${i}]${x && x.id ? ` (${x.id})` : ''}`));
  (design.accessories || []).forEach((x, i) => unknownKeys(issues, x, 'accessory', `accessories[${i}]`));
  (design.loads || []).forEach((x, i) => unknownKeys(issues, x, 'load', `loads[${i}]`));

  // ---- 1. Parametreler ve türetilmiş değerler ----
  let scope;
  try {
    const params = {};
    for (const [k, v] of Object.entries(design.params || {})) {
      if (k in CONSTANTS) throw new Error(`"${k}" ayrılmış sabit adıdır`);
      params[k] = evaluate(v, CONSTANTS);
    }
    scope = resolveAll(design.derived || {}, { ...CONSTANTS, ...params });
  } catch (e) { err('E-EXPR', e.message, 'params/derived'); return fail(); }
  const ev = (src, ref) => {
    try { return evaluate(src, scope); } catch (e) { err('E-EXPR', e.message, ref); return NaN; }
  };

  // ---- 2. Üyeler: kesit, eksen, yan konum ----
  const members = new Map();
  for (const [i, m] of design.members.entries()) {
    const ref = `members[${i}]${m && m.id ? ` (${m.id})` : ''}`;
    if (!m || typeof m !== 'object' || !m.id) { err('E-SCHEMA', 'Üyenin id alanı zorunlu', ref); continue; }
    if (members.has(m.id)) { err('E-SCHEMA', `Üye id'si tekrar ediyor: ${m.id}`, ref); continue; }
    const profile = catalog.profiles[m.profile];
    if (!profile) { err('E-REF', `Katalogda olmayan profil: ${JSON.stringify(m.profile)}`, ref); continue; }
    if (!AXES.includes(m.axis)) { err('E-SCHEMA', 'axis "x", "y" ya da "z" olmalı', ref); continue; }
    const ai = axisIndex(m.axis);
    const lat = [0, 1, 2].filter((k) => k !== ai);
    const at = [NaN, NaN, NaN];
    if (!m.at || typeof m.at !== 'object') { err('E-SCHEMA', 'at zorunlu (üyenin iki yan eksendeki alt köşe koordinatı)', ref); continue; }
    for (const k of lat) {
      if (m.at[AXES[k]] === undefined) err('E-SCHEMA', `at.${AXES[k]} eksik`, ref);
      else at[k] = ev(m.at[AXES[k]], `${ref}.at.${AXES[k]}`);
    }
    if (m.at[m.axis] !== undefined) err('E-SCHEMA', `at.${m.axis} verilmemeli: üyenin kendi eksenindeki konumu uçlardan (a, b) gelir`, ref);
    for (const e of END_NAMES) {
      const end = m[e];
      const kinds = end && typeof end === 'object' ? ['pos', 'onto', 'corner'].filter((k) => end[k] !== undefined) : [];
      if (kinds.length !== 1) err('E-SCHEMA', `"${e}" ucu tam olarak bir tane pos / onto / corner içermeli`, ref);
    }
    members.set(m.id, { src: m, ref, id: m.id, profileId: m.profile, profile, size: profile.size, ai, lat, at, group: m.group ?? null, role: m.role ?? null, ends: {}, coord: {} });
  }
  if (issues.length) return fail();

  // ---- 3. Uç koordinatları ----
  const joints = [];
  const cornerByEnd = new Map(); // "üye:uç" → köşe birleşimi
  for (const m of members.values()) {
    for (const e of END_NAMES) {
      const end = m.src[e];
      const ref = `${m.ref}.${e}`;
      if (end.pos !== undefined) {
        m.coord[e] = ev(end.pos, ref);
        m.ends[e] = { kind: 'free', cap: end.cap !== false, with: end.with ?? null };
      } else if (end.corner !== undefined) {
        const jtId = end.with ?? m.profile.default_corner;
        const jt = jtId ? catalog.joints[jtId] : null;
        if (!jt || jt.kind !== 'corner3') { err('E-REF', `Bu profil için 3 yollu köşe birleşimi yok: ${JSON.stringify(jtId)}`, ref); continue; }
        if (!jt.profiles.includes(m.profileId)) { err('E-REF', `${jtId} birleşimi ${m.profileId} ile kullanılamaz`, ref); continue; }
        const outer = ev(end.corner, ref);
        m.coord[e] = e === 'a' ? outer + jt.through_deduct : outer - jt.through_deduct;
        const j = { id: null, type: jtId, kind: 'corner3', through: `${m.id}:${e}`, onto: m.id, outer, ends: [], group: m.group };
        joints.push(j);
        cornerByEnd.set(`${m.id}:${e}`, j);
        m.ends[e] = { kind: 'corner', joint: j, outer };
      } else {
        const o = members.get(end.onto);
        if (!o) { err('E-REF', `onto: böyle bir üye yok: ${JSON.stringify(end.onto)}`, ref); continue; }
        if (o.id === m.id) { err('E-REF', 'Üye kendisine dayanamaz', ref); continue; }
        if (o.ai === m.ai) { err('E-BUTT-PARALLEL', `${m.id} ile ${o.id} aynı eksende; alın birleşimi dik iki üye arasında olur`, ref); continue; }
        if (o.group !== m.group) { err('E-GROUP', `${m.id} (grup: ${m.group ?? 'sabit'}) başka gruptaki ${o.id} üyesine dayanamaz; hareketli gruplar mekanizmayla bağlanır`, ref); continue; }
        // Dayanılan üyenin, bu üyenin ekseni boyunca kapladığı aralık yalnızca onun yan konumuna bağlıdır.
        m.coord[e] = e === 'a' ? o.at[m.ai] + o.size : o.at[m.ai];
        m.ends[e] = { kind: 'butt', onto: o.id, with: end.with ?? null };
      }
    }
  }
  if (issues.length) return fail();

  // ---- 4. Boylar ve kutular ----
  for (const m of members.values()) {
    const { a, b } = m.coord;
    if (!(b - a > EPS)) { err('E-LENGTH', `${m.id}: boy sıfır ya da negatif çıktı (a=${round01(a)}, b=${round01(b)}); uç tanımlarını kontrol et`, m.ref); continue; }
    m.length = round01(b - a);
    const min = [0, 0, 0], max = [0, 0, 0];
    min[m.ai] = a; max[m.ai] = b;
    for (const k of m.lat) { min[k] = m.at[k]; max[k] = m.at[k] + m.size; }
    m.box = box(min, max);
  }
  if (issues.length) return fail();

  // ---- 5. Alın birleşimleri: temas doğrulama, köşeye bağlama, plaka gruplama ----
  const buttGroups = new Map();
  for (const m of members.values()) {
    for (const e of END_NAMES) {
      const end = m.ends[e];
      if (end.kind !== 'butt') continue;
      const ref = `${m.ref}.${e}`;
      const o = members.get(end.onto);
      const c = boxContact(m.box, o.box);
      if (!c || c.axis !== m.ai) {
        err('E-BUTT-NOCONTACT', `${m.id} ucu "${e}", ${o.id} üyesinin yan yüzüne değmiyor (konumlar ya da ${o.id} boyu tutmuyor)`, ref);
        continue;
      }
      // Dayanılan üyenin bu noktaya komşu bir köşe ucu var mı? (üye, köşenin dış ölçüsüyle hizalıysa köşe bağlantısına katılır)
      let corner = null;
      for (const oe of END_NAMES) {
        const cj = cornerByEnd.get(`${o.id}:${oe}`);
        if (!cj) continue;
        const lo = m.at[o.ai], hi = m.at[o.ai] + m.size;
        if ((oe === 'a' && Math.abs(lo - cj.outer) <= EPS) || (oe === 'b' && Math.abs(hi - cj.outer) <= EPS)) corner = cj;
      }
      const explicit = end.with ? catalog.joints[end.with] : null;
      if (end.with && !explicit) { err('E-REF', `Katalogda olmayan birleşim tipi: ${JSON.stringify(end.with)}`, ref); continue; }
      if (corner && (!explicit || explicit.kind === 'corner3')) {
        if (explicit && end.with !== corner.type) { err('E-CORNER', `${m.id}:${e} "${end.with}" istiyor ama ${o.id} köşesi "${corner.type}"`, ref); continue; }
        corner.ends.push(`${m.id}:${e}`);
        end.joint = corner;
        continue;
      }
      if (explicit && explicit.kind === 'corner3') {
        err('E-CORNER', `${m.id}:${e} köşe bağlantısı istiyor ama ${o.id} üyesinin o tarafında "corner" ucu yok ya da üye köşenin dış ölçüsüyle hizalı değil`, ref);
        continue;
      }
      const jtId = end.with ?? m.profile.default_butt;
      const jt = catalog.joints[jtId];
      if (!jt || jt.kind !== 'butt') { err('E-REF', `Alın birleşim tipi bulunamadı: ${JSON.stringify(jtId)}`, ref); continue; }
      const along = round01((m.at[o.ai] + m.size / 2)); // dayanılan üye boyunca konum
      const key = `${jtId}|${o.id}|${along}`;
      if (!buttGroups.has(key)) buttGroups.set(key, { jtId, jt, onto: o, along, list: [] });
      buttGroups.get(key).list.push({ m, e, center: boxCenter(c.rect) });
    }
  }
  for (const g of buttGroups.values()) {
    const cap = g.jt.max_ends || 1;
    for (let i = 0; i < g.list.length; i += cap) {
      const chunk = g.list.slice(i, i + cap);
      const node = chunk[0].center.map((_, k) => chunk.reduce((s, x) => s + x.center[k], 0) / chunk.length);
      const j = { id: null, type: g.jtId, kind: 'butt', through: null, onto: g.onto.id, ends: chunk.map((x) => `${x.m.id}:${x.e}`), node, group: chunk[0].m.group };
      joints.push(j);
      for (const x of chunk) x.m.ends[x.e].joint = j;
    }
  }
  if (issues.length) return fail();

  // Köşe düğüm noktaları ve reçeteler
  const hardwareLines = []; // {item, qty, source}
  const addHw = (list, source) => { for (const h of list) hardwareLines.push({ ...h, source }); };
  joints.forEach((j, i) => { j.id = `J${String(i + 1).padStart(2, '0')}`; });
  for (const j of joints) {
    const jt = catalog.joints[j.type];
    const onto = members.get(j.onto);
    if (j.kind === 'corner3') {
      const [mid, e] = j.through.split(':');
      const m = members.get(mid);
      const node = boxCenter(m.box);
      node[m.ai] = j.outer;
      j.node = node;
      j.hardware = resolveRecipe(jt.hardware, { self: m.profile, onto: m.profile });
      for (const en of j.ends) {
        const bm = members.get(en.split(':')[0]);
        if (!jt.profiles.includes(bm.profileId)) err('E-REF', `${j.type} birleşimi ${bm.profileId} profiliyle kullanılamaz (${bm.id})`, bm.ref);
      }
      void e;
    } else {
      const first = members.get(j.ends[0].split(':')[0]);
      if (!jt.profiles.includes(first.profileId)) err('E-REF', `${j.type} birleşimi ${first.profileId} profiliyle kullanılamaz (${first.id})`, first.ref);
      if (!jt.onto_profiles.includes(onto.profileId)) err('E-REF', `${j.type} birleşimi ${onto.profileId} profiline dayanamaz (${first.id} → ${onto.id})`, first.ref);
      j.hardware = resolveRecipe(jt.hardware, { self: first.profile, onto: onto.profile });
    }
    j.operations = jt.operations ? [...jt.operations] : [];
    addHw(j.hardware, { joint: j.id });
  }

  // ---- 6. Serbest uçlar: uç kapağı ya da aksesuar ----
  const accessories = [];
  const firstMember = members.values().next().value;
  const memberOps = new Map(); // üyeId → [işlem metni...] (birleşim dışı işlemler, ör. ayak için uç dişi)
  const addAccessory = (itemId, qty, on, source, ref) => {
    const acc = catalog.accessories[itemId] ?? catalog.mechanisms[itemId];
    if (!acc) { err('E-REF', `Katalogda olmayan aksesuar: ${JSON.stringify(itemId)}`, ref); return; }
    const host = on ? members.get(String(on).split(':')[0]) : null;
    if (host && acc.profiles && !acc.profiles.includes(host.profileId)) {
      err('E-REF', `${itemId} aksesuarı ${host.profileId} profiline takılamaz (uygun: ${acc.profiles.join(', ')})`, ref);
      return;
    }
    if (source === 'end' && acc.mount && acc.mount !== 'end') { err('E-REF', `${itemId} profil ucuna takılan bir aksesuar değil; accessories listesine yaz`, ref); return; }
    accessories.push({ item: itemId, kind: acc.kind ?? null, qty, on: on ?? null, source });
    hardwareLines.push({ item: itemId, qty, source: { accessory: itemId, on: on ?? null } });
    addHw(resolveRecipe(acc.hardware, { on: (host ?? firstMember).profile }, qty), { accessory: itemId, on: on ?? null });
    if (host && acc.operations) {
      if (!memberOps.has(host.id)) memberOps.set(host.id, []);
      for (let n = 0; n < qty; n++) memberOps.get(host.id).push(...acc.operations);
    }
  };
  for (const m of members.values()) {
    for (const e of END_NAMES) {
      const end = m.ends[e];
      if (end.kind !== 'free') continue;
      if (end.with) { addAccessory(end.with, 1, `${m.id}:${e}`, 'end', `${m.ref}.${e}`); end.accessory = end.with; }
      else if (end.cap && m.profile.cap) { addAccessory(m.profile.cap, 1, `${m.id}:${e}`, 'auto-cap', `${m.ref}.${e}`); end.accessory = m.profile.cap; }
    }
  }
  for (const [i, a] of (design.accessories || []).entries()) {
    const ref = `accessories[${i}]`;
    if (a.on !== undefined && !members.has(a.on)) { err('E-REF', `on: böyle bir üye yok: ${JSON.stringify(a.on)}`, ref); continue; }
    const qty = ev(a.qty ?? 1, ref);
    if (!(qty > 0 && Number.isInteger(qty))) { err('E-SCHEMA', 'qty pozitif tam sayı olmalı', ref); continue; }
    addAccessory(a.item, qty, a.on, 'explicit', ref);
  }

  // ---- 7. Paneller ----
  const groupsUsed = new Set([...members.values()].map((m) => m.group).filter(Boolean));
  const panels = [];
  const panelIds = new Set();
  for (const [i, p] of (design.panels || []).entries()) {
    const ref = `panels[${i}]${p && p.id ? ` (${p.id})` : ''}`;
    if (!p || !p.id) { err('E-SCHEMA', 'Panelin id alanı zorunlu', ref); continue; }
    if (panelIds.has(p.id) || members.has(p.id)) { err('E-SCHEMA', `Panel id'si başka bir parçayla çakışıyor: ${p.id}`, ref); continue; }
    panelIds.add(p.id);
    const mat = catalog.panels[p.material];
    if (!mat) { err('E-REF', `Katalogda olmayan panel malzemesi: ${JSON.stringify(p.material)}`, ref); continue; }
    if (!mat.mounts.includes(p.mount)) { err('E-REF', `${p.material} "${p.mount}" montajına uygun değil (uygun: ${mat.mounts.join(', ')})`, ref); continue; }
    const t = mat.thickness;
    let pbox, normal, opening = null, between = null, group = p.group ?? null, hw = [], notch = null, insert = null;
    if (p.mount === 'slot') {
      const bs = (p.between || []).map((id) => members.get(id));
      if (bs.length !== 4 || bs.some((b) => !b)) { err('E-PANEL-BETWEEN', 'slot paneli için between tam 4 geçerli üye id\'si içermeli', ref); continue; }
      const axesUsed = [...new Set(bs.map((b) => b.ai))];
      const count = (k) => bs.filter((b) => b.ai === k).length;
      if (axesUsed.length !== 2 || count(axesUsed[0]) !== 2) { err('E-PANEL-BETWEEN', 'between üyeleri iki eksende ikişer tane olmalı (dikdörtgen bir açıklığı çevrelemeli)', ref); continue; }
      const [u, v] = axesUsed.sort();
      normal = [0, 1, 2].find((k) => k !== u && k !== v);
      const centers = bs.map((b) => b.at[normal] + b.size / 2);
      if (Math.max(...centers) - Math.min(...centers) > 0.5) { err('E-PANEL-BETWEEN', 'between üyeleri aynı düzlemde değil (kanal eksenleri hizalı olmalı)', ref); continue; }
      const gset = new Set(bs.map((b) => b.group));
      if (gset.size !== 1) { err('E-GROUP', 'slot panelini çevreleyen üyeler aynı grupta olmalı', ref); continue; }
      group = bs[0].group;
      // u ekseninde uzanan iki üye v yönünü, v ekseninde uzanan iki üye u yönünü sınırlar.
      const bound = (run, dir) => {
        const pair = bs.filter((b) => b.ai === run).sort((x, y) => x.at[dir] - y.at[dir]);
        return { lo: pair[0].at[dir] + pair[0].size, hi: pair[1].at[dir], insLo: pair[0].profile.slot_insert, insHi: pair[1].profile.slot_insert };
      };
      const bv = bound(u, v), bu = bound(v, u);
      if (!(bu.hi - bu.lo > EPS && bv.hi - bv.lo > EPS)) { err('E-PANEL-BETWEEN', 'between üyeleri arasında açıklık yok', ref); continue; }
      // İsteğe bağlı: panelin kanala giriş payı CAD'deki gerçek değere sabitlenebilir (ör. iki üründe aynı panel kullanılıyorsa).
      // insert: sayı/ifade (iki eksen) ya da { "x": .., "y": .. } (eksen bazında, her kenar için).
      if (p.insert !== undefined) {
        const pick = (k) => (p.insert !== null && typeof p.insert === 'object' ? p.insert[AXES[k]] : p.insert);
        let bad = false;
        for (const [k, b] of [[u, bu], [v, bv]]) {
          const raw = pick(k);
          if (raw === undefined) continue;
          const val = ev(raw, `${ref}.insert`);
          const lim = Math.min(...bs.filter((m) => m.ai !== k).map((m) => m.size));
          if (!(val >= 0 && val < lim)) { err('E-SCHEMA', `insert ${AXES[k]} = ${val}: 0 ile profil kesiti (${lim} mm) arasında olmalı`, ref); bad = true; continue; }
          b.insLo = val; b.insHi = val;
        }
        if (bad) continue;
        insert = { [AXES[u]]: round01(bu.insLo), [AXES[v]]: round01(bv.insLo) };
      }
      const min = [0, 0, 0], max = [0, 0, 0];
      min[u] = bu.lo - bu.insLo; max[u] = bu.hi + bu.insHi;
      min[v] = bv.lo - bv.insLo; max[v] = bv.hi + bv.insHi;
      min[normal] = centers[0] - t / 2; max[normal] = centers[0] + t / 2;
      pbox = box(min, max);
      opening = { [AXES[u]]: round01(bu.hi - bu.lo), [AXES[v]]: round01(bv.hi - bv.lo) };
      between = bs.map((b) => b.id);
      // Köşe çentiği: panelin kanala giren köşesi, kendisini çevrelemeyen bir profilin gövdesine denk geliyorsa
      // (ör. kayıtların dayandığı ayak) o köşe kanal payı kadar çentiklenir.
      for (const cu of [0, 1]) for (const cv of [0, 1]) {
        const cmin = [...min], cmax = [...max];
        const iu = cu ? bu.insHi : bu.insLo, iv = cv ? bv.insHi : bv.insLo;
        if (cu) cmin[u] = max[u] - iu; else cmax[u] = min[u] + iu;
        if (cv) cmin[v] = max[v] - iv; else cmax[v] = min[v] + iv;
        const hit = [...members.values()].some((m) => !between.includes(m.id) && boxesCollide({ min: cmin, max: cmax }, m.box, 0.2));
        if (hit) { notch = notch ?? { count: 0, size: [iu, iv] }; notch.count++; }
      }
      if (mat.slot_gasket) hw.push({ item: mat.slot_gasket, qty: Math.ceil(((bu.hi - bu.lo) + (bv.hi - bv.lo)) * 2 / 100) / 10 });
    } else {
      if (!AXES.includes(p.normal)) { err('E-SCHEMA', 'surface paneli için normal "x", "y" ya da "z" olmalı', ref); continue; }
      normal = axisIndex(p.normal);
      const inPlane = [0, 1, 2].filter((k) => k !== normal);
      if (!Array.isArray(p.origin) || p.origin.length !== 3 || !Array.isArray(p.size) || p.size.length !== 2) { err('E-SCHEMA', 'surface paneli: origin 3 ifade (alt köşe), size 2 ifade (düzlemdeki iki ölçü, eksen sırasıyla) olmalı', ref); continue; }
      const o = p.origin.map((x, k) => ev(x, `${ref}.origin[${k}]`));
      const s = p.size.map((x, k) => ev(x, `${ref}.size[${k}]`));
      if (o.some(Number.isNaN) || s.some(Number.isNaN)) continue;
      if (s.some((x) => !(x > 0))) { err('E-SCHEMA', 'Panel ölçüleri pozitif olmalı', ref); continue; }
      const min = [...o], max = [...o];
      max[inPlane[0]] += s[0]; max[inPlane[1]] += s[1]; max[normal] += t;
      pbox = box(min, max);
      if (group && !groupsUsed.has(group)) groupsUsed.add(group);
      const fixItem = p.fix?.with ?? mat.surface_fix?.item;
      if (fixItem) {
        const n = p.fix?.count !== undefined ? ev(p.fix.count, `${ref}.fix.count`) : Math.max(4, Math.ceil((2 * (s[0] + s[1])) / (mat.surface_fix?.pitch ?? 250)));
        if (!(Number.isInteger(n) && n >= 1)) { err('E-SCHEMA', 'fix.count pozitif tam sayı olmalı', ref); continue; }
        const carrier = [...members.values()].find((m) => { const c = boxContact(pbox, m.box); return c && c.axis === normal; }) ?? firstMember;
        hw.push(...resolveRecipe([{ item: fixItem, qty: n }, ...(mat.surface_fix?.with ?? []).map((item) => ({ item, qty: n }))], { on: carrier.profile }));
      }
    }
    const size = boxSize(pbox);
    const inPlane = [0, 1, 2].filter((k) => k !== normal);
    const dims = inPlane.map((k) => round01(size[k]));
    const area = (dims[0] * dims[1]) / 1e6;
    panels.push({
      id: p.id, material: p.material, mount: p.mount, thickness: t, normal: AXES[normal], box: pbox,
      cut: [Math.max(...dims), Math.min(...dims)], opening, between, group, notch, insert,
      area_m2: Math.round(area * 1000) / 1000, mass_kg: Math.round(area * (mat.density_kg_m2 || 0) * 100) / 100,
      hardware: hw, note: p.note ?? null,
    });
    addHw(hw, { panel: p.id });
  }

  // ---- 8. Mekanizmalar ----
  const mechanisms = [];
  for (const [i, k] of (design.mechanisms || []).entries()) {
    const ref = `mechanisms[${i}]${k && k.id ? ` (${k.id})` : ''}`;
    if (!k || !k.id) { err('E-SCHEMA', 'Mekanizmanın id alanı zorunlu', ref); continue; }
    if (!['hinge', 'slide'].includes(k.type)) { err('E-SCHEMA', 'type "hinge" ya da "slide" olmalı', ref); continue; }
    if (!k.group || !groupsUsed.has(k.group)) { err('E-REF', `Mekanizmanın hareket ettirdiği grup yok: ${JSON.stringify(k.group)}`, ref); continue; }
    if (!AXES.includes(k.axis)) { err('E-SCHEMA', 'axis "x", "y" ya da "z" olmalı', ref); continue; }
    const hwDef = catalog.mechanisms[k.hardware];
    if (!hwDef) { err('E-REF', `Katalogda olmayan mekanizma donanımı: ${JSON.stringify(k.hardware)}`, ref); continue; }
    if (hwDef.kind !== k.type) { err('E-REF', `${k.hardware} bir "${hwDef.kind}"; mekanizma tipi "${k.type}"`, ref); continue; }
    const count = ev(k.count ?? 1, `${ref}.count`);
    if (!(count > 0 && Number.isInteger(count))) { err('E-SCHEMA', 'count pozitif tam sayı olmalı', ref); continue; }
    const mech = { id: k.id, type: k.type, group: k.group, axis: k.axis, hardware: k.hardware, count, note: k.note ?? null };
    if (k.type === 'hinge') {
      if (!Array.isArray(k.pivot) || k.pivot.length !== 3 || !Array.isArray(k.range) || k.range.length !== 2) { err('E-SCHEMA', 'hinge: pivot 3 ifade, range [min, max] derece olmalı', ref); continue; }
      mech.pivot = k.pivot.map((x, n) => ev(x, `${ref}.pivot[${n}]`));
      mech.range = k.range.map((x, n) => ev(x, `${ref}.range[${n}]`));
      if (!(mech.range[1] > mech.range[0])) { err('E-SCHEMA', 'range[1] > range[0] olmalı', ref); continue; }
      if (mech.range[0] > 0 || mech.range[1] < 0) { err('E-SCHEMA', 'range başlangıç konumunu (0°) içermeli; ör. [0, 90] ya da [-90, 0]', ref); continue; }
    } else {
      mech.travel = ev(k.travel, `${ref}.travel`);
      if (!(Math.abs(mech.travel) > 0)) { err('E-SCHEMA', 'slide: travel sıfırdan farklı olmalı (işaret yönü verir)', ref); continue; }
    }
    mechanisms.push(mech);
    hardwareLines.push({ item: k.hardware, qty: count, source: { mechanism: k.id } });
    const gm = [...members.values()].find((m) => m.group === k.group) ?? firstMember;
    addHw(resolveRecipe(hwDef.hardware, { on: gm.profile }, count), { mechanism: k.id });
  }
  for (const g of groupsUsed) {
    if (!mechanisms.some((k) => k.group === g)) err('E-GROUP', `"${g}" grubunu gövdeye bağlayan mekanizma (hinge/slide) tanımlı değil`, `group:${g}`);
  }

  // ---- 9. Yükler ----
  const loads = [];
  for (const [i, l] of (design.loads || []).entries()) {
    const ref = `loads[${i}]`;
    const m = members.get(l.on);
    if (!m) { err('E-REF', `Yük için böyle bir üye yok: ${JSON.stringify(l.on)}`, ref); continue; }
    const kg = ev(l.kg, `${ref}.kg`);
    const span = l.span !== undefined ? ev(l.span, `${ref}.span`) : m.length;
    const type = l.type ?? 'udl', support = l.support ?? 'simple';
    if (!['udl', 'point'].includes(type) || !['simple', 'cantilever', 'fixed'].includes(support)) { err('E-SCHEMA', 'Yük: type udl|point, support simple|cantilever|fixed olmalı', ref); continue; }
    loads.push({ on: l.on, kg, type, support, span: round01(span), note: l.note ?? null });
  }
  if (issues.length) return fail();

  // ---- 10. Donanım toplamı ----
  const totals = new Map();
  for (const h of hardwareLines) {
    const def = catalog.items[h.item];
    if (!def) { err('E-REF', `Katalogda olmayan donanım kalemi: ${JSON.stringify(h.item)}`, JSON.stringify(h.source)); continue; }
    if (!totals.has(h.item)) totals.set(h.item, { item: h.item, title: def.title, unit: def.unit ?? 'adet', catalog: def.catalog, qty: 0, sources: [] });
    const t = totals.get(h.item);
    t.qty = Math.round((t.qty + h.qty) * 100) / 100;
    t.sources.push({ ...h.source, qty: h.qty });
  }
  if (issues.length) return fail();

  // ---- 11. Model ----
  const outMembers = [...members.values()].map((m) => ({
    id: m.id, profile: m.profileId, size: m.size, axis: AXES[m.ai], length: m.length, cut: [90, 90],
    box: m.box, group: m.group, role: m.role, note: m.src.note ?? null,
    operations: memberOps.get(m.id) ?? [],
    mass_kg: Math.round(((m.profile.mass_kg_m || 0) * m.length) / 10) / 100,
    ends: Object.fromEntries(END_NAMES.map((e) => {
      const d = m.ends[e];
      const o = { kind: d.kind, coord: round01(m.coord[e]) };
      if (d.kind === 'butt') { o.onto = d.onto; o.joint = d.joint.id; }
      if (d.kind === 'corner') { o.joint = d.joint.id; o.outer = round01(d.outer); }
      if (d.kind === 'free') o.accessory = d.accessory ?? null;
      return [e, o];
    })),
  }));
  const allBoxes = [...outMembers.map((m) => m.box), ...panels.map((p) => p.box)];
  const bbox = boxUnion(allBoxes);
  // Zemin payı: ayar ayağı ya da teker iskeletin altına eklenir; kutuya (bbox) girmez, ayrıca bildirilir.
  const ground = Math.max(0, ...accessories.map((a) => {
    const def = catalog.accessories[a.item];
    return def && (def.kind === 'foot' || def.kind === 'caster') ? def.height || 0 : 0;
  }));
  const profileTotals = {};
  for (const m of outMembers) profileTotals[m.profile] = round01((profileTotals[m.profile] || 0) + m.length);
  const model = {
    schema: 'sigma-solved/1',
    name: design.name,
    title: design.title ?? design.name,
    class: design.class ?? null,
    description: design.description ?? null,
    params: Object.fromEntries(Object.entries(scope).filter(([k]) => !(k in CONSTANTS))),
    members: outMembers,
    joints: joints.map((j) => ({ id: j.id, type: j.type, kind: j.kind, node: j.node.map(round01), through: j.through, onto: j.onto, ends: j.ends, group: j.group ?? null, hardware: j.hardware, operations: j.operations })),
    panels,
    mechanisms,
    accessories,
    loads,
    hardware: [...totals.values()],
    bbox,
    size: boxSize(bbox).map(round01),
    ground_mm: round01(ground),
    overall_height_mm: round01(boxSize(bbox)[2] + ground),
    stats: {
      member_count: outMembers.length,
      profile_total_mm: profileTotals,
      mass_kg: Math.round((outMembers.reduce((s, m) => s + m.mass_kg, 0) + panels.reduce((s, p) => s + p.mass_kg, 0)) * 100) / 100,
    },
  };
  return { ok: true, issues, model };
}

/** Kesim listesi özeti: profil + boy → adet (testler ve export için ortak yardımcı). */
function cutSummary(model) {
  const map = new Map();
  for (const m of model.members) {
    const key = `${m.profile}|${m.length}`;
    if (!map.has(key)) map.set(key, { profile: m.profile, length: m.length, qty: 0, ids: [] });
    const r = map.get(key);
    r.qty++; r.ids.push(m.id);
  }
  return [...map.values()].sort((x, y) => (x.profile < y.profile ? -1 : x.profile > y.profile ? 1 : y.length - x.length));
}

return { solve, cutSummary };
})();

__m['engine/validate.js'] = (function () {
// engine/validate.js — kural denetleyicisi: rules/rules.json içindeki her kuralı çözülmüş model üzerinde çalıştırır.
// Saf ES modülü (Node + tarayıcı); node:fs kullanmaz. Sayısal sınırların hepsi rules.json → settings'ten okunur.
//
//   validate(model, design, catalog, rulesData, extra?) → { ok, results[], summary }
//   reportMarkdown(result, model) → Türkçe kural kontrol raporu (Markdown)
//
// check: 'gozle' → status 'manual'. check: 'auto' | 'solver' → fn adı CHECKS tablosunda aranır.
// Denetim fonksiyonu { fails: [{msg, ref}], notes: [{msg, ref}], skip?: string } döndürür.
// Yanlış negatif yanlış pozitiften kötüdür: denetim içinde beklenmeyen bir hata olursa kural 'fail' yazılır.

const { AXES, overlap, boxesCollide, boxContact, boxUnion, boxSize, rotateBox, obbFromBox, obbCollide, translateBox } = __m['engine/geom.js'];
const { beam, G, E_ALU } = __m['engine/loads.js'];
// ---------------------------------------------------------------- yardımcılar

/** Sayıyı Türkçe ondalık virgülle yazar (en çok d basamak). */
const n = (x, d = 1) => {
  if (!Number.isFinite(x)) return String(x);
  const r = Math.round(x * 10 ** d) / 10 ** d;
  return String(Object.is(r, -0) ? 0 : r).replace('.', ',');
};
const dims = (arr, d = 1) => arr.map((x) => n(x, d)).join(' × ');
const memberOfEnd = (s) => String(s).split(':')[0];

function makeCtx(model, design, catalog, rulesData, extra) {
  const settings = rulesData.settings || {};
  const M = new Map(model.members.map((m) => [m.id, m]));
  const P = new Map((model.panels || []).map((p) => [p.id, p]));
  return {
    model, design, catalog, settings, extra: extra || {}, M, P, rules: rulesData.rules || [],
    tol: settings.tolerance_mm ?? 0.5,
    axis: (a) => AXES.indexOf(a),
  };
}

const out = () => ({ fails: [], notes: [] });

/**
 * Üstüne vidalı yüzey panelinin kirişe eğilme rijitliği katkısı (YUK-01/02).
 * Panel ve profil yan yana iki kiriş gibi birlikte eğilir (tam kompozit etki sayılmaz; güvenli taraf).
 * Koşullar: panel aynı grupta, profilin yüzüne oturuyor, sabitlenmiş, kirişin en az min_cover_ratio kadarını örtüyor
 * ve malzemesinin E_mpa değeri katalogda var. Etkin genişlik = min(panelin kirişe dik genişliği, oran × açıklık).
 * @returns {{ EI: number, note: string }}
 */
function panelStiffness(ctx, m, span) {
  const cfg = ctx.settings.panel_stiffness;
  if (!cfg) return { EI: 0, note: '' };
  const ai = ctx.axis(m.axis);
  let EI = 0;
  const used = [];
  for (const p of ctx.model.panels || []) {
    if (p.mount !== 'surface' || (p.group ?? null) !== (m.group ?? null)) continue;
    const mat = ctx.catalog.panels[p.material];
    if (!mat || !mat.E_mpa || !(p.hardware || []).length) continue;
    const ni = ctx.axis(p.normal);
    if (ni === ai) continue;
    const c = boxContact(p.box, m.box, ctx.tol);
    if (!c || c.axis !== ni) continue;
    const cover = Math.min(p.box.max[ai], m.box.max[ai]) - Math.max(p.box.min[ai], m.box.min[ai]);
    if (cover < cfg.min_cover_ratio * Math.min(span, m.length)) continue;
    const wi = [0, 1, 2].find((k) => k !== ai && k !== ni);
    const width = Math.min(p.box.max[wi] - p.box.min[wi], cfg.effective_width_span_ratio * span);
    EI += (mat.E_mpa * width * p.thickness ** 3) / 12;
    used.push(`${p.id} (etkin genişlik ${n(width)} mm)`);
  }
  return { EI, note: used.length ? `; vidalı panel rijitliği sayıldı: ${used.join(', ')}` : '' };
}

/**
 * Yükleri üye bazında toplar: aynı üyedeki yüklerin sehimleri ve gerilmeleri üst üste bindirilir
 * (en büyük değerlerin aynı kesitte oluştuğu kabul edilir; güvenli taraf). Sınır en kısa açıklığa göre alınır.
 */
function loadCases(ctx) {
  const byMember = new Map();
  for (const l of ctx.model.loads) {
    if (!byMember.has(l.on)) byMember.set(l.on, []);
    byMember.get(l.on).push(l);
  }
  const cases = [];
  for (const [id, list] of byMember) {
    const m = ctx.M.get(id), prof = m && ctx.catalog.profiles[m.profile];
    if (!prof) { cases.push({ id, error: `Yük ${id}: üye ya da profil bulunamadı` }); continue; }
    const span = Math.min(...list.map((l) => l.span));
    const ps = panelStiffness(ctx, m, span);
    const Ieff = prof.I_mm4 + ps.EI / E_ALU;
    const share = prof.I_mm4 / Ieff; // momentin profile düşen payı
    const loads = list.map((l) => {
      const b = beam({ L: l.span, F: l.kg * G, I: Ieff, W: prof.W_mm3, support: l.support, load: l.type });
      return { kg: l.kg, type: l.type, support: l.support, span: l.span, deflection: b.deflection, stress: b.stress * share };
    });
    cases.push({
      id, span, loads, panelNote: ps.note,
      deflection: loads.reduce((a, b) => a + b.deflection, 0),
      stress: loads.reduce((a, b) => a + b.stress, 0),
    });
  }
  return cases;
}


/** Bir üyenin kendi ekseni boyunca destek noktaları (YUK-03 / YUK-04). */
function supportPoints(ctx, m) {
  const ai = ctx.axis(m.axis);
  const pts = [];
  for (const e of ['a', 'b']) {
    const end = m.ends[e];
    if (end.kind === 'butt' || end.kind === 'corner') pts.push(end.coord);
  }
  for (const j of ctx.model.joints) {
    if (j.onto !== m.id) continue;
    if (j.kind === 'butt' || j.kind === 'corner3') pts.push(j.node[ai]);
  }
  return [...new Set(pts.map((x) => Math.round(x * 10) / 10))].sort((x, y) => x - y);
}

const groupBoxes = (ctx, g) => [
  ...ctx.model.members.filter((m) => m.group === g).map((m) => ({ id: m.id, box: m.box })),
  ...ctx.model.panels.filter((p) => p.group === g).map((p) => ({ id: p.id, box: p.box })),
];
const otherBoxes = (ctx, g) => [
  ...ctx.model.members.filter((m) => m.group !== g).map((m) => ({ id: m.id, box: m.box })),
  ...ctx.model.panels.filter((p) => p.group !== g).map((p) => ({ id: p.id, box: p.box })),
];

/** Eksene dik düzlemde nokta ile dikdörtgen arasındaki mesafe. */
function pointRectDist(pt, b, j, k) {
  const dj = Math.max(b.min[j] - pt[j], 0, pt[j] - b.max[j]);
  const dk = Math.max(b.min[k] - pt[k], 0, pt[k] - b.max[k]);
  return Math.hypot(dj, dk);
}

/** Hareketli grubun kütlesi (üye + panel) ve grup üyelerine tanımlı yük. */
function groupMass(ctx, g) {
  const ms = ctx.model.members.filter((m) => m.group === g);
  const own = ms.reduce((s, m) => s + (m.mass_kg || 0), 0) + ctx.model.panels.filter((p) => p.group === g).reduce((s, p) => s + (p.mass_kg || 0), 0);
  const ids = new Set(ms.map((m) => m.id));
  const load = ctx.model.loads.filter((l) => ids.has(l.on)).reduce((s, l) => s + l.kg, 0);
  return { own, load, total: own + load };
}

// ---------------------------------------------------------------- denetim fonksiyonları

const CHECKS = {
  // PRF-01
  profileWhitelist(ctx) {
    const r = out();
    const allowed = Object.keys(ctx.catalog.profiles);
    for (const m of ctx.model.members) {
      if (!ctx.catalog.profiles[m.profile]) r.fails.push({ msg: `${m.id}: "${m.profile}" katalogda olmayan bir kesit (izinli: ${allowed.join(', ')})`, ref: m.id });
    }
    return r;
  },

  // PRF-02 / PRF-03 (aynı fn; kural id'sine göre dallanır). Hangi profilin hangi sınıfa ait olduğu katalogdaki "use" alanından gelir.
  classProfile(ctx, rule) {
    const r = out();
    const cls = ctx.model.class;
    const profilesFor = (use) => Object.entries(ctx.catalog.profiles).filter(([, p]) => p.use === use).map(([id]) => id);
    if (rule.id === 'PRF-03') {
      if (cls !== 'tasiyici') return r;
      const ok40 = profilesFor('tasiyici');
      const carriers = ctx.model.members.filter((m) => m.role === 'tasiyici');
      if (!carriers.length) r.fails.push({ msg: 'class "tasiyici" ama role: "tasiyici" işaretli hiçbir üye yok (en az bir taşıyıcı üye gerekli)', ref: null });
      for (const m of carriers) {
        if (!ok40.includes(m.profile)) r.fails.push({ msg: `${m.id}: taşıyıcı üye ${m.profile}; ${ok40.join(' / ')} olmalı`, ref: m.id });
      }
      return r;
    }
    if (cls !== 'kucuk-mobilya' && cls !== 'tasiyici') {
      r.fails.push({ msg: `class zorunlu: "kucuk-mobilya" ya da "tasiyici" olmalı (gelen: ${JSON.stringify(cls)})`, ref: null });
      return r;
    }
    if (cls === 'kucuk-mobilya') {
      const ok20 = profilesFor('kucuk-mobilya');
      for (const m of ctx.model.members) {
        if (!ok20.includes(m.profile)) r.fails.push({ msg: `${m.id}: kucuk-mobilya sınıfında ${m.profile} kullanılmış; tüm üyeler ${ok20.join(' / ')} olmalı`, ref: m.id });
      }
    }
    return r;
  },

  // PRF-04
  classByLoad(ctx) {
    const r = out();
    const lim = ctx.settings.class_load_limit_kg;
    const total = ctx.model.loads.reduce((s, l) => s + (l.kg || 0), 0);
    if (total > lim && ctx.model.class !== 'tasiyici') {
      r.fails.push({ msg: `Toplam tanımlı yük ${n(total)} kg > ${n(lim)} kg ama class "${ctx.model.class}"; "tasiyici" olmalı`, ref: null });
    }
    return r;
  },

  // BAG-01
  fastenerThreads(ctx) {
    const r = out();
    const meta = ctx.catalog.meta?.fasteners || {};
    const ok = new Set([...(meta.allowed_threads || []), ...Object.keys(meta.restricted_threads || {})]);
    for (const h of ctx.model.hardware) {
      const def = ctx.catalog.items[h.item];
      if (!def || def.thread === undefined) continue;
      if (!ok.has(def.thread)) r.fails.push({ msg: `${h.item}: diş ${def.thread} izinli değil (izinli: ${[...ok].join(', ')}), ${n(h.qty)} ${h.unit}`, ref: h.item });
    }
    return r;
  },

  // BAG-02
  m6OnlyTappedEnd(ctx) {
    const r = out();
    const restricted = new Set(Object.keys(ctx.catalog.meta?.fasteners?.restricted_threads || {}));
    const J = new Map(ctx.model.joints.map((j) => [j.id, j]));
    for (const h of ctx.model.hardware) {
      const def = ctx.catalog.items[h.item];
      if (!def || !restricted.has(def.thread)) continue;
      if (def.kind === 'tnut') r.fails.push({ msg: `${h.item}: ${def.thread} T-somun kullanılamaz (${def.thread} yalnız uca diş açılan birleşimde)`, ref: h.item });
      for (const s of h.sources) {
        const where = s.joint ? `birleşim ${s.joint}` : s.panel ? `panel ${s.panel}` : s.mechanism ? `mekanizma ${s.mechanism}` : s.accessory ? `aksesuar ${s.accessory}${s.on ? ` (${s.on})` : ''}` : JSON.stringify(s);
        if (!s.joint) { r.fails.push({ msg: `${h.item} (${def.thread}) ${where} kaynağından geliyor; ${def.thread} yalnız uca diş açılan birleşimde kullanılır`, ref: h.item }); continue; }
        const j = J.get(s.joint);
        const jt = j && ctx.catalog.joints[j.type];
        const inRecipe = jt && (jt.hardware || []).some((x) => x.item === h.item);
        if (!jt || !inRecipe || !(jt.operations && jt.operations.length)) {
          r.fails.push({ msg: `${h.item} (${def.thread}) ${where} (${j ? j.type : '?'}) içinde; bu birleşim uca diş açılan tip değil`, ref: s.joint });
        }
      }
    }
    return r;
  },

  // BAG-03
  catalogOnly(ctx) {
    const r = out();
    const c = ctx.catalog;
    for (const m of ctx.model.members) if (!c.profiles[m.profile]) r.fails.push({ msg: `Üye ${m.id}: profil "${m.profile}" katalogda yok`, ref: m.id });
    for (const p of ctx.model.panels) if (!c.panels[p.material]) r.fails.push({ msg: `Panel ${p.id}: malzeme "${p.material}" katalogda yok`, ref: p.id });
    for (const j of ctx.model.joints) if (!c.joints[j.type]) r.fails.push({ msg: `Birleşim ${j.id}: tip "${j.type}" katalogda yok`, ref: j.id });
    for (const k of ctx.model.mechanisms) if (!c.mechanisms[k.hardware]) r.fails.push({ msg: `Mekanizma ${k.id}: donanım "${k.hardware}" katalogda yok`, ref: k.id });
    for (const a of ctx.model.accessories) if (!c.accessories[a.item] && !c.mechanisms[a.item]) r.fails.push({ msg: `Aksesuar "${a.item}" (${a.on ?? 'üyesiz'}) katalogda yok`, ref: a.on ?? a.item });
    for (const h of ctx.model.hardware) if (!c.items[h.item]) r.fails.push({ msg: `Donanım kalemi "${h.item}" (${n(h.qty)} ${h.unit ?? ''}) katalogda yok`, ref: h.item });
    return r;
  },

  // BAG-04
  forbiddenScan(ctx) {
    const r = out();
    const pats = (ctx.settings.forbidden_patterns || []).map((s) => new RegExp(s, 'gi'));
    const seen = new Set();
    const test = (text, where) => {
      for (const re of pats) {
        re.lastIndex = 0;
        let mt;
        while ((mt = re.exec(text))) {
          const key = `${where}|${mt[0]}`;
          if (!seen.has(key)) { seen.add(key); r.fails.push({ msg: `Yasak ifade "${mt[0]}" bulundu: ${where}`, ref: where }); }
          if (mt[0] === '') re.lastIndex++;
        }
      }
    };
    const walk = (v, path) => {
      if (typeof v === 'string') test(v, path);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { test(k, `${path} (anahtar)`); walk(x, `${path}.${k}`); }
    };
    walk(ctx.design, 'design');
    walk(ctx.model, 'model');
    // Yürüyüşün kaçırdığı bir şey kalmasın: düz JSON metni de taranır.
    const before = r.fails.length;
    if (!before) { test(JSON.stringify(ctx.design), 'design (JSON metni)'); test(JSON.stringify(ctx.model), 'model (JSON metni)'); }
    if (typeof ctx.extra.html === 'string') {
      // Ayrık tutulan tek yer: HTML'e gömülü kural raporunda bu kuralın KENDİ metni (kural, gerekçe, istisna).
      // Düz ve JSON kaçışlı hâlleri çıkarılır; geri kalan her şey taranır.
      let html = ctx.extra.html;
      for (const rule of ctx.rules.filter((x) => x.fn === 'forbiddenScan')) {
        for (const text of [rule.rule, rule.why, rule.exceptions]) {
          if (!text) continue;
          for (const form of [text, JSON.stringify(text).slice(1, -1)]) html = html.split(form).join('');
        }
      }
      html.split(/\r?\n/).forEach((line, i) => test(line, `html satır ${i + 1}`));
    }
    return r;
  },

  // BAG-05
  tnutMatchesSlot(ctx) {
    const r = out();
    const J = new Map(ctx.model.joints.map((j) => [j.id, j]));
    const K = new Map(ctx.model.mechanisms.map((k) => [k.id, k]));
    for (const h of ctx.model.hardware) {
      const def = ctx.catalog.items[h.item];
      if (!def || def.kind !== 'tnut') continue;
      for (const s of h.sources) {
        let cands = [], where;
        if (s.joint) {
          const j = J.get(s.joint);
          if (!j) continue;
          cands = [j.onto, ...j.ends.map(memberOfEnd), ...(j.through ? [memberOfEnd(j.through)] : [])];
          where = `birleşim ${j.id} (${j.type})`;
        } else if (s.accessory) {
          if (!s.on) continue;
          cands = [memberOfEnd(s.on)];
          where = `aksesuar ${s.accessory} (${s.on})`;
        } else if (s.panel) {
          const p = ctx.P.get(s.panel);
          if (!p) continue;
          if (p.mount === 'slot') cands = [...(p.between || [])];
          else {
            const ni = ctx.axis(p.normal);
            cands = ctx.model.members.filter((m) => { const c = boxContact(p.box, m.box); return c && c.axis === ni; }).map((m) => m.id);
          }
          where = `panel ${p.id}`;
        } else if (s.mechanism) {
          const k = K.get(s.mechanism);
          if (!k) continue;
          cands = ctx.model.members.filter((m) => m.group === k.group).map((m) => m.id);
          where = `mekanizma ${k.id} (grup ${k.group})`;
        }
        const profs = [...new Set(cands.map((id) => ctx.M.get(id)).filter(Boolean).map((m) => m.profile))];
        if (!profs.length) continue; // belirlenemiyor
        const slots = profs.map((p) => ctx.catalog.profiles[p]?.slot);
        if (!slots.includes(def.slot)) {
          r.fails.push({ msg: `${h.item} (kanal ${def.slot}) ${where} içinde; bağlandığı profil(ler) ${profs.join(', ')} kanalı ${[...new Set(slots)].join(' / ')}`, ref: s.joint ?? s.on ?? s.panel ?? s.mechanism ?? h.item });
        }
      }
    }
    return r;
  },

  // BIR-04
  endsAccounted(ctx) {
    const r = out();
    for (const m of ctx.model.members) {
      for (const e of ['a', 'b']) {
        const end = m.ends[e];
        if (end.kind !== 'free' || end.accessory) continue;
        if (m.note && String(m.note).trim()) r.notes.push({ msg: `${m.id}:${e} serbest uçta kapak/aksesuar yok; gerekçe notu: "${m.note}"`, ref: `${m.id}:${e}` });
        else r.fails.push({ msg: `${m.id}:${e} serbest uç (koordinat ${n(end.coord)}) açıkta: uç kapağı, ayak ya da aksesuar yok ve gerekçe notu yazılmamış`, ref: `${m.id}:${e}` });
      }
    }
    return r;
  },

  // BIR-05
  noCollision(ctx) {
    const r = out();
    const tol = ctx.tol;
    const parts = [
      ...ctx.model.members.map((m) => ({ id: m.id, box: m.box, kind: 'member' })),
      ...ctx.model.panels.map((p) => ({ id: p.id, box: p.box, kind: 'panel', panel: p })),
    ];
    // Kanal panelinin köşe payı (PNL-06 köşe çentiği): örtüşme panelin iki düzlem ekseninde de kanala giren pay
    // içinde (köşe karesinde) kalıyorsa çarpışma değil, çentik notu.
    const inCornerMargin = (p, ov) => {
      if (p.mount !== 'slot') return false;
      const ni = ctx.axis(p.normal);
      const between = (p.between || []).map((id) => ctx.M.get(id)).filter(Boolean);
      const ins = Math.max(...between.map((m) => ctx.catalog.profiles[m.profile]?.slot_insert ?? 0));
      return [0, 1, 2].filter((k) => k !== ni).every((k) => {
        const lo = Math.max(p.box.min[k], ov.box.min[k]), hi = Math.min(p.box.max[k], ov.box.max[k]);
        return (hi <= p.box.min[k] + ins + tol) || (lo >= p.box.max[k] - ins - tol);
      });
    };
    for (let i = 0; i < parts.length; i++) {
      for (let k = i + 1; k < parts.length; k++) {
        const A = parts[i], B = parts[k];
        if (A.panel?.mount === 'slot' && A.panel.between?.includes(B.id)) continue;
        if (B.panel?.mount === 'slot' && B.panel.between?.includes(A.id)) continue;
        if (!boxesCollide(A.box, B.box, tol)) continue;
        const o = overlap(A.box, B.box);
        if ((A.panel && B.kind === 'member' && inCornerMargin(A.panel, B)) || (B.panel && A.kind === 'member' && inCornerMargin(B.panel, A))) {
          r.notes.push({ msg: `${A.id} ile ${B.id} panel köşe payında kesişiyor (${dims(o)} mm): panel köşesi çentiklenir`, ref: `${A.id}|${B.id}` });
          continue;
        }
        r.fails.push({ msg: `${A.id} ile ${B.id} iç içe geçiyor: örtüşme ${dims(o)} mm (tolerans ${n(tol)} mm)`, ref: `${A.id}|${B.id}` });
      }
    }
    return r;
  },

  // BIR-06
  connected(ctx) {
    const r = out();
    const parent = new Map(ctx.model.members.map((m) => [m.id, m.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
    for (const j of ctx.model.joints) {
      const ids = [j.onto, ...j.ends.map(memberOfEnd), ...(j.through ? [memberOfEnd(j.through)] : [])];
      for (const id of ids.slice(1)) union(ids[0], id);
    }
    const byGroup = new Map();
    for (const m of ctx.model.members) {
      const g = m.group ?? null;
      if (!byGroup.has(g)) byGroup.set(g, new Map());
      const comps = byGroup.get(g);
      const root = find(m.id);
      if (!comps.has(root)) comps.set(root, []);
      comps.get(root).push(m.id);
    }
    for (const [g, comps] of byGroup) {
      if (comps.size <= 1) continue;
      const list = [...comps.values()].sort((a, b) => b.length - a.length);
      const name = g ? `"${g}" grubu` : 'Sabit gövde';
      r.fails.push({ msg: `${name} ${list.length} ayrı parçaya bölünmüş; ana parçaya bağlı olmayan üyeler: ${list.slice(1).map((c) => c.join(', ')).join(' | ')}`, ref: list[1][0] });
    }
    return r;
  },

  // BIR-07
  buttFullySeated(ctx) {
    const r = out();
    for (const j of ctx.model.joints) {
      if (j.kind !== 'butt') continue;
      const onto = ctx.M.get(j.onto);
      for (const en of j.ends) {
        const m = ctx.M.get(memberOfEnd(en));
        if (!m || !onto) continue;
        const need = m.size * m.size - m.size * ctx.tol;
        const c = boxContact(m.box, onto.box, ctx.tol);
        const area = c ? c.area : 0;
        if (area < need) r.fails.push({ msg: `${en} → ${onto.id} (${j.id}): temas alanı ${n(area)} mm² < kesit ${n(m.size * m.size)} mm²; uç karşı yüze tam oturmuyor`, ref: j.id });
      }
    }
    return r;
  },

  // BIR-09
  preferTappedEnd40(ctx) {
    const r = out();
    for (const j of ctx.model.joints) {
      if (j.type === 'kose-braketi-40') r.fails.push({ msg: `${j.id} (${j.ends.join(', ')} → ${j.onto}) kose-braketi-40 kullanıyor; 40×40 alın birleşiminde önce uca M6 diş (uc-disli-M6-40) tercih edilir`, ref: j.id });
    }
    return r;
  },

  // KES-01
  straightCuts(ctx) {
    const r = out();
    for (const m of ctx.model.members) {
      if (!Array.isArray(m.cut) || m.cut.length !== 2 || m.cut.some((x) => x !== 90)) r.fails.push({ msg: `${m.id}: kesim açıları ${JSON.stringify(m.cut)}; [90, 90] olmalı`, ref: m.id });
    }
    return r;
  },

  // KES-02
  lengthRange(ctx) {
    const r = out();
    const lo = ctx.settings.min_piece_mm, trim = ctx.settings.stock_trim_mm;
    for (const m of ctx.model.members) {
      const stock = ctx.catalog.profiles[m.profile]?.stock_mm;
      const hi = stock !== undefined ? stock - trim : Infinity;
      if (m.length < lo) r.fails.push({ msg: `${m.id}: boy ${n(m.length)} mm < en kısa parça ${n(lo)} mm`, ref: m.id });
      if (m.length > hi) r.fails.push({ msg: `${m.id}: boy ${n(m.length)} mm > stok ${n(stock)} − temizleme ${n(trim)} = ${n(hi)} mm`, ref: m.id });
    }
    return r;
  },

  // KES-03
  wholeMillimetres(ctx) {
    const r = out();
    const step = ctx.settings.length_step_mm;
    for (const m of ctx.model.members) {
      const q = m.length / step;
      if (Math.abs(q - Math.round(q)) * step > 0.05) r.fails.push({ msg: `${m.id}: boy ${n(m.length)} mm, ${n(step)} mm'nin katı değil`, ref: m.id });
    }
    return r;
  },

  // KES-04
  nearDuplicateLengths(ctx) {
    const r = out();
    const lim = ctx.settings.near_duplicate_mm;
    const byProf = new Map();
    for (const m of ctx.model.members) {
      if (!byProf.has(m.profile)) byProf.set(m.profile, new Map());
      const L = byProf.get(m.profile);
      if (!L.has(m.length)) L.set(m.length, []);
      L.get(m.length).push(m.id);
    }
    for (const [prof, L] of byProf) {
      const lens = [...L.keys()].sort((a, b) => a - b);
      for (let i = 0; i < lens.length; i++) for (let k = i + 1; k < lens.length; k++) {
        const d = lens[k] - lens[i];
        if (d > 0.05 && d < lim) r.fails.push({ msg: `${prof}: ${n(lens[i])} mm (${L.get(lens[i]).join(', ')}) ile ${n(lens[k])} mm (${L.get(lens[k]).join(', ')}) arasında yalnız ${n(d)} mm fark var (< ${n(lim)} mm); tek boya indirilmeli`, ref: L.get(lens[k])[0] });
      }
    }
    return r;
  },

  // KES-05 — extra.cutlist: { bars|stock: [{ profile, stock_mm|length, pieces|parts|cuts: [{ id|ids, length }] }] }
  stockPlan(ctx) {
    const r = out();
    const cl = ctx.extra.cutlist;
    if (!cl) return { ...r, skip: 'kesim listesi (extra.cutlist) verilmedi' };
    const kerf = ctx.settings.kerf_mm, trim = ctx.settings.stock_trim_mm;
    // export/cutlist.js biçimi: stock: [{ profile, stock_mm, bars: [{ pieces: [{ id, length }] }] }] → düz stok boy listesine açılır.
    const nested = Array.isArray(cl.stock) && cl.stock.some((s) => Array.isArray(s?.bars));
    const bars = nested
      ? cl.stock.flatMap((s) => (s.bars || []).map((b) => ({ ...b, profile: s.profile, stock_mm: s.stock_mm })))
      : cl.bars ?? cl.stock ?? cl.layout ?? [];
    if (!Array.isArray(bars) || !bars.length) { r.fails.push({ msg: 'Kesim listesinde stok yerleşimi (bars) yok', ref: null }); return r; }
    const count = new Map();
    bars.forEach((b, i) => {
      const pieces = b.pieces ?? b.parts ?? b.cuts ?? [];
      const stock = b.stock_mm ?? b.stock ?? b.length ?? ctx.catalog.profiles[b.profile]?.stock_mm;
      const lens = [];
      pieces.forEach((pc) => {
        const ids = pc.ids ?? (pc.id !== undefined ? [pc.id] : []);
        for (const id of ids) {
          count.set(id, (count.get(id) || 0) + 1);
          const m = ctx.M.get(id);
          if (m && pc.length !== undefined && Math.abs(m.length - pc.length) > 0.05) r.fails.push({ msg: `Stok ${i + 1}: ${id} ${n(pc.length)} mm yazılmış, modelde ${n(m.length)} mm`, ref: id });
          if (m && b.profile && m.profile !== b.profile) r.fails.push({ msg: `Stok ${i + 1} (${b.profile}): ${id} ${m.profile} profilinde`, ref: id });
        }
        for (let q = 0; q < Math.max(ids.length, 1); q++) lens.push(pc.length ?? ctx.M.get(ids[q])?.length ?? 0);
      });
      // temizleme kesimi + parçalar + parçalar arası testere payı
      const used = trim + lens.reduce((a, b) => a + b, 0) + kerf * Math.max(lens.length - 1, 0);
      if (stock !== undefined && used > stock + 0.05) r.fails.push({ msg: `Stok ${i + 1} (${b.profile ?? '?'}): kullanılan ${n(used)} mm (temizleme ${n(trim)} + parçalar + testere payı ${n(kerf)}) > stok ${n(stock)} mm`, ref: `bar-${i + 1}` });
    });
    for (const m of ctx.model.members) {
      const c = count.get(m.id) || 0;
      if (c !== 1) r.fails.push({ msg: `${m.id} stok yerleşiminde ${c} kez geçiyor (tam 1 olmalı)`, ref: m.id });
    }
    for (const id of count.keys()) if (!ctx.M.has(id)) r.fails.push({ msg: `Stok yerleşiminde modelde olmayan parça: ${id}`, ref: id });
    return r;
  },

  // YUK-01
  deflection(ctx) {
    const r = out();
    const ratio = ctx.settings.deflection_ratio;
    for (const c of loadCases(ctx)) {
      if (c.error) { r.fails.push({ msg: c.error, ref: c.id }); continue; }
      const lim = c.span / ratio;
      const parts = c.loads.map((l) => `${n(l.kg)} kg ${l.type}/${l.support} ${n(l.deflection, 2)} mm`).join(' + ');
      const tail = `${c.panelNote}`;
      if (c.deflection > lim) r.fails.push({ msg: `${c.id}: ${parts}${c.loads.length > 1 ? ` = toplam ${n(c.deflection, 2)} mm` : ''}, açıklık ${n(c.span)} mm → sehim ${n(c.deflection, 2)} mm > sınır ${n(lim, 2)} mm (L/${Math.round(c.span / c.deflection)} < L/${ratio})${tail}`, ref: c.id });
      else r.notes.push({ msg: `${c.id}: sehim ${n(c.deflection, 2)} mm (L/${c.deflection > 0 ? Math.round(c.span / c.deflection) : '∞'}), sınır ${n(lim, 2)} mm${tail}`, ref: c.id });
    }
    return r;
  },

  // YUK-02
  stress(ctx) {
    const r = out();
    const lim = ctx.settings.stress_limit_mpa;
    for (const c of loadCases(ctx)) {
      if (c.error) { r.fails.push({ msg: c.error, ref: c.id }); continue; }
      const parts = c.loads.map((l) => `${n(l.kg)} kg ${l.type}/${l.support} ${n(l.stress)} MPa`).join(' + ');
      if (c.stress > lim) r.fails.push({ msg: `${c.id}: ${parts}${c.loads.length > 1 ? ` = toplam ${n(c.stress)} MPa` : ''}, açıklık ${n(c.span)} mm → gerilme ${n(c.stress)} MPa > sınır ${n(lim)} MPa${c.panelNote}`, ref: c.id });
      else r.notes.push({ msg: `${c.id}: gerilme ${n(c.stress)} MPa, sınır ${n(lim)} MPa${c.panelNote}`, ref: c.id });
    }
    return r;
  },

  // YUK-03
  spanLimit(ctx) {
    const r = out();
    for (const m of ctx.model.members) {
      if (m.axis === 'z') continue;
      const lim = ctx.settings.span_limit_mm?.[m.profile];
      if (lim === undefined) continue;
      const pts = supportPoints(ctx, m);
      let span = 0, at = null;
      for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > span) { span = pts[i] - pts[i - 1]; at = [pts[i - 1], pts[i]]; }
      if (span > lim) r.fails.push({ msg: `${m.id} (${m.profile}): desteksiz açıklık ${n(span)} mm (${n(at[0])} … ${n(at[1])}) > sınır ${n(lim)} mm`, ref: m.id });
    }
    return r;
  },

  // YUK-04
  cantilever(ctx) {
    const r = out();
    for (const m of ctx.model.members) {
      if (m.axis === 'z') continue;
      const lim = ctx.settings.cantilever_limit_mm?.[m.profile];
      if (lim === undefined) continue;
      const pts = supportPoints(ctx, m);
      if (!pts.length) continue;
      for (const e of ['a', 'b']) {
        const end = m.ends[e];
        if (end.kind !== 'free') continue;
        const d = Math.min(...pts.map((p) => Math.abs(p - end.coord)));
        if (d > lim) r.fails.push({ msg: `${m.id}:${e} (${m.profile}): konsol taşma ${n(d)} mm > sınır ${n(lim)} mm`, ref: `${m.id}:${e}` });
      }
    }
    return r;
  },

  // YUK-05
  loadsDeclared(ctx) {
    const r = out();
    const has = ctx.model.loads.length > 0;
    if (has) return r;
    if (ctx.model.class === 'tasiyici') { r.fails.push({ msg: 'class "tasiyici" ama loads boş; taşıyıcı tasarımda yük tanımı zorunlu', ref: null }); return r; }
    const tops = ctx.model.panels.filter((p) => p.mount === 'surface' && p.normal === 'z').map((p) => p.id);
    const slides = ctx.model.mechanisms.filter((k) => k.type === 'slide').map((k) => k.id);
    if (tops.length || slides.length) {
      r.fails.push({ msg: `Üstüne yük konabilecek parça var (${[...tops.map((x) => `yüzey paneli ${x}`), ...slides.map((x) => `çekmece ${x}`)].join(', ')}) ama loads boş`, ref: tops[0] ?? slides[0] });
    }
    return r;
  },

  // YUK-06
  tipOver(ctx) {
    const r = out();
    const [x, y] = ctx.model.size;
    // Toplam yükseklik: iskelet + ayar ayağı / teker (model.overall_height_mm); eski modellerde yalnız kutu yüksekliği.
    const z = ctx.model.overall_height_mm ?? ctx.model.size[2];
    const ratio = z / Math.min(x, y);
    const lim = ctx.settings.tip_ratio;
    const wall = ctx.model.accessories.some((a) => ctx.catalog.accessories[a.item]?.kind === 'wall');
    if (ratio > lim && !wall) r.fails.push({ msg: `Toplam yükseklik ${n(z)} mm (ayak/teker dahil) / dar taban ${n(Math.min(x, y))} mm = ${n(ratio, 2)} > ${n(lim)}; duvar bağlantısı (kind: wall) yok`, ref: null });
    return r;
  },

  // PNL-07
  panelSheetSize(ctx) {
    const r = out();
    for (const p of ctx.model.panels) {
      const sheet = ctx.catalog.panels[p.material]?.sheet;
      if (!sheet) continue;
      const [long, short] = [Math.max(...sheet), Math.min(...sheet)];
      if (p.cut[0] > long + 0.05 || p.cut[1] > short + 0.05) {
        r.fails.push({ msg: `${p.id}: ${n(p.cut[0])} × ${n(p.cut[1])} mm panel, ${p.material} levhasından (${n(long)} × ${n(short)} mm) çıkmaz; paneli böl ve ek yerini bir kaydın üstüne getir`, ref: p.id });
      }
    }
    return r;
  },

  // YUK-07
  mechanismCapacity(ctx) {
    const r = out();
    for (const k of ctx.model.mechanisms) {
      if (k.type !== 'slide') continue;
      const hw = ctx.catalog.mechanisms[k.hardware];
      if (!hw || hw.capacity_kg === undefined) continue;
      const cap = hw.capacity_kg * k.count;
      const g = groupMass(ctx, k.group);
      if (g.total > cap) r.fails.push({ msg: `${k.id} (${k.hardware} × ${k.count}): grup "${k.group}" kütlesi ${n(g.own, 2)} kg + yük ${n(g.load)} kg = ${n(g.total, 2)} kg > kapasite ${n(cap)} kg`, ref: k.id });
    }
    const horizHinges = ctx.model.mechanisms.filter((k) => k.type === 'hinge' && k.axis !== 'z');
    for (const a of ctx.model.accessories) {
      const def = ctx.catalog.mechanisms[a.item];
      if (!def || def.kind !== 'stay' || def.capacity_kg === undefined) continue;
      const m = a.on ? ctx.M.get(memberOfEnd(a.on)) : null;
      let g = m?.group ?? null;
      if (!g && horizHinges.length === 1) g = horizHinges[0].group; // gövdeye takılı konsol: tek yatay kanadı taşır
      if (!g) continue;
      const cap = def.capacity_kg * a.qty;
      const gm = groupMass(ctx, g);
      if (gm.total > cap) r.fails.push({ msg: `${a.item} × ${a.qty} (${a.on ?? '?'}): grup "${g}" kütlesi ${n(gm.own, 2)} kg + yük ${n(gm.load)} kg = ${n(gm.total, 2)} kg > kapasite ${n(cap)} kg`, ref: a.on ?? a.item });
    }
    return r;
  },

  // MEK-01
  kinematics(ctx) {
    const r = out();
    const tol = ctx.tol;
    const { angle_step_deg: aStep, slide_step_mm: sStep } = ctx.settings.kinematics || {};
    for (const k of ctx.model.mechanisms) {
      const moving = groupBoxes(ctx, k.group);
      const fixed = otherBoxes(ctx, k.group);
      const reported = new Set();
      const hit = (A, B, at) => {
        const key = `${A}|${B}`;
        if (reported.has(key)) return;
        reported.add(key);
        r.fails.push({ msg: `${k.id}: ${at} konumunda ${A} ile ${B} çarpışıyor`, ref: `${k.id}:${A}|${B}` });
      };
      const steps = (a, b, s) => { const out = []; for (let x = a; x < b - 1e-9; x += s) out.push(x); out.push(b); return out; };
      if (k.type === 'hinge') {
        const fixedObb = fixed.map((f) => ({ id: f.id, o: obbFromBox(f.box) }));
        for (const ang of steps(k.range[0], k.range[1], aStep)) {
          for (const mv of moving) {
            const ro = rotateBox(mv.box, k.pivot, k.axis, ang);
            for (const f of fixedObb) if (obbCollide(ro, f.o, tol)) hit(mv.id, f.id, `${n(ang)}°`);
          }
        }
      } else if (k.type === 'slide') {
        const ai = ctx.axis(k.axis);
        const sgn = Math.sign(k.travel);
        for (const d of steps(0, Math.abs(k.travel), sStep)) {
          const v = [0, 0, 0]; v[ai] = sgn * d;
          for (const mv of moving) {
            const tb = translateBox(mv.box, v);
            for (const f of fixed) if (boxesCollide(tb, f.box, tol)) hit(mv.id, f.id, `${k.axis} ${sgn < 0 ? '−' : '+'}${n(d)} mm`);
          }
        }
      }
    }
    return r;
  },

  // MEK-02
  hingeCount(ctx) {
    const r = out();
    const h = ctx.settings.hinge;
    for (const k of ctx.model.mechanisms) {
      if (k.type !== 'hinge') continue;
      const bb = boxUnion(groupBoxes(ctx, k.group).map((x) => x.box));
      if (!bb) continue;
      const L = boxSize(bb)[ctx.axis(k.axis)];
      const need = L <= h.two_up_to_mm ? 2 : Math.ceil(L / h.pitch_mm);
      if (k.count < need) r.fails.push({ msg: `${k.id}: kanat menteşe ekseni (${k.axis}) boyunca ${n(L)} mm → en az ${need} menteşe gerekli, ${k.count} var`, ref: k.id });
    }
    return r;
  },

  // MEK-03
  hingeOnSharedEdge(ctx) {
    const r = out();
    const lim = ctx.settings.hinge.edge_distance_mm + ctx.tol;
    for (const k of ctx.model.mechanisms) {
      if (k.type !== 'hinge') continue;
      const ai = ctx.axis(k.axis);
      const [j, kk] = [0, 1, 2].filter((x) => x !== ai);
      const nearest = (list) => list.reduce((best, m) => { const d = pointRectDist(k.pivot, m.box, j, kk); return !best || d < best.d ? { id: m.id, d } : best; }, null);
      const g = nearest(ctx.model.members.filter((m) => m.group === k.group));
      const f = nearest(ctx.model.members.filter((m) => m.group !== k.group));
      if (!g || g.d > lim) r.fails.push({ msg: `${k.id}: menteşe ekseni kanadın en yakın üyesine (${g?.id ?? 'yok'}) ${g ? n(g.d) : '∞'} mm uzak > ${n(lim)} mm`, ref: k.id });
      if (!f || f.d > lim) r.fails.push({ msg: `${k.id}: menteşe ekseni gövdenin en yakın üyesine (${f?.id ?? 'yok'}) ${f ? n(f.d) : '∞'} mm uzak > ${n(lim)} mm`, ref: k.id });
    }
    return r;
  },

  // MEK-04
  slideFit(ctx) {
    const r = out();
    const tol = ctx.tol;
    for (const k of ctx.model.mechanisms) {
      if (k.type !== 'slide' || k.axis === 'z') continue;
      const hw = ctx.catalog.mechanisms[k.hardware];
      if (!hw) continue;
      const si = ctx.axis(k.axis);
      const li = si === 0 ? 1 : 0; // yanal yatay eksen
      const fixedMembers = ctx.model.members.filter((m) => !m.group);
      const ov = (a, b, i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]);
      // Rayın taşıdığı kısım, kapalı konumda gövdenin içinde kalan parçalardır. Gövdenin önünde duran ve onu örten
      // ön çerçeve (Nest çekmecesinde gövdeyle aynı genişlikte) ray boşluğu hesabına girmez.
      const bodyFixed = boxUnion(fixedMembers.map((m) => m.box));
      const all = groupBoxes(ctx, k.group);
      const inside = bodyFixed ? all.filter((x) => ov(x.box, bodyFixed, si) > tol) : all;
      const gb = boxUnion((inside.length ? inside : all).map((x) => x.box));
      if (!gb) continue;
      const cands = fixedMembers.filter((m) => ov(m.box, gb, si) > tol && ov(m.box, gb, 2) > tol);
      const sides = [
        { name: `${AXES[li]}− yanı`, gaps: cands.filter((m) => m.box.max[li] <= gb.min[li] + tol).map((m) => ({ id: m.id, gap: gb.min[li] - m.box.max[li] })) },
        { name: `${AXES[li]}+ yanı`, gaps: cands.filter((m) => m.box.min[li] >= gb.max[li] - tol).map((m) => ({ id: m.id, gap: m.box.min[li] - gb.max[li] })) },
      ];
      for (const s of sides) {
        if (!s.gaps.length) { r.fails.push({ msg: `${k.id}: ${s.name} rayın bağlanacağı yan üye yok (grup "${k.group}" ile kayma ve düşey eksende örtüşen sabit üye bulunamadı)`, ref: k.id }); continue; }
        const best = s.gaps.reduce((a, b) => (b.gap < a.gap ? b : a));
        if (Math.abs(best.gap - hw.thickness) > 1) r.fails.push({ msg: `${k.id}: ${s.name} boşluk ${n(best.gap)} mm (${best.id}); ray kalınlığı ${n(hw.thickness)} ± 1 mm olmalı`, ref: k.id });
      }
      const body = boxUnion([...fixedMembers.map((m) => m.box), ...ctx.model.panels.filter((p) => !p.group).map((p) => p.box)]);
      const depth = body ? boxSize(body)[si] : 0;
      if (hw.length !== undefined && hw.length > depth + 0.05) r.fails.push({ msg: `${k.id}: ray boyu ${n(hw.length)} mm > gövdenin ${k.axis} boyunca dış ölçüsü ${n(depth)} mm`, ref: k.id });
    }
    return r;
  },

  // MEK-05
  slideTravel(ctx) {
    const r = out();
    for (const k of ctx.model.mechanisms) {
      if (k.type !== 'slide') continue;
      const hw = ctx.catalog.mechanisms[k.hardware];
      if (!hw || hw.travel === undefined) continue;
      if (Math.abs(k.travel) > hw.travel + 0.05) r.fails.push({ msg: `${k.id}: açılma yolu ${n(Math.abs(k.travel))} mm > ${k.hardware} açılma boyu ${n(hw.travel)} mm`, ref: k.id });
    }
    return r;
  },

  // MEK-06
  foldingSupport(ctx) {
    const r = out();
    const hasStay = ctx.model.accessories.some((a) => ctx.catalog.mechanisms[a.item]?.kind === 'stay');
    for (const k of ctx.model.mechanisms) {
      if (k.type !== 'hinge' || (k.axis !== 'x' && k.axis !== 'y')) continue;
      const surf = ctx.model.panels.filter((p) => p.group === k.group && p.mount === 'surface').map((p) => p.id);
      const ids = new Set(ctx.model.members.filter((m) => m.group === k.group).map((m) => m.id));
      const loaded = ctx.model.loads.filter((l) => ids.has(l.on)).map((l) => l.on);
      if ((surf.length || loaded.length) && !hasStay) {
        r.fails.push({ msg: `${k.id}: yatay eksenli (${k.axis}) kanat${surf.length ? ` yüzey paneli (${surf.join(', ')})` : ''}${loaded.length ? ` yük (${loaded.join(', ')})` : ''} taşıyor ama katlanır konsol / amortisör (kind: stay) yok`, ref: k.id });
      }
    }
    return r;
  },

  // PNL-01
  slotThickness(ctx) {
    const r = out();
    for (const p of ctx.model.panels) {
      if (p.mount !== 'slot') continue;
      const lims = (p.between || []).map((id) => ctx.catalog.profiles[ctx.M.get(id)?.profile]?.panel_thickness_max).filter((x) => x !== undefined);
      if (!lims.length) { r.fails.push({ msg: `${p.id}: kanal panelinin çevre üyeleri belirlenemedi`, ref: p.id }); continue; }
      const lim = Math.min(...lims);
      if (p.thickness > lim) r.fails.push({ msg: `${p.id}: ${p.material} kalınlığı ${n(p.thickness)} mm > kanala giren en fazla ${n(lim)} mm`, ref: p.id });
    }
    return r;
  },

  // PNL-03
  surfacePanelSupported(ctx) {
    const r = out();
    for (const p of ctx.model.panels) {
      if (p.mount !== 'surface') continue;
      const ni = ctx.axis(p.normal);
      const on = ctx.model.members.filter((m) => { const c = boxContact(p.box, m.box, ctx.tol); return c && c.axis === ni; }).map((m) => m.id);
      if (on.length < 2) r.fails.push({ msg: `${p.id}: ${on.length} üyeye oturuyor (${on.join(', ') || 'yok'}); en az 2 üye gerekli`, ref: p.id });
      if (!(p.hardware || []).some((h) => h.qty > 0)) r.fails.push({ msg: `${p.id}: sabitleme donanımı (havşa cıvata + T-somun) yok`, ref: p.id });
    }
    return r;
  },

  // PNL-04
  panelSpan(ctx) {
    const r = out();
    for (const p of ctx.model.panels) {
      const lim = ctx.settings.panel_span_mm?.[String(p.thickness)];
      if (lim === undefined) continue;
      const span = p.mount === 'slot' && p.opening ? Math.min(...Object.values(p.opening)) : p.cut[1];
      if (span > lim) r.fails.push({ msg: `${p.id} (${p.material}, ${n(p.thickness)} mm): desteksiz kısa kenar ${n(span)} mm > ${n(lim)} mm; ara kayıt eklenmeli`, ref: p.id });
    }
    return r;
  },

  // PNL-05 — extra.assembly: { steps: [{ no, parts: [id...] }] }
  assemblyOrder(ctx) {
    const r = out();
    const asm = ctx.extra.assembly;
    if (!asm) return { ...r, skip: 'montaj sırası (extra.assembly) verilmedi' };
    const stepOf = new Map();
    for (const s of asm.steps || []) for (const id of s.parts || []) if (!stepOf.has(id)) stepOf.set(id, s.no);
    for (const p of ctx.model.panels) {
      if (p.mount !== 'slot') continue;
      const ps = stepOf.get(p.id);
      if (ps === undefined) { r.fails.push({ msg: `${p.id} montaj sırasında yok`, ref: p.id }); continue; }
      const missing = p.between.filter((id) => !stepOf.has(id));
      if (missing.length) { r.fails.push({ msg: `${p.id}: çevre üyeleri montaj sırasında yok (${missing.join(', ')})`, ref: p.id }); continue; }
      const last = Math.max(...p.between.map((id) => stepOf.get(id)));
      if (ps > last) r.fails.push({ msg: `${p.id} ${ps}. adımda takılıyor ama çerçevesi (${p.between.join(', ')}) ${last}. adımda kapanıyor; panel en geç ${last}. adımda takılmalı`, ref: p.id });
    }
    return r;
  },

  // MRK-01
  brandInOutput(ctx) {
    const r = out();
    const html = ctx.extra.html;
    if (typeof html !== 'string') return { ...r, skip: 'HTML çıktısı (extra.html) verilmedi' };
    const b = ctx.settings.brand || {};
    const low = html.toLowerCase();
    for (const c of b.colors || []) if (!low.includes(c.toLowerCase())) r.fails.push({ msg: `HTML çıktısında marka rengi ${c} yok`, ref: c });
    for (const f of b.fonts || []) if (!html.includes(f)) r.fails.push({ msg: `HTML çıktısında marka yazı tipi "${f}" yok`, ref: f });
    return r;
  },

  // MRK-02
  singleFileHtml(ctx) {
    const r = out();
    const html = ctx.extra.html;
    if (typeof html !== 'string') return { ...r, skip: 'HTML çıktısı (extra.html) verilmedi' };
    const refs = [];
    for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) refs.push(['script', m[1]]);
    for (const m of html.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)/gi)) refs.push(['link', m[1]]);
    for (const [tag, url] of refs) if (!/^https:\/\//i.test(url)) r.fails.push({ msg: `<${tag}> yerel/güvensiz kaynağa bağlı: "${url}" (yalnız https:// CDN adresleri olabilir)`, ref: url });
    if (!html.includes(ctx.model.name)) r.fails.push({ msg: `HTML çıktısı tasarım adını ("${ctx.model.name}") içermiyor`, ref: null });
    return r;
  },

  // MRK-03
  unitsSane(ctx) {
    const r = out();
    const { min_dimension: lo, max_dimension: hi } = ctx.settings.unit_sanity_mm || {};
    const mx = Math.max(...ctx.model.size);
    if (mx < lo || mx > hi) r.fails.push({ msg: `En büyük dış ölçü ${n(mx)} mm, ${n(lo)} … ${n(hi)} mm aralığının dışında (birim hatası şüphesi: cm / m?)`, ref: null });
    return r;
  },

  // ---- solver kuralları (yapısal; burada bağımsız olarak yeniden doğrulanır)

  // BIR-01
  noManualLengths(ctx) {
    const r = out();
    for (const m of ctx.design?.members || []) {
      if (m && Object.prototype.hasOwnProperty.call(m, 'length')) r.fails.push({ msg: `${m.id}: tasarımda elle boy yazılmış (length: ${JSON.stringify(m.length)}); boy uçlardan hesaplanır`, ref: m.id });
    }
    return r;
  },

  // BIR-02
  corner3Complete(ctx) {
    const r = out();
    for (const j of ctx.model.joints) {
      if (j.kind !== 'corner3') continue;
      const jt = ctx.catalog.joints[j.type];
      const need = jt?.butt_count;
      if (j.ends.length !== need) r.fails.push({ msg: `${j.id} (${j.type}, ${j.through}): ${j.ends.length} dayanan uç var, ${need} olmalı (${j.ends.join(', ') || 'yok'})`, ref: j.id });
      const ids = [memberOfEnd(j.through), ...j.ends.map(memberOfEnd)];
      const axes = ids.map((id) => ctx.M.get(id)?.axis);
      if (new Set(axes).size !== ids.length) r.fails.push({ msg: `${j.id}: üyelerin eksenleri farklı olmalı (${ids.map((id, i) => `${id}:${axes[i]}`).join(', ')})`, ref: j.id });
    }
    return r;
  },

  // PNL-02
  slotPanelSize(ctx) {
    const r = out();
    for (const p of ctx.model.panels) {
      if (p.mount !== 'slot') continue;
      const bs = (p.between || []).map((id) => ctx.M.get(id));
      if (bs.length !== 4 || bs.some((b) => !b)) { r.fails.push({ msg: `${p.id}: between dört geçerli üye değil`, ref: p.id }); continue; }
      const ni = ctx.axis(p.normal);
      const expected = [];
      for (const u of [0, 1, 2].filter((k) => k !== ni)) {
        // u yönünü, u'ya dik (diğer düzlem ekseninde) uzanan iki üye sınırlar
        const pair = bs.filter((b) => ctx.axis(b.axis) !== u).sort((a, b) => a.box.min[u] - b.box.min[u]);
        if (pair.length !== 2) { expected.length = 0; break; }
        const open = pair[1].box.min[u] - pair[0].box.max[u];
        // Tasarımda giriş payı CAD değerine sabitlendiyse (panels[].insert) o değer esas alınır.
        const fixed = p.insert && p.insert[AXES[u]] !== undefined ? 2 * p.insert[AXES[u]] : null;
        const ins = fixed !== null ? fixed : pair.reduce((s, b) => s + (ctx.catalog.profiles[b.profile]?.slot_insert ?? 0), 0);
        expected.push({ axis: AXES[u], open, size: open + ins });
        const declared = p.opening?.[AXES[u]];
        if (declared !== undefined && Math.abs(declared - open) > 0.2) r.fails.push({ msg: `${p.id}: ${AXES[u]} açıklığı modelde ${n(declared)} mm, üyelerden ${n(open)} mm`, ref: p.id });
      }
      if (expected.length !== 2) { r.fails.push({ msg: `${p.id}: açıklığı çevreleyen üyeler iki eksende ikişer değil`, ref: p.id }); continue; }
      const exp = expected.map((e) => e.size).sort((a, b) => b - a);
      if (Math.abs(exp[0] - p.cut[0]) > 0.2 || Math.abs(exp[1] - p.cut[1]) > 0.2) {
        r.fails.push({ msg: `${p.id}: kesim ${dims(p.cut)} mm; açıklık ${expected.map((e) => `${e.axis} ${n(e.open)}`).join(', ')} + kanal payları → ${dims(exp)} mm olmalı (±0,2)`, ref: p.id });
      }
    }
    return r;
  },
};

const CHECK_FUNCTIONS = Object.freeze(Object.keys(CHECKS));

// ---------------------------------------------------------------- ana giriş

/**
 * @param {object} model      solve().model
 * @param {object} design     ham tasarım JSON'u
 * @param {object} catalog    loadCatalog()
 * @param {object} rulesData  rules/rules.json nesnesi
 * @param {{html?:string, cutlist?:object, assembly?:object}} [extra]
 */
function validate(model, design, catalog, rulesData, extra = {}) {
  const ctx = makeCtx(model, design, catalog, rulesData, extra);
  const results = [];
  for (const rule of rulesData.rules || []) {
    const res = {
      id: rule.id, category: rule.category, level: rule.level, check: rule.check,
      status: 'pass', assumed: rule.status === 'varsayım', rule: rule.rule, messages: [],
    };
    if (rule.check === 'gozle') {
      res.status = 'manual';
    } else {
      const fn = rule.fn && CHECKS[rule.fn];
      if (!fn) {
        res.status = 'skip';
        res.messages.push({ msg: `denetim fonksiyonu tanımlı değil (${rule.fn ?? 'fn yok'})`, ref: null });
      } else {
        try {
          const o = fn(ctx, rule);
          if (o.skip) { res.status = 'skip'; res.messages.push({ msg: o.skip, ref: null }); }
          else if (o.fails.length) { res.status = 'fail'; res.messages.push(...o.fails); }
          else res.messages.push(...o.notes);
        } catch (e) {
          res.status = 'fail';
          res.messages.push({ msg: `denetim çalışırken hata: ${e.message}`, ref: null });
        }
      }
    }
    results.push(res);
  }
  const summary = { pass: 0, fail_error: 0, fail_warn: 0, fail_info: 0, manual: 0, skip: 0 };
  for (const r of results) {
    if (r.status === 'fail') summary[`fail_${r.level}`] = (summary[`fail_${r.level}`] || 0) + 1;
    else summary[r.status]++;
  }
  return { ok: summary.fail_error === 0, results, summary };
}

// ---------------------------------------------------------------- rapor

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Türkçe kural kontrol raporu (Markdown). */
function reportMarkdown(result, model) {
  const L = [];
  const s = result.summary;
  const tag = (r) => `${r.id}${r.assumed ? ' (varsayım)' : ''}`;
  L.push(`# Kural kontrol raporu: ${model.title ?? model.name}`, '');
  L.push(`- Tasarım: \`${model.name}\` · sınıf: ${model.class ?? 'tanımsız'}`);
  if (model.size) L.push(`- Dış ölçü: ${model.size.map((x) => n(x)).join(' × ')} mm (X × Y × Z)`);
  L.push(`- Sonuç: **${result.ok ? 'GEÇTİ' : 'HATALI'}** · ${s.pass} geçti · ${s.fail_error} hata · ${s.fail_warn} uyarı${s.fail_info ? ` · ${s.fail_info} bilgi` : ''} · ${s.manual} gözle · ${s.skip} atlandı`, '');

  const section = (title, list, empty) => {
    L.push(`## ${title}`, '');
    if (!list.length) { L.push(empty, ''); return; }
    for (const r of list) {
      L.push(`### ${tag(r)} · ${r.category}${r.level === 'info' ? ' (bilgi)' : ''}`, '', r.rule, '');
      for (const m of r.messages) L.push(`- ${m.msg}`);
      L.push('');
    }
  };
  const fails = result.results.filter((r) => r.status === 'fail');
  section('Hatalar', fails.filter((r) => r.level === 'error'), 'Hata yok.');
  section('Uyarılar', fails.filter((r) => r.level !== 'error'), 'Uyarı yok.');

  L.push('## Gözle kontrol edilecekler', '');
  const man = result.results.filter((r) => r.status === 'manual');
  if (!man.length) L.push('Yok.');
  for (const r of man) L.push(`- [ ] **${tag(r)}** ${r.rule}`);
  L.push('');

  L.push('## Geçen kurallar', '');
  const rest = result.results.filter((r) => r.status === 'pass' || r.status === 'skip');
  if (!rest.length) L.push('Yok.');
  else {
    L.push('| Kural | Kategori | Durum | Not |', '| --- | --- | --- | --- |');
    for (const r of rest) {
      const note = r.messages.length ? esc(r.messages.slice(0, 2).map((m) => m.msg).join('; ') + (r.messages.length > 2 ? ` (+${r.messages.length - 2})` : '')) : '';
      L.push(`| ${tag(r)} | ${esc(r.category)} | ${r.status === 'pass' ? 'geçti' : 'atlandı'} | ${note} |`);
    }
  }
  L.push('');
  return L.join('\n');
}

return { CHECK_FUNCTIONS, validate, reportMarkdown };
})();

__m['export/cutlist.js'] = (function () {
// export/cutlist.js — çözülmüş modelden kesim listesi ve stok boy yerleşimi (saf; dosya yazmaz).
// Boy ve adetler yalnızca model.members içinden okunur; burada yeniden hesaplanmaz.

const BOM_MARK = '\uFEFF';

/** Türkçe sayı biçimi: ondalık virgül, binlik ayracı yok. */
function trNum(n, maxDec = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const f = 10 ** maxDec;
  const r = Math.round(n * f) / f;
  return String(r).replace('.', ',');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvDoc(rows) {
  return BOM_MARK + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

function mdTable(head, rows, rightCols = []) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const sep = head.map((_, i) => (rightCols.includes(i) ? '---:' : '---'));
  return [line(head), line(sep), ...rows.map((r) => line(r.map((c) => String(c).replace(/\|/g, '\\|'))))].join('\n');
}

const cutLabel = (cut) => `${cut[0]}° / ${cut[1]}°`;

/** Üye başına kesim dışı işlemleri toplar: id → Map(metin → adet). */
function memberOperations(model) {
  const ops = new Map();
  const add = (id, text) => {
    if (!ops.has(id)) ops.set(id, new Map());
    const m = ops.get(id);
    m.set(text, (m.get(text) || 0) + 1);
  };
  for (const j of model.joints || []) {
    for (const text of j.operations || []) {
      if (text.startsWith('Üye ucuna')) {
        for (const e of j.ends || []) add(e.split(':')[0], text);
      } else if (text.startsWith('Karşı profile')) {
        // Dayanılan üyede her dayanan uç için bir işlem gerekir.
        if (j.onto) for (let i = 0; i < (j.ends || []).length; i++) add(j.onto, text);
      }
    }
  }
  // Birleşim dışı işlemler (ör. M6 saplı ayak için uç dişi) solver tarafından üyeye yazılır.
  for (const m of model.members || []) for (const text of m.operations || []) add(m.id, text);
  return ops;
}

const opsList = (map) => (map ? [...map.entries()].map(([t, n]) => (n > 1 ? `${n} × ${t}` : t)).sort() : []);

function profileOrder(catalog) {
  return (a, b) => (catalog.profiles[a]?.size ?? 0) - (catalog.profiles[b]?.size ?? 0) || (a < b ? -1 : a > b ? 1 : 0);
}

const r2 = (n) => Math.round(n * 100) / 100;

/** Stok boy yerleşimi: first-fit decreasing, her stok başında temizleme kesimi, her parça testere payı tüketir. */
function packProfile(profile, def, pieces, settings) {
  const stock = def.stock_mm;
  const kerf = settings.kerf_mm;
  const trim = settings.stock_trim_mm;
  const sorted = pieces.map((p, i) => ({ ...p, i })).sort((a, b) => b.length - a.length || a.i - b.i);
  const bars = [];
  for (const p of sorted) {
    if (trim + p.length + kerf > stock) {
      throw new Error(`Parça stok boya sığmıyor: ${p.id} (${p.length} mm, ${profile} stok boyu ${stock} mm)`);
    }
    let bar = bars.find((b) => b.used_mm + p.length + kerf <= stock);
    if (!bar) {
      bar = { no: bars.length + 1, pieces: [], used_mm: trim, waste_mm: 0 };
      bars.push(bar);
    }
    bar.pieces.push({ id: p.id, length: p.length });
    bar.used_mm = r2(bar.used_mm + p.length + kerf);
  }
  for (const b of bars) b.waste_mm = r2(stock - b.used_mm);
  const waste = r2(bars.reduce((s, b) => s + b.waste_mm, 0));
  const cutTotal = r2(pieces.reduce((s, p) => s + p.length, 0));
  return {
    profile, title: def.title, stock_mm: stock, kerf_mm: kerf, trim_mm: trim,
    bars, bar_count: bars.length, total_cut_mm: cutTotal, waste_mm: waste,
    waste_pct: bars.length ? Math.round((waste / (bars.length * stock)) * 1000) / 10 : 0,
  };
}

function cutlist(model, catalog, settings) {
  const opsByMember = memberOperations(model);
  const cmp = profileOrder(catalog);

  // Gruplama: profil + boy + işlem imzası
  const groups = new Map();
  for (const m of model.members) {
    const ops = opsList(opsByMember.get(m.id));
    const key = JSON.stringify([m.profile, m.length, cutLabel(m.cut), ops]);
    if (!groups.has(key)) groups.set(key, { profile: m.profile, length: m.length, cut: cutLabel(m.cut), ids: [], operations: ops });
    groups.get(key).ids.push(m.id);
  }
  const rows = [...groups.values()]
    .sort((a, b) => cmp(a.profile, b.profile) || b.length - a.length || a.operations.join('|').localeCompare(b.operations.join('|'), 'tr'))
    .map((g, i) => ({
      no: i + 1, profile: g.profile, title: catalog.profiles[g.profile]?.title ?? g.profile,
      length: g.length, qty: g.ids.length, cut: g.cut, ids: g.ids, operations: g.operations,
    }));

  const byProfile = new Map();
  for (const m of model.members) {
    if (!byProfile.has(m.profile)) byProfile.set(m.profile, []);
    byProfile.get(m.profile).push({ id: m.id, length: m.length });
  }
  const stock = [...byProfile.keys()].sort(cmp).map((p) => packProfile(p, catalog.profiles[p], byProfile.get(p), settings));

  const by_profile = {};
  let length_mm = 0;
  for (const m of model.members) { by_profile[m.profile] = r2((by_profile[m.profile] || 0) + m.length); length_mm += m.length; }
  return { rows, stock, totals: { pieces: model.members.length, length_mm: r2(length_mm), by_profile } };
}

function cutlistCsv(result) {
  const head = ['No', 'Profil', 'Başlık', 'Boy (mm)', 'Adet', 'Kesim açısı', 'Parça kodları', 'İşlemler'];
  const body = result.rows.map((r) => [r.no, r.profile, r.title, trNum(r.length), r.qty, r.cut, r.ids.join(', '), r.operations.join(' + ')]);
  return csvDoc([head, ...body]);
}

function cutlistMarkdown(result) {
  const out = ['# Kesim listesi', ''];
  out.push(mdTable(
    ['No', 'Profil', 'Boy (mm)', 'Adet', 'Kesim açısı', 'Parça kodları', 'İşlemler'],
    result.rows.map((r) => [r.no, r.title, trNum(r.length), r.qty, r.cut, r.ids.join(', '), r.operations.join('; ') || '-']),
    [2, 3],
  ));
  out.push('', `Toplam: ${result.totals.pieces} adet parça, ${trNum(result.totals.length_mm)} mm (${trNum(result.totals.length_mm / 1000, 3)} m).`, '');
  out.push('## Stok boy yerleşimi', '');
  for (const s of result.stock) {
    out.push(`### ${s.title}`, '');
    out.push(`Stok boy ${trNum(s.stock_mm)} mm, testere payı ${trNum(s.kerf_mm)} mm, temizleme kesimi ${trNum(s.trim_mm)} mm. Gereken boy sayısı: ${s.bar_count}; fire: ${trNum(s.waste_mm)} mm (%${trNum(s.waste_pct, 1)}).`, '');
    out.push(mdTable(
      ['Boy no', 'Parçalar (mm)', 'Kullanılan (mm)', 'Fire (mm)'],
      s.bars.map((b) => [b.no, b.pieces.map((p) => `${p.id} ${trNum(p.length)}`).join(', '), trNum(b.used_mm), trNum(b.waste_mm)]),
      [0, 2, 3],
    ), '');
  }
  return out.join('\n');
}

return { trNum, csvCell, csvDoc, mdTable, cutlist, cutlistCsv, cutlistMarkdown };
})();

__m['export/bom.js'] = (function () {
// export/bom.js — çözülmüş modelden malzeme listesi (saf; dosya yazmaz).
// Tüm sayılar model.members / model.panels / model.hardware içinden gelir.

const { trNum, csvDoc, mdTable } = __m['export/cutlist.js'];
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

const GROUPS = ['Bağlantı parçası', 'Cıvata ve somun', 'Fitil', 'Mekanizma', 'Aksesuar'];

function hardwareGroup(h, catalog) {
  const kind = catalog.items?.[h.item]?.kind ?? null;
  switch (h.catalog) {
    case 'connectors': return 'Bağlantı parçası';
    case 'fasteners': return kind === 'gasket' ? 'Fitil' : 'Cıvata ve somun';
    case 'hinges': return 'Mekanizma';
    default: return 'Aksesuar';
  }
}

function bom(model, catalog, cut) {
  // Profiller
  const pmap = new Map();
  for (const m of model.members) {
    if (!pmap.has(m.profile)) pmap.set(m.profile, { profile: m.profile, title: catalog.profiles[m.profile]?.title ?? m.profile, total_mm: 0, pieces: 0, stock_bars: null, mass_kg: 0 });
    const p = pmap.get(m.profile);
    p.total_mm += m.length; p.pieces++; p.mass_kg += m.mass_kg;
  }
  const profiles = [...pmap.values()]
    .sort((a, b) => (catalog.profiles[a.profile]?.size ?? 0) - (catalog.profiles[b.profile]?.size ?? 0) || a.profile.localeCompare(b.profile))
    .map((p) => {
      const st = cut?.stock?.find((s) => s.profile === p.profile);
      return { ...p, total_mm: r2(p.total_mm), mass_kg: r3(p.mass_kg), stock_bars: st ? st.bar_count : null };
    });

  // Paneller: aynı malzeme + aynı ölçü tek satır
  const qmap = new Map();
  for (const p of model.panels) {
    const notch = p.notch ? `${p.notch.count} köşe ${p.notch.size[0]} × ${p.notch.size[1]} mm` : '';
    const key = `${p.material}|${p.cut[0]}|${p.cut[1]}|${notch}`; // köşe çentiği farklı olan paneller ayrı satır
    if (!qmap.has(key)) qmap.set(key, { material: p.material, title: catalog.panels[p.material]?.title ?? p.material, thickness: p.thickness, cut: [p.cut[0], p.cut[1]], notch, qty: 0, ids: [], area_m2: 0, mass_kg: 0 });
    const q = qmap.get(key);
    q.qty++; q.ids.push(p.id); q.area_m2 += p.area_m2; q.mass_kg += p.mass_kg;
  }
  const panels = [...qmap.values()]
    .sort((a, b) => a.material.localeCompare(b.material) || b.cut[0] - a.cut[0] || b.cut[1] - a.cut[1])
    .map((q) => ({ ...q, area_m2: r3(q.area_m2), mass_kg: r3(q.mass_kg) }));

  // Donanım
  const hardware = model.hardware
    .map((h) => ({ item: h.item, title: h.title, unit: h.unit, qty: h.qty, group: hardwareGroup(h, catalog) }))
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.title.localeCompare(b.title, 'tr'));

  const mass = profiles.reduce((s, p) => s + p.mass_kg, 0) + panels.reduce((s, q) => s + q.mass_kg, 0);
  return {
    profiles, panels, hardware,
    totals: { mass_kg: r2(mass), panel_area_m2: r3(panels.reduce((s, q) => s + q.area_m2, 0)), hardware_items: hardware.length },
  };
}

function bomCsv(result) {
  const rows = [];
  rows.push(['Profiller']);
  rows.push(['Profil', 'Başlık', 'Toplam boy (mm)', 'Parça (adet)', 'Stok boy (adet)', 'Kütle (kg)']);
  for (const p of result.profiles) rows.push([p.profile, p.title, trNum(p.total_mm), p.pieces, p.stock_bars ?? '', trNum(p.mass_kg)]);
  rows.push([]);
  rows.push(['Paneller']);
  rows.push(['Malzeme', 'Başlık', 'Kalınlık (mm)', 'Uzun (mm)', 'Kısa (mm)', 'Adet', 'Alan (m²)', 'Köşe çentiği', 'Parça kodları']);
  for (const q of result.panels) rows.push([q.material, q.title, trNum(q.thickness), trNum(q.cut[0]), trNum(q.cut[1]), q.qty, trNum(q.area_m2, 3), q.notch || '', q.ids.join(', ')]);
  rows.push([]);
  rows.push(['Donanım']);
  rows.push(['Grup', 'Kalem', 'Başlık', 'Birim', 'Miktar']);
  for (const h of result.hardware) rows.push([h.group, h.item, h.title, h.unit, trNum(h.qty)]);
  rows.push([]);
  rows.push(['Toplam kütle (kg)', trNum(result.totals.mass_kg)]);
  rows.push(['Toplam panel alanı (m²)', trNum(result.totals.panel_area_m2, 3)]);
  rows.push(['Donanım kalemi (adet)', result.totals.hardware_items]);
  return csvDoc(rows);
}

function bomMarkdown(result) {
  const out = ['# Malzeme listesi', '', '## Profiller', ''];
  out.push(mdTable(
    ['Profil', 'Toplam boy (m)', 'Parça (adet)', 'Stok boy (adet)', 'Kütle (kg)'],
    result.profiles.map((p) => [p.title, trNum(p.total_mm / 1000, 3), p.pieces, p.stock_bars ?? '-', trNum(p.mass_kg)]),
    [1, 2, 3, 4],
  ), '');
  out.push('## Paneller', '');
  out.push(result.panels.length ? mdTable(
    ['Malzeme', 'Kalınlık (mm)', 'Ölçü (mm)', 'Adet', 'Alan (m²)', 'Köşe çentiği'],
    result.panels.map((q) => [q.title, trNum(q.thickness), `${trNum(q.cut[0])} × ${trNum(q.cut[1])}`, q.qty, trNum(q.area_m2, 3), q.notch || '-']),
    [1, 3, 4],
  ) : 'Panel yok.', '');
  out.push('## Donanım', '');
  for (const g of GROUPS) {
    const items = result.hardware.filter((h) => h.group === g);
    if (!items.length) continue;
    out.push(`### ${g}`, '');
    out.push(mdTable(['Kalem', 'Birim', 'Miktar'], items.map((h) => [h.title, h.unit, trNum(h.qty)]), [2]), '');
  }
  out.push(`Toplam kütle: ${trNum(result.totals.mass_kg)} kg. Toplam panel alanı: ${trNum(result.totals.panel_area_m2, 3)} m². Donanım kalemi: ${result.totals.hardware_items}.`, '');
  return out.join('\n');
}

return { bom, bomCsv, bomMarkdown };
})();

  var catalog = {"profiles":{"sigma-20x20":{"title":"Sigma profil 20×20 (kanal 6)","size":20,"slot":6,"slot_insert":5,"panel_thickness_max":4,"use":"kucuk-mobilya","tnut":"t-somun-M5-k6","end_tap":null,"cap":"uc-kapagi-20","default_butt":"gizli-baglanti-20","default_corner":"kose-3yollu-20","mass_kg_m":0.48,"I_mm4":7000,"W_mm3":700,"stock_mm":6000,"source":"GLB (BorisinTahti: 28 üye 20×20; çekmece modülünde panel kanala 5 mm giriyor); kesit değerleri katalog-tipik","status":{"geometri":"kesin","kesit_degerleri":"varsayım"},"tnut_m4":"t-somun-M4-k6","foot":"ayar-ayagi"},"sigma-40x40":{"title":"Sigma profil 40×40 (kanal 8)","size":40,"slot":8,"slot_insert":11,"panel_thickness_max":6,"use":"tasiyici","tnut":"t-somun-M5-k8","end_tap":"M6","cap":"uc-kapagi-40","default_butt":"uc-disli-M6-40","default_corner":null,"mass_kg_m":1.5,"I_mm4":90000,"W_mm3":4500,"stock_mm":6000,"source":"README (taşıyıcı 40×40; M6 yalnız diş açılmış uçta), prototip yatak modeli; kesit ve kanal değerleri katalog-tipik","status":{"geometri":"kesin","kesit_degerleri":"varsayım","kanal":"varsayım"},"tnut_m4":"t-somun-M4-k8","foot":"ayar-ayagi-40"}},"joints":{"gizli-baglanti-20":{"title":"Gizli bağlantı ile alın birleşimi (20×20)","kind":"butt","profiles":["sigma-20x20"],"onto_profiles":["sigma-20x20","sigma-40x40"],"max_ends":1,"hardware":[{"item":"gizli-baglanti-20","qty":1}],"source":"Can, 2026-11-20: SolidWorks BOM'unda parçası görünmeyen alın birleşimleri gizli bağlantıyla yapılıyor (Nest çekmecesinde 14, kafesin gövdesinde 16, masanın orta kaydında 2). Notion HERO (2025-12-16): gizli köşe bağlantı, zamak, kanal 6 uyumlu, setskurlu.","status":{"yontem":"kesin","setskur":"varsayım: setskurlar parçayla gelir, ayrıca sayılmaz"}},"kose-braketi-20":{"title":"2 yönlü köşe bağlantısı ile alın birleşimi (20×20, görünür)","kind":"butt","profiles":["sigma-20x20"],"onto_profiles":["sigma-20x20","sigma-40x40"],"max_ends":1,"hardware":[{"item":"kose-braketi-20","qty":1},{"item":"M5x10-havsa","qty":2},{"item":"@tnut:self","qty":1},{"item":"@tnut:onto","qty":1}],"source":"Sigma Çalışma Masası BOM: 6 adet 2 yönlü ara bağlantı, 12 T-somun M5, 12 havşa M5×10 (DIN 7991): bağlantı başına 2 + 2. Masanın alt kirişlerinde ve kafes kapısının köşelerinde kullanılıyor.","status":"kesin"},"kose-3yollu-20":{"title":"3 yollu köşe bağlantısı (20×20)","kind":"corner3","profiles":["sigma-20x20"],"onto_profiles":["sigma-20x20"],"through_deduct":5,"butt_count":2,"hardware":[{"item":"kose-3yollu-20","qty":1}],"source":"GLB BorisinTahti: '3Way Corner - Sigma' 36×36×20,5; boydan geçen üye her uçta 5 mm kısa. Sigma Çalışma Masası BOM'unda 4 köşe için ayrı cıvata ya da T-somun yok (12 + 12 adedin hepsi 2 yönlü bağlantılara ait): köşe setskurlu, sabitleme elemanları parçayla gelir.","status":{"geometri":"kesin","sabitleme":"kesin (masa BOM)"}},"plaka-T-20":{"title":"Düz T bağlantı plakası ile alın birleşimi (20×20)","kind":"butt","profiles":["sigma-20x20"],"onto_profiles":["sigma-20x20"],"max_ends":1,"hardware":[{"item":"plaka-T-20","qty":1},{"item":"M5x10","qty":4},{"item":"@tnut:self","qty":2},{"item":"@tnut:onto","qty":2}],"source":"GLB BorisinTahti: '3Way Connection' 80×50×1,5 (4 adet, dış yüzde). Vida adedi GLB'de yok.","status":{"geometri":"kesin","vida_adedi":"varsayım"}},"plaka-arti-20":{"title":"Düz artı (4 yollu) bağlantı plakası ile alın birleşimi (20×20)","kind":"butt","profiles":["sigma-20x20"],"onto_profiles":["sigma-20x20"],"max_ends":2,"hardware":[{"item":"plaka-arti-20","qty":1},{"item":"M5x10","qty":5},{"item":"@tnut:self","qty":4},{"item":"@tnut:onto","qty":1}],"source":"GLB BorisinTahti: '4Way Connection' 80×80×1,5 (2 adet; boydan geçen üyeye karşılıklı dayanan iki ucu tek plaka tutar). Vida adedi GLB'de yok.","status":{"geometri":"kesin","vida_adedi":"varsayım"}},"uc-disli-M6-40":{"title":"Diş açılmış uca M6 ile alın birleşimi (40×40, standart uç bağlantısı)","kind":"butt","profiles":["sigma-40x40"],"onto_profiles":["sigma-40x40"],"max_ends":1,"operations":["Üye ucuna M6 diş açılır","Karşı profile Ø7 alyan erişim deliği delinir (cıvata başı kanalda kalır)"],"hardware":[{"item":"M6x25","qty":1}],"source":"README: M6 yalnız diş açılmış profil uçlarında; prototip bomRows: 40×40 kiriş ucu başına 1 × M6. Cıvata boyu kaynakta yok. Cıvata başı karşı profilin kanalında oturur, alyan erişim deliğinden sıkılır; aynı ayağa farklı yüzlerden dayanan kayıtların cıvataları bu yüzden çakışmaz.","status":{"yontem":"kesin","civata_boyu":"varsayım"}},"kose-braketi-40":{"title":"İç köşe braketi ile alın birleşimi (40×40)","kind":"butt","profiles":["sigma-40x40"],"onto_profiles":["sigma-40x40"],"max_ends":1,"hardware":[{"item":"kose-braketi-40","qty":1},{"item":"M5x12","qty":2},{"item":"@tnut:self","qty":1},{"item":"@tnut:onto","qty":1}],"source":"Kaynaklarda yok; uca diş açılamayan yerler için yedek seçenek.","status":"varsayım"}},"parts":{"gizli-baglanti-20":{"title":"Gizli bağlantı 20×20 (zamak, kanal 6, setskurlu)","dims":null,"source":"CAD modellerinde parça olarak yok; ölçüsü bilinmiyor"},"kose-braketi-20":{"title":"2 yönlü köşe bağlantısı 20×20 (görünür)","dims":[22,22,17],"source":"Masa modeli '20x20 sigma connection 2 way' 22×22×17; kafes kapısında benzeri '20x25 2wayCorner' 26×25×9,5"},"kose-3yollu-20":{"title":"3 yollu köşe bağlantısı 20×20","dims":[36,36,20.5],"source":"GLB '3Way Corner - Sigma'"},"plaka-T-20":{"title":"Düz T bağlantı plakası 80×50×1,5","dims":[80,50,1.5],"source":"GLB '3Way Connection'"},"plaka-arti-20":{"title":"Düz artı bağlantı plakası 80×80×1,5","dims":[80,80,1.5],"source":"GLB '4Way Connection'"},"kose-braketi-40":{"title":"İç köşe braketi 40×40","dims":[40,40,35],"source":"varsayım"}},"fasteners":{"M4x8":{"title":"M4×8 imbus cıvata","thread":"M4","length":8,"kind":"bolt"},"M4x12":{"title":"M4×12 imbus cıvata","thread":"M4","length":12,"kind":"bolt"},"M5x8":{"title":"M5×8 imbus cıvata","thread":"M5","length":8,"kind":"bolt"},"M5x10":{"title":"M5×10 imbus cıvata","thread":"M5","length":10,"kind":"bolt"},"M5x12":{"title":"M5×12 imbus cıvata","thread":"M5","length":12,"kind":"bolt"},"M5x16":{"title":"M5×16 imbus cıvata","thread":"M5","length":16,"kind":"bolt"},"M5x25":{"title":"M5×25 imbus cıvata","thread":"M5","length":25,"kind":"bolt"},"M6x25":{"title":"M6×25 imbus cıvata (yalnız diş açılmış profil ucu)","thread":"M6","length":25,"kind":"bolt","only_tapped_end":true},"t-somun-M4-k6":{"title":"T-somun M4 (kanal 6)","thread":"M4","slot":6,"kind":"tnut"},"t-somun-M5-k6":{"title":"T-somun M5 (kanal 6)","thread":"M5","slot":6,"kind":"tnut"},"t-somun-M5-k8":{"title":"T-somun M5 (kanal 8)","thread":"M5","slot":8,"kind":"tnut"},"t-somun-M4-k8":{"title":"T-somun M4 (kanal 8)","thread":"M4","slot":8,"kind":"tnut"},"rondela-M5":{"title":"Rondela M5","thread":"M5","kind":"washer"},"duvar-vidasi-5x60":{"title":"Duvar vidası 5×60 + duvar tipine uygun dübel","kind":"wall","length":60,"status":"varsayım"},"M5x10-havsa":{"title":"M5×10 havşa başlı cıvata (DIN 7991)","thread":"M5","length":10,"kind":"bolt","source":"Sigma Çalışma Masası BOM: 2 yönlü bağlantı başına 2 adet"},"M5x12-havsa":{"title":"M5×12 havşa başlı cıvata (panel montajı)","thread":"M5","length":12,"kind":"bolt"},"M5x16-havsa":{"title":"M5×16 havşa başlı cıvata (12 mm panel montajı)","thread":"M5","length":16,"kind":"bolt"},"M5x25-havsa":{"title":"M5×25 havşa başlı cıvata (18 mm tabla montajı)","thread":"M5","length":25,"kind":"bolt"},"fitil-kanal6":{"title":"Panel sıkıştırma fitili, kanal 6","kind":"gasket","unit":"m"}},"panels":{"kompozit-3":{"title":"Alüminyum kompozit panel 3 mm (kanala girer)","thickness":3,"mounts":["slot"],"density_kg_m2":4,"source":"GLB BorisinTahti: 'KK Alt Panel Uzun' 570×375×3; Notion Ses geçirmez oda (2026-10-16): 3 mm ACP; Ürünler DB köpek kafesi: alüminyum kompozit","status":"kesin","slot_gasket":"fitil-kanal6","sheet":[3200,1250]},"kompozit-4":{"title":"Alüminyum kompozit panel 4 mm, antrasit/siyah (kanala girer)","thickness":4,"mounts":["slot"],"density_kg_m2":5.5,"source":"GLB çekmece modülü: 'Ust Panel' 470×570×4; Notion HERO (2025-12-16): 4 mm alüminyum kompozit, CNC kesim, Kanal 6 sıkıştırma fitili","status":"kesin","slot_gasket":"fitil-kanal6","sheet":[3200,1250]},"polikarbonat-4":{"title":"Polikarbonat panel 4 mm, şeffaf (kanala girer)","thickness":4,"mounts":["slot"],"density_kg_m2":4.8,"slot_gasket":"fitil-kanal6","see_through":true,"source":"Notion üretim standardı şablonu (2026-05-15): 4 mm polikarbonat panel örneği","status":"kesin","sheet":[3050,2050]},"tel-panel":{"title":"Tel örgü panel 1,5 mm","thickness":1.5,"mounts":["slot","surface"],"density_kg_m2":2.5,"see_through":true,"source":"GLB BorisinTahti: 'KK Tel Panel' 560×370×1,5","status":"kesin","surface_fix":{"item":"M5x8","with":["@tnut:on"],"pitch":200,"status":"varsayım"},"sheet":[2000,1000]},"kontrplak-12":{"title":"Lamine kontrplak 12 mm (yüzeye)","thickness":12,"mounts":["surface"],"density_kg_m2":8,"source":"Notion Nest/Kitchen 45 (2025-11-30): 9–12 mm lamine kontrplak, içten vidalı","status":"kesin","surface_fix":{"item":"M5x16-havsa","with":["@tnut:on"],"pitch":250,"status":"varsayım"},"sheet":[2440,1220],"E_mpa":7000},"kontrplak-18":{"title":"Kontrplak / ahşap tabla 18 mm (yüzeye)","thickness":18,"mounts":["surface"],"density_kg_m2":12,"source":"Prototip modelleri: masa tablası 18 mm, yatak lataları 18 mm","status":"kesin","surface_fix":{"item":"M5x25-havsa","with":["@tnut:on"],"pitch":250,"status":"varsayım"},"sheet":[2440,1220],"E_mpa":7000},"kompakt-12":{"title":"Kompakt laminat 12 mm (yüzeye, suya dayanıklı)","thickness":12,"mounts":["surface"],"density_kg_m2":17,"source":"Notion Nest / Water Utility (2025-11-30): kompakt laminat seçeneği","status":"kesin","surface_fix":{"item":"M5x16-havsa","with":["@tnut:on"],"pitch":250,"status":"varsayım"},"sheet":[2800,1300],"E_mpa":9000}},"mechanisms":{"mentese-20":{"title":"Yaprak menteşe 40×24,5×9","kind":"hinge","dims":[40,24.5,9],"leaf_thickness":9,"hardware":[{"item":"M5x8","qty":4},{"item":"@tnut:on","qty":4}],"source":"GLB BorisinTahti: '40x40 menteşe' çifti, 760 mm kapı dikmesinde 4 adet, aralık 220 mm, uçtan 50 mm","status":{"geometri":"kesin","vida_adedi":"varsayım"}},"ray-teleskopik-300":{"title":"Tam açılır bilyalı teleskopik ray 300 mm (çift)","kind":"slide","length":300,"thickness":13,"height":42,"travel":300,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"500 mm'lik GLB rayının kısa boyu (standart 50 mm adım). Kör testte 400 mm derin komodin için gerekti; Notion HERO/MVP 450 mm frenli ray anıyor.","status":"varsayım"},"ray-teleskopik-350":{"title":"Tam açılır bilyalı teleskopik ray 350 mm (çift)","kind":"slide","length":350,"thickness":13,"height":42,"travel":350,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"500 mm'lik GLB rayının kısa boyu (standart 50 mm adım). Kör testte 400 mm derin komodin için gerekti; Notion HERO/MVP 450 mm frenli ray anıyor.","status":"varsayım"},"ray-teleskopik-400":{"title":"Tam açılır bilyalı teleskopik ray 400 mm (çift)","kind":"slide","length":400,"thickness":13,"height":42,"travel":400,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"500 mm'lik GLB rayının kısa boyu (standart 50 mm adım). Kör testte 400 mm derin komodin için gerekti; Notion HERO/MVP 450 mm frenli ray anıyor.","status":"varsayım"},"ray-teleskopik-450":{"title":"Tam açılır bilyalı teleskopik ray 450 mm (çift)","kind":"slide","length":450,"thickness":13,"height":42,"travel":450,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"500 mm'lik GLB rayının kısa boyu (standart 50 mm adım). Kör testte 400 mm derin komodin için gerekti; Notion HERO/MVP 450 mm frenli ray anıyor.","status":"varsayım"},"ray-teleskopik-500":{"title":"Tam açılır bilyalı teleskopik ray 500 mm (çift)","kind":"slide","length":500,"thickness":13,"height":42,"travel":500,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"GLB çekmece modülü: Big/Middle/Small Slide 500×42×13, yan başına 1; kapasite Notion Nest (en az 45 kg)","status":{"geometri":"kesin","kapasite":"varsayım","vida_adedi":"varsayım"}},"ray-teleskopik-600":{"title":"Tam açılır bilyalı teleskopik ray 600 mm (çift)","kind":"slide","length":600,"thickness":13,"height":42,"travel":600,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"Notion Nest 30 (2025-11-30): 600 mm ağır hizmet teleskopik ray; kesit ölçüleri 500'lük GLB rayından alındı","status":"varsayım"},"katlanir-konsol-300":{"title":"Kilitli katlanır raf konsolu 300 mm (çift)","kind":"stay","length":300,"capacity_kg":60,"hardware":[{"item":"M5x10","qty":8},{"item":"@tnut:on","qty":8}],"source":"Kaynaklarda yok. Katlanır masa için gerekli; ilk atölye üretiminde seçilecek.","status":"varsayım"},"kapak-askisi-celik":{"title":"Çelik halatlı kapak askısı, ayarlı (çift)","kind":"stay","capacity_kg":80,"hardware":[{"item":"M5x10","qty":4},{"item":"@tnut:on","qty":4}],"source":"Kaynaklarda yok. Aşağı açılan kapak-masa için: dolabın üst ön köşesinden kanadın yan kirişine çekmeye çalışan askı. Kapasite ve bağlantı ilk üretimde seçilecek.","status":"varsayım"},"gazli-amortisor":{"title":"Gazlı amortisör (kapak / lavabo tablası)","kind":"stay","hardware":[{"item":"M5x10","qty":2},{"item":"@tnut:on","qty":2}],"source":"Görseller: lavabo tablası ve ocak kapağında gaz amortisörü. Boy ve kuvvet kaynakta yok.","status":{"kullanim":"kesin","olcu":"varsayım"}},"mandal-ayarli":{"title":"Ayarlı kancalı mandal, paslanmaz","kind":"latch","dims":[124.9,47.7,27.6],"hardware":[{"item":"M4x8","qty":4},{"item":"@tnut4:on","qty":4}],"source":"GLB BorisinTahti: 'Adjustable latch stainless steel with hook' ×2","status":{"geometri":"kesin","vida_adedi":"varsayım"}},"kilit-gomme":{"title":"Mini kabin kilidi, Mesan 116 (tutamak + dil + montaj sacı + gövde)","kind":"latch","hardware":[],"source":"SolidWorks Drawer Module BOM (rD2.1): 'Mini Kabin Kilidi Mesan 116' ×1; GLB parça kodları 30301233_TUTAMAK, 30402017_DIL, 32003337_MONTAJ_SACI, 33202010_PLASTIK_GOVDE","status":"kesin"}},"accessories":{"uc-kapagi-20":{"title":"Uç kapağı 20×20, siyah plastik","kind":"cap","mount":"end","profiles":["sigma-20x20"],"hardware":[],"source":"Görseller (CAD renderları): profil uçlarında siyah kare plastik kapak; GLB çekmece modülü: 20×20×7,5 parça ×4","status":"kesin"},"uc-kapagi-40":{"title":"Uç kapağı 40×40, siyah plastik","kind":"cap","mount":"end","profiles":["sigma-40x40"],"hardware":[],"source":"20×20 kapağın 40×40 karşılığı","status":"varsayım"},"ayar-ayagi":{"title":"Ayar ayağı, plastik tabanlı, M5 saplı (20×20)","kind":"foot","mount":"end","height":15,"profiles":["sigma-20x20"],"hardware":[],"source":"Prototip görüntüleyici: ayak r14–16, h15 mm. Notion HERO (2025-12-16) daha büyük saplamalı döner ayak yazıyor; bağlantı elemanı standardı gereği M5/M6'ya çevrildi (conflicts.md).","status":{"olcu":"kesin","dis":"varsayım"}},"ayar-ayagi-40":{"title":"Ayar ayağı, plastik tabanlı, M6 saplı (40×40, diş açılmış uca)","kind":"foot","mount":"end","height":15,"profiles":["sigma-40x40"],"hardware":[],"source":"README: M6 yalnız diş açılmış profil ucunda. Ayak ölçüsü 20×20 ayağından alındı.","status":"varsayım","operations":["Üye ucuna M6 diş açılır"]},"teker-frenli-125":{"title":"Frenli döner teker, plakalı (toplam yükseklik ≈158 mm)","kind":"caster","mount":"face","height":158.5,"plate":[57.2,57.2,4.4],"hardware":[{"item":"M5x10","qty":4},{"item":"@tnut:on","qty":4}],"source":"GLB BorisinTahti: '215x - Tekerlek' ×4, kutu 70×158,5×178,7; plaka 57,2×57,2×4,4","status":{"geometri":"kesin","vida_adedi":"varsayım"}},"tutamak-polyamid-145":{"title":"Polyamid tutamak 145×46×25","kind":"handle","mount":"face","dims":[145,46,25],"hardware":[{"item":"M5x16","qty":2},{"item":"@tnut:on","qty":2}],"source":"GLB BorisinTahti: 'POLYAMIDE HANDLE' ×2","status":{"geometri":"kesin","vida":"varsayım"}},"duvar-baglantisi":{"title":"Duvar bağlantı noktası (profil içinden duvar vidası)","kind":"wall","mount":"face","hardware":[{"item":"duvar-vidasi-5x60","qty":1},{"item":"rondela-M5","qty":1}],"source":"Kaynaklarda yok; duvara monte tasarımlar için.","status":"varsayım"}},"meta":{"fasteners":{"aciklama":"Bağlantı elemanları. İzinli dişler: M4, M5. M6 yalnızca 'only_tapped_end' ile, yani profile diş açılan birleşimde. Burada olmayan cıvata/somun tasarımda kullanılamaz.","allowed_threads":["M4","M5"],"restricted_threads":{"M6":"yalnızca profil ucuna diş açılan birleşimde (uc-disli-M6-40)"}},"panels":{"aciklama":"Panel malzemeleri. mounts: 'slot' = profil kanalına girer (kalınlık profilin panel_thickness_max değerini aşamaz), 'surface' = profil yüzüne oturur ve vidalanır. Yoğunluklar tipik değerdir (varsayım).","slot_kurali":"Kanal paneli ölçüsü = açıklık + 2 × profil.slot_insert (20×20 için açıklık + 10 mm). Kaynak: GLB (kafes 560→570, çekmece modülü 460→470) ve Notion panel-kanal tablosu (20 serisi +10 mm, 40 serisi +22 mm).","yuzey_kurali":"Yüzey paneli havşa başlı M5 + T-somunla sabitlenir; adet verilmezse çevre / pitch (en az 4).","levha":"sheet: tedarik edilen levhanın [uzun, kısa] ölçüsü (mm). Panel kesim ölçüsü bunu geçemez; geçiyorsa panel bölünür. Değerler piyasa standardıdır (varsayım).","rijitlik":"E_mpa: eğilme elastisite modülü (MPa). Yalnız yüzeye vidalanan levhalarda tanımlıdır; kirişe vidalı panelin sehim hesabına katkısı bununla hesaplanır (YUK-01). Değerler güvenli tarafta seçilmiş tipik değerlerdir (varsayım)."}},"items":{"gizli-baglanti-20":{"title":"Gizli bağlantı 20×20 (zamak, kanal 6, setskurlu)","dims":null,"source":"CAD modellerinde parça olarak yok; ölçüsü bilinmiyor","id":"gizli-baglanti-20","catalog":"connectors"},"kose-braketi-20":{"title":"2 yönlü köşe bağlantısı 20×20 (görünür)","dims":[22,22,17],"source":"Masa modeli '20x20 sigma connection 2 way' 22×22×17; kafes kapısında benzeri '20x25 2wayCorner' 26×25×9,5","id":"kose-braketi-20","catalog":"connectors"},"kose-3yollu-20":{"title":"3 yollu köşe bağlantısı 20×20","dims":[36,36,20.5],"source":"GLB '3Way Corner - Sigma'","id":"kose-3yollu-20","catalog":"connectors"},"plaka-T-20":{"title":"Düz T bağlantı plakası 80×50×1,5","dims":[80,50,1.5],"source":"GLB '3Way Connection'","id":"plaka-T-20","catalog":"connectors"},"plaka-arti-20":{"title":"Düz artı bağlantı plakası 80×80×1,5","dims":[80,80,1.5],"source":"GLB '4Way Connection'","id":"plaka-arti-20","catalog":"connectors"},"kose-braketi-40":{"title":"İç köşe braketi 40×40","dims":[40,40,35],"source":"varsayım","id":"kose-braketi-40","catalog":"connectors"},"M4x8":{"title":"M4×8 imbus cıvata","thread":"M4","length":8,"kind":"bolt","id":"M4x8","catalog":"fasteners"},"M4x12":{"title":"M4×12 imbus cıvata","thread":"M4","length":12,"kind":"bolt","id":"M4x12","catalog":"fasteners"},"M5x8":{"title":"M5×8 imbus cıvata","thread":"M5","length":8,"kind":"bolt","id":"M5x8","catalog":"fasteners"},"M5x10":{"title":"M5×10 imbus cıvata","thread":"M5","length":10,"kind":"bolt","id":"M5x10","catalog":"fasteners"},"M5x12":{"title":"M5×12 imbus cıvata","thread":"M5","length":12,"kind":"bolt","id":"M5x12","catalog":"fasteners"},"M5x16":{"title":"M5×16 imbus cıvata","thread":"M5","length":16,"kind":"bolt","id":"M5x16","catalog":"fasteners"},"M5x25":{"title":"M5×25 imbus cıvata","thread":"M5","length":25,"kind":"bolt","id":"M5x25","catalog":"fasteners"},"M6x25":{"title":"M6×25 imbus cıvata (yalnız diş açılmış profil ucu)","thread":"M6","length":25,"kind":"bolt","only_tapped_end":true,"id":"M6x25","catalog":"fasteners"},"t-somun-M4-k6":{"title":"T-somun M4 (kanal 6)","thread":"M4","slot":6,"kind":"tnut","id":"t-somun-M4-k6","catalog":"fasteners"},"t-somun-M5-k6":{"title":"T-somun M5 (kanal 6)","thread":"M5","slot":6,"kind":"tnut","id":"t-somun-M5-k6","catalog":"fasteners"},"t-somun-M5-k8":{"title":"T-somun M5 (kanal 8)","thread":"M5","slot":8,"kind":"tnut","id":"t-somun-M5-k8","catalog":"fasteners"},"t-somun-M4-k8":{"title":"T-somun M4 (kanal 8)","thread":"M4","slot":8,"kind":"tnut","id":"t-somun-M4-k8","catalog":"fasteners"},"rondela-M5":{"title":"Rondela M5","thread":"M5","kind":"washer","id":"rondela-M5","catalog":"fasteners"},"duvar-vidasi-5x60":{"title":"Duvar vidası 5×60 + duvar tipine uygun dübel","kind":"wall","length":60,"status":"varsayım","id":"duvar-vidasi-5x60","catalog":"fasteners"},"M5x10-havsa":{"title":"M5×10 havşa başlı cıvata (DIN 7991)","thread":"M5","length":10,"kind":"bolt","source":"Sigma Çalışma Masası BOM: 2 yönlü bağlantı başına 2 adet","id":"M5x10-havsa","catalog":"fasteners"},"M5x12-havsa":{"title":"M5×12 havşa başlı cıvata (panel montajı)","thread":"M5","length":12,"kind":"bolt","id":"M5x12-havsa","catalog":"fasteners"},"M5x16-havsa":{"title":"M5×16 havşa başlı cıvata (12 mm panel montajı)","thread":"M5","length":16,"kind":"bolt","id":"M5x16-havsa","catalog":"fasteners"},"M5x25-havsa":{"title":"M5×25 havşa başlı cıvata (18 mm tabla montajı)","thread":"M5","length":25,"kind":"bolt","id":"M5x25-havsa","catalog":"fasteners"},"fitil-kanal6":{"title":"Panel sıkıştırma fitili, kanal 6","kind":"gasket","unit":"m","id":"fitil-kanal6","catalog":"fasteners"},"mentese-20":{"title":"Yaprak menteşe 40×24,5×9","kind":"hinge","dims":[40,24.5,9],"leaf_thickness":9,"hardware":[{"item":"M5x8","qty":4},{"item":"@tnut:on","qty":4}],"source":"GLB BorisinTahti: '40x40 menteşe' çifti, 760 mm kapı dikmesinde 4 adet, aralık 220 mm, uçtan 50 mm","status":{"geometri":"kesin","vida_adedi":"varsayım"},"id":"mentese-20","catalog":"hinges"},"ray-teleskopik-300":{"title":"Tam açılır bilyalı teleskopik ray 300 mm (çift)","kind":"slide","length":300,"thickness":13,"height":42,"travel":300,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"500 mm'lik GLB rayının kısa boyu (standart 50 mm adım). Kör testte 400 mm derin komodin için gerekti; Notion HERO/MVP 450 mm frenli ray anıyor.","status":"varsayım","id":"ray-teleskopik-300","catalog":"hinges"},"ray-teleskopik-350":{"title":"Tam açılır bilyalı teleskopik ray 350 mm (çift)","kind":"slide","length":350,"thickness":13,"height":42,"travel":350,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"500 mm'lik GLB rayının kısa boyu (standart 50 mm adım). Kör testte 400 mm derin komodin için gerekti; Notion HERO/MVP 450 mm frenli ray anıyor.","status":"varsayım","id":"ray-teleskopik-350","catalog":"hinges"},"ray-teleskopik-400":{"title":"Tam açılır bilyalı teleskopik ray 400 mm (çift)","kind":"slide","length":400,"thickness":13,"height":42,"travel":400,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"500 mm'lik GLB rayının kısa boyu (standart 50 mm adım). Kör testte 400 mm derin komodin için gerekti; Notion HERO/MVP 450 mm frenli ray anıyor.","status":"varsayım","id":"ray-teleskopik-400","catalog":"hinges"},"ray-teleskopik-450":{"title":"Tam açılır bilyalı teleskopik ray 450 mm (çift)","kind":"slide","length":450,"thickness":13,"height":42,"travel":450,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"500 mm'lik GLB rayının kısa boyu (standart 50 mm adım). Kör testte 400 mm derin komodin için gerekti; Notion HERO/MVP 450 mm frenli ray anıyor.","status":"varsayım","id":"ray-teleskopik-450","catalog":"hinges"},"ray-teleskopik-500":{"title":"Tam açılır bilyalı teleskopik ray 500 mm (çift)","kind":"slide","length":500,"thickness":13,"height":42,"travel":500,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"GLB çekmece modülü: Big/Middle/Small Slide 500×42×13, yan başına 1; kapasite Notion Nest (en az 45 kg)","status":{"geometri":"kesin","kapasite":"varsayım","vida_adedi":"varsayım"},"id":"ray-teleskopik-500","catalog":"hinges"},"ray-teleskopik-600":{"title":"Tam açılır bilyalı teleskopik ray 600 mm (çift)","kind":"slide","length":600,"thickness":13,"height":42,"travel":600,"capacity_kg":45,"hardware":[{"item":"M4x8","qty":12},{"item":"@tnut4:on","qty":12}],"source":"Notion Nest 30 (2025-11-30): 600 mm ağır hizmet teleskopik ray; kesit ölçüleri 500'lük GLB rayından alındı","status":"varsayım","id":"ray-teleskopik-600","catalog":"hinges"},"katlanir-konsol-300":{"title":"Kilitli katlanır raf konsolu 300 mm (çift)","kind":"stay","length":300,"capacity_kg":60,"hardware":[{"item":"M5x10","qty":8},{"item":"@tnut:on","qty":8}],"source":"Kaynaklarda yok. Katlanır masa için gerekli; ilk atölye üretiminde seçilecek.","status":"varsayım","id":"katlanir-konsol-300","catalog":"hinges"},"kapak-askisi-celik":{"title":"Çelik halatlı kapak askısı, ayarlı (çift)","kind":"stay","capacity_kg":80,"hardware":[{"item":"M5x10","qty":4},{"item":"@tnut:on","qty":4}],"source":"Kaynaklarda yok. Aşağı açılan kapak-masa için: dolabın üst ön köşesinden kanadın yan kirişine çekmeye çalışan askı. Kapasite ve bağlantı ilk üretimde seçilecek.","status":"varsayım","id":"kapak-askisi-celik","catalog":"hinges"},"gazli-amortisor":{"title":"Gazlı amortisör (kapak / lavabo tablası)","kind":"stay","hardware":[{"item":"M5x10","qty":2},{"item":"@tnut:on","qty":2}],"source":"Görseller: lavabo tablası ve ocak kapağında gaz amortisörü. Boy ve kuvvet kaynakta yok.","status":{"kullanim":"kesin","olcu":"varsayım"},"id":"gazli-amortisor","catalog":"hinges"},"mandal-ayarli":{"title":"Ayarlı kancalı mandal, paslanmaz","kind":"latch","dims":[124.9,47.7,27.6],"hardware":[{"item":"M4x8","qty":4},{"item":"@tnut4:on","qty":4}],"source":"GLB BorisinTahti: 'Adjustable latch stainless steel with hook' ×2","status":{"geometri":"kesin","vida_adedi":"varsayım"},"id":"mandal-ayarli","catalog":"hinges"},"kilit-gomme":{"title":"Mini kabin kilidi, Mesan 116 (tutamak + dil + montaj sacı + gövde)","kind":"latch","hardware":[],"source":"SolidWorks Drawer Module BOM (rD2.1): 'Mini Kabin Kilidi Mesan 116' ×1; GLB parça kodları 30301233_TUTAMAK, 30402017_DIL, 32003337_MONTAJ_SACI, 33202010_PLASTIK_GOVDE","status":"kesin","id":"kilit-gomme","catalog":"hinges"},"uc-kapagi-20":{"title":"Uç kapağı 20×20, siyah plastik","kind":"cap","mount":"end","profiles":["sigma-20x20"],"hardware":[],"source":"Görseller (CAD renderları): profil uçlarında siyah kare plastik kapak; GLB çekmece modülü: 20×20×7,5 parça ×4","status":"kesin","id":"uc-kapagi-20","catalog":"accessories"},"uc-kapagi-40":{"title":"Uç kapağı 40×40, siyah plastik","kind":"cap","mount":"end","profiles":["sigma-40x40"],"hardware":[],"source":"20×20 kapağın 40×40 karşılığı","status":"varsayım","id":"uc-kapagi-40","catalog":"accessories"},"ayar-ayagi":{"title":"Ayar ayağı, plastik tabanlı, M5 saplı (20×20)","kind":"foot","mount":"end","height":15,"profiles":["sigma-20x20"],"hardware":[],"source":"Prototip görüntüleyici: ayak r14–16, h15 mm. Notion HERO (2025-12-16) daha büyük saplamalı döner ayak yazıyor; bağlantı elemanı standardı gereği M5/M6'ya çevrildi (conflicts.md).","status":{"olcu":"kesin","dis":"varsayım"},"id":"ayar-ayagi","catalog":"accessories"},"ayar-ayagi-40":{"title":"Ayar ayağı, plastik tabanlı, M6 saplı (40×40, diş açılmış uca)","kind":"foot","mount":"end","height":15,"profiles":["sigma-40x40"],"hardware":[],"source":"README: M6 yalnız diş açılmış profil ucunda. Ayak ölçüsü 20×20 ayağından alındı.","status":"varsayım","operations":["Üye ucuna M6 diş açılır"],"id":"ayar-ayagi-40","catalog":"accessories"},"teker-frenli-125":{"title":"Frenli döner teker, plakalı (toplam yükseklik ≈158 mm)","kind":"caster","mount":"face","height":158.5,"plate":[57.2,57.2,4.4],"hardware":[{"item":"M5x10","qty":4},{"item":"@tnut:on","qty":4}],"source":"GLB BorisinTahti: '215x - Tekerlek' ×4, kutu 70×158,5×178,7; plaka 57,2×57,2×4,4","status":{"geometri":"kesin","vida_adedi":"varsayım"},"id":"teker-frenli-125","catalog":"accessories"},"tutamak-polyamid-145":{"title":"Polyamid tutamak 145×46×25","kind":"handle","mount":"face","dims":[145,46,25],"hardware":[{"item":"M5x16","qty":2},{"item":"@tnut:on","qty":2}],"source":"GLB BorisinTahti: 'POLYAMIDE HANDLE' ×2","status":{"geometri":"kesin","vida":"varsayım"},"id":"tutamak-polyamid-145","catalog":"accessories"},"duvar-baglantisi":{"title":"Duvar bağlantı noktası (profil içinden duvar vidası)","kind":"wall","mount":"face","hardware":[{"item":"duvar-vidasi-5x60","qty":1},{"item":"rondela-M5","qty":1}],"source":"Kaynaklarda yok; duvara monte tasarımlar için.","status":"varsayım","id":"duvar-baglantisi","catalog":"accessories"}}};
  var rules = {"settings":{"tolerance_mm":0.5,"kerf_mm":4,"stock_trim_mm":10,"min_piece_mm":40,"length_step_mm":1,"near_duplicate_mm":5,"deflection_ratio":200,"stress_limit_mpa":70,"span_limit_mm":{"sigma-20x20":1200,"sigma-40x40":2400},"cantilever_limit_mm":{"sigma-20x20":200,"sigma-40x40":600},"class_load_limit_kg":150,"hinge":{"two_up_to_mm":400,"pitch_mm":250,"edge_distance_mm":10},"kinematics":{"angle_step_deg":5,"slide_step_mm":25},"tip_ratio":3,"panel_span_mm":{"3":600,"4":600,"12":800,"18":1000,"1.5":600},"unit_sanity_mm":{"min_dimension":100,"max_dimension":6000},"forbidden_patterns":["4\\s*5\\s*[x×X*]\\s*4\\s*5","\\bM\\s*8\\b"],"brand":{"colors":["#E34520","#F1C891","#0e0c0a"],"fonts":["Bebas Neue","DM Sans","DM Mono"]},"panel_stiffness":{"effective_width_span_ratio":0.5,"min_cover_ratio":0.8}},"rules":[{"id":"PRF-01","category":"Profil seçimi","level":"error","check":"auto","fn":"profileWhitelist","rule":"Yalnızca katalogdaki iki kesit kullanılır: sigma 20×20 ve sigma 40×40.","status":"kesin"},{"id":"PRF-02","category":"Profil seçimi","level":"error","check":"auto","fn":"classProfile","rule":"Küçük mobilya (class: kucuk-mobilya) baştan sona 20×20 ile kurulur.","status":"kesin"},{"id":"PRF-03","category":"Profil seçimi","level":"error","check":"auto","fn":"classProfile","rule":"Büyük taşıyıcı tasarımda (class: tasiyici; ör. yatak) yükü taşıyan üyeler (role: tasiyici) 40×40 olur; en az bir taşıyıcı üye işaretlenir. Yük taşımayan ikincil üyeler (ör. yatak başlığı) 20×20 kalabilir.","status":"kesin"},{"id":"PRF-04","category":"Profil seçimi","level":"warn","check":"auto","fn":"classByLoad","rule":"İnsan taşıyan (yatak, bank, ranza) ya da toplam tasarım yükü 150 kg'ı geçen tasarım 'tasiyici' sınıfında olmalıdır.","status":"varsayım"},{"id":"BAG-01","category":"Bağlantı elemanı","level":"error","check":"auto","fn":"fastenerThreads","rule":"Cıvata ve somunlar yalnızca M4 ve M5'tir.","status":"kesin"},{"id":"BAG-02","category":"Bağlantı elemanı","level":"error","check":"auto","fn":"m6OnlyTappedEnd","rule":"M6 yalnızca profile diş açılan yerde kullanılır: 40×40 üyenin ucuna M6 diş açılır, cıvata karşı profildeki geçiş deliğinden girer. T-somunlu M6 yoktur.","status":"kesin"},{"id":"BAG-03","category":"Bağlantı elemanı","level":"error","check":"auto","fn":"catalogOnly","rule":"Katalogda (catalog/*.json) olmayan hiçbir profil, bağlantı parçası, cıvata, panel ya da aksesuar tasarımda ve çıktılarda yer almaz.","status":"kesin"},{"id":"BAG-04","category":"Bağlantı elemanı","level":"error","check":"auto","fn":"forbiddenScan","rule":"Yasak listedeki profil kesiti ve cıvata tipi hiçbir tasarımda, çıktıda, metinde ya da örnekte geçmez.","status":"kesin"},{"id":"BAG-05","category":"Bağlantı elemanı","level":"error","check":"auto","fn":"tnutMatchesSlot","rule":"T-somun profilin kanalına uyar: 20×20 → kanal 6 (M5 ya da M4), 40×40 → kanal 8 (M5).","status":"varsayım"},{"id":"BAG-06","category":"Bağlantı elemanı","level":"info","check":"gozle","fn":null,"rule":"Hiçbir birleşim kaynaklı ya da yapıştırmalı değildir; her şey sökülüp yeniden kurulabilir mekanik bağlantıdır.","status":"kesin"},{"id":"BAG-07","category":"Bağlantı elemanı","level":"info","check":"gozle","fn":null,"rule":"M5 profil birleşimlerinde ve panel sabitlemede kullanılır: görünür bağlantıda M5×10 havşa başlı (DIN 7991) + T-somun, yüzey panelinde M5 havşa başlı. M4 hafif donanımda (ray, mandal) kullanılır.","status":"varsayım"},{"id":"BIR-01","category":"Birleşim","level":"error","check":"solver","fn":"noManualLengths","rule":"Profil boyu elle yazılmaz; solver üyenin konumundan ve uçlarındaki birleşimlerden hesaplar. Alın birleşiminde dayanan üye, dayandığı profilin yüzünde biter (20×20'ye dayanan her uç 20 mm, 40×40'a dayanan 40 mm kısalır).","status":"kesin"},{"id":"BIR-02","category":"Birleşim","level":"error","check":"solver","fn":"corner3Complete","rule":"Üç üyenin buluştuğu 20×20 kutu köşesinde 3 yollu köşe bağlantısı kullanılır: bir üye boydan geçer ve her uçta 5 mm kısa kesilir (dış ölçü − 10), diğer iki üye onun yan yüzüne alından dayanır. Bağlantı tam olarak 1 geçen + 2 dayanan, üçü farklı eksende üye ister.","status":"kesin"},{"id":"BIR-03","category":"Birleşim","level":"info","check":"gozle","fn":null,"rule":"3 yollu köşede boydan geçen üye, o köşedeki derinlik yönündeki (Y) yatay kayıttır: yan yüzün üst ya da alt kirişi. Dikme, ayak ve genişlik yönündeki kayıt ona dayanır. Bu, ayaklı mobilyada da böyledir: ayak üst köşede yan kirişe dayanır, boydan geçmez.","status":"kesin"},{"id":"BIR-04","category":"Birleşim","level":"error","check":"auto","fn":"endsAccounted","rule":"Her üye ucu ya bir birleşime bağlıdır ya da serbesttir ve uç kapağı, ayak ya da başka bir aksesuar taşır. Açıkta kesik profil ucu bırakılmaz.","status":"kesin"},{"id":"BIR-05","category":"Birleşim","level":"error","check":"auto","fn":"noCollision","rule":"Hiçbir iki katı parça iç içe geçmez (üye–üye, üye–panel, panel–panel). Yüzey teması serbesttir; kanal panelinin çevre profillerine girişi ayrıktır.","status":"kesin"},{"id":"BIR-06","category":"Birleşim","level":"error","check":"auto","fn":"connected","rule":"Sabit üyeler tek parça bağlı bir gövde oluşturur. Her hareketli grup (kapı, kanat, çekmece) kendi içinde bağlıdır ve gövdeye bir mekanizmayla (menteşe, ray) bağlanır.","status":"kesin"},{"id":"BIR-07","category":"Birleşim","level":"warn","check":"auto","fn":"buttFullySeated","rule":"Alın birleşiminde dayanan ucun tüm kesiti karşı profilin yüzüne oturur (kısmi oturma olmaz).","status":"kesin"},{"id":"BIR-08","category":"Birleşim","level":"info","check":"gozle","fn":null,"rule":"Alın birleşimi varsayılan olarak gizli bağlantıyla yapılır (gizli-baglanti-20: zamak, setskurlu, dışarıdan görünmez; ayrıca cıvata ya da T-somun gerekmez). Görünür 2 yönlü köşe bağlantısı (kose-braketi-20: 2 × M5×10 havşa başlı + 2 × T-somun) yalnız tasarımcı açıkça istediğinde kullanılır. 3 yollu köşe bağlantısı da setskurludur, ek sabitleme elemanı yoktur.","status":"kesin"},{"id":"BIR-09","category":"Birleşim","level":"warn","check":"auto","fn":"preferTappedEnd40","rule":"40×40 üyeler arası alın birleşimi uca M6 diş açılarak yapılır (uc-disli-M6-40). Köşe braketi (kose-braketi-40) yalnız uca diş açılamayan yerde kullanılır.","status":"kesin"},{"id":"KES-01","category":"Kesim ve üretim","level":"error","check":"auto","fn":"straightCuts","rule":"Tüm profil kesimleri 90°'dir; açılı (gönye) kesim kullanılmaz.","status":"varsayım"},{"id":"KES-02","category":"Kesim ve üretim","level":"error","check":"auto","fn":"lengthRange","rule":"Parça boyu en az 40 mm, en çok stok boyu (6000 mm) olur.","status":"varsayım"},{"id":"KES-03","category":"Kesim ve üretim","level":"warn","check":"auto","fn":"wholeMillimetres","rule":"Kesim boyları tam milimetredir. Küsuratlı çıkan boy için parametreler ya da bölme düzeni değiştirilir.","status":"varsayım"},{"id":"KES-04","category":"Kesim ve üretim","level":"warn","check":"auto","fn":"nearDuplicateLengths","rule":"Aynı işi gören parçalar aynı boyda tasarlanır; birbirine 5 mm'den yakın iki farklı boy bırakılmaz.","status":"varsayım"},{"id":"KES-05","category":"Kesim ve üretim","level":"info","check":"auto","fn":"stockPlan","rule":"Kesim listesi 6000 mm stok boydan yerleşimle verilir: testere payı 4 mm, her stok boyun başında 10 mm temizleme kesimi, en uzun parçadan başlayarak yerleştirme. Fire her boy için ayrı yazılır.","status":"varsayım"},{"id":"KES-06","category":"Kesim ve üretim","level":"info","check":"gozle","fn":null,"rule":"Kesimden sonra uçların çapağı alınır. Uç dişi (M6) ve geçiş deliği gibi işlemler kesim listesinde parçanın satırına işlem olarak yazılır.","status":"kesin"},{"id":"YUK-01","category":"Yük ve sehim","level":"error","check":"auto","fn":"deflection","rule":"Yük tanımlanan her üyede toplam sehim açıklığın 1/200'ünü geçmez (iki ucu mesnetli kabul edilir). Aynı üyedeki yüklerin sehimleri toplanır. Kirişin üstüne vidalanmış yüzey paneli (tabla) varsa panelin eğilme rijitliği kirişinkine eklenir: etkin genişlik, panelin kirişe dik genişliği ile açıklığın yarısından küçük olanıdır.","status":"varsayım"},{"id":"YUK-02","category":"Yük ve sehim","level":"error","check":"auto","fn":"stress","rule":"Toplam eğilme gerilmesi 70 MPa'yı geçmez. Aynı üyedeki yüklerin gerilmeleri toplanır; vidalı panel varsa eğilme momenti profil ile panel arasında rijitlikleri oranında paylaştırılır.","status":"varsayım"},{"id":"YUK-03","category":"Yük ve sehim","level":"warn","check":"auto","fn":"spanLimit","rule":"Yük tanımlanmamış olsa bile desteksiz açıklık 20×20'de 1200 mm'yi, 40×40'ta 2400 mm'yi geçmez.","status":"varsayım"},{"id":"YUK-04","category":"Yük ve sehim","level":"warn","check":"auto","fn":"cantilever","rule":"Yatay konsol (bir ucu serbest) 20×20'de 200 mm'yi, 40×40'ta 600 mm'yi geçmez.","status":"varsayım"},{"id":"YUK-05","category":"Yük ve sehim","level":"warn","check":"auto","fn":"loadsDeclared","rule":"Üstüne yük konan tasarımda (tabla, raf, yatak, çekmece) yükler 'loads' alanında tanımlanır. 'tasiyici' sınıfında yük tanımı zorunludur.","status":"kesin"},{"id":"YUK-06","category":"Yük ve sehim","level":"warn","check":"auto","fn":"tipOver","rule":"Serbest duran mobilyada toplam yükseklik (ayak ya da teker dahil), tabanın dar kenarının 3 katını geçiyorsa duvara sabitlenir.","status":"varsayım"},{"id":"YUK-07","category":"Yük ve sehim","level":"warn","check":"auto","fn":"mechanismCapacity","rule":"Ray ve katlanır konsolun taşıma kapasitesi aşılmaz: hareketli grubun kendi kütlesi + üstündeki tanımlı yük ≤ donanım kapasitesi.","status":"varsayım"},{"id":"YUK-08","category":"Yük ve sehim","level":"info","check":"gozle","fn":null,"rule":"Yük hesapları ve kesit değerleri mühendis onayından geçer; hesabın kaynağı raporda 'hesap' olarak işaretlenir.","status":"kesin"},{"id":"MEK-01","category":"Mekanizma","level":"error","check":"auto","fn":"kinematics","rule":"Hareketli grup, hareket aralığının hiçbir noktasında gövdeye ya da başka bir gruba çarpmaz (menteşede 5°, rayda 25 mm adımlarla denetlenir).","status":"kesin"},{"id":"MEK-02","category":"Mekanizma","level":"error","check":"auto","fn":"hingeCount","rule":"Menteşe adedi: kanadın menteşe ekseni boyunca boyu 400 mm'ye kadar 2; daha uzunsa her 250 mm'ye bir (yukarı yuvarlanır).","status":"varsayım"},{"id":"MEK-03","category":"Mekanizma","level":"error","check":"auto","fn":"hingeOnSharedEdge","rule":"Menteşe ekseni, kanat ile gövdenin bitiştiği kenardadır: eksen çizgisi hem kanadın hem gövdenin bir üyesine en çok 10 mm uzaktadır.","status":"kesin"},{"id":"MEK-04","category":"Mekanizma","level":"error","check":"auto","fn":"slideFit","rule":"Çekmecede ray gövdenin iç yan yüzüne, çekmece iskeletinin dış yan yüzüne oturur: çekmece ile gövde arasında her yanda ray kalınlığı (13 mm) kadar boşluk bırakılır. Ray, gövdede çekmece seviyesinde duran bir yan kayda (profile) bağlanır; panele bağlanmaz. Ray boyu gövde derinliğini geçmez.","status":"kesin"},{"id":"MEK-05","category":"Mekanizma","level":"warn","check":"auto","fn":"slideTravel","rule":"Çekmece açılma yolu rayın açılma boyunu geçmez.","status":"kesin"},{"id":"MEK-06","category":"Mekanizma","level":"warn","check":"auto","fn":"foldingSupport","rule":"Yatay eksende açılan ve üstüne yük konan kanatta (katlanır masa, tezgâh) açık konumda kilitlenen bir destek bulunur: katlanır konsol ya da gazlı amortisör.","status":"varsayım"},{"id":"MEK-07","category":"Mekanizma","level":"info","check":"gozle","fn":null,"rule":"Araçta kullanılan modülde her çekmece ve kapakta yolda açılmayı önleyen kilit ya da mandal bulunur.","status":"kesin"},{"id":"MEK-08","category":"Mekanizma","level":"info","check":"gozle","fn":null,"rule":"Serbest duran çekmeceli mobilyada, dolu çekmece tam açıkken gövdenin öne devrilmediği kontrol edilir: çekmecenin ve yükünün ağırlık merkezi ön ayakların önüne geçiyorsa gövde duvara sabitlenir, tabanı ağırlaştırılır ya da açılma yolu kısaltılır.","status":"varsayım"},{"id":"PNL-01","category":"Paneller","level":"error","check":"auto","fn":"slotThickness","rule":"Kanala giren panel en çok 4 mm (20×20) kalınlıktadır: 3 ya da 4 mm alüminyum kompozit, 4 mm polikarbonat, tel örgü. Daha kalın levha (kontrplak, kompakt) kanala girmez, yüzeye bağlanır.","status":"kesin"},{"id":"PNL-02","category":"Paneller","level":"error","check":"solver","fn":"slotPanelSize","rule":"Kanal paneli ölçüsü = açıklık + iki yandaki kanala giriş payı. Varsayılan giriş her kenarda 5 mm'dir (20×20'de açıklık + 10 mm; 40×40'ta + 22 mm). Ürüne göre bir kenarda 0 ile 7,5 mm arasında değişebilir; o zaman tasarımda panel için 'insert' ile CAD değeri yazılır.","status":"kesin"},{"id":"PNL-03","category":"Paneller","level":"error","check":"auto","fn":"surfacePanelSupported","rule":"Yüzey paneli (tabla, raf, kontrplak) en az iki üyeye oturur ve M5 havşa başlı cıvata + T-somunla sabitlenir; adet verilmezse çevrede 250 mm'de bir, en az 4.","status":"varsayım"},{"id":"PNL-04","category":"Paneller","level":"warn","check":"auto","fn":"panelSpan","rule":"Desteksiz panel kısa kenarı: 3–4 mm kompozit ve tel panelde 600 mm, 12 mm levhada 800 mm, 18 mm tablada 1000 mm'yi geçmez; geçiyorsa ara kayıt eklenir.","status":"varsayım"},{"id":"PNL-05","category":"Paneller","level":"info","check":"auto","fn":"assemblyOrder","rule":"Kanal paneli, onu çevreleyen çerçeve kapanmadan takılır: üç kenar kurulur, panel kaydırılır, dördüncü kenar kapatılır. Montaj sırası bunu gözetir.","status":"kesin"},{"id":"PNL-06","category":"Paneller","level":"info","check":"gozle","fn":null,"rule":"Kanal panelinde titreşimi önlemek için kanal 6 sıkıştırma fitili kullanılır (BOM'a çevre uzunluğu kadar otomatik eklenir). Panel köşesi bir köşe bağlantı parçasına denk geliyorsa köşe çentiklenir.","status":"varsayım"},{"id":"PNL-07","category":"Paneller","level":"error","check":"auto","fn":"panelSheetSize","rule":"Panel kesim ölçüsü, malzemenin tedarik edildiği levha ölçüsünü geçmez (kontrplak 2440 × 1220, kompozit 3200 × 1250). Daha büyük yüzey birden çok panele bölünür ve ek yeri bir kaydın üstüne getirilir.","status":"varsayım"},{"id":"MRK-01","category":"Marka ve çıktı","level":"error","check":"auto","fn":"brandInOutput","rule":"Çıktılarda Chilin paleti (#E34520, #F1C891, #0e0c0a) ve Bebas Neue / DM Sans / DM Mono yazı tipleri kullanılır.","status":"kesin"},{"id":"MRK-02","category":"Marka ve çıktı","level":"error","check":"auto","fn":"singleFileHtml","rule":"3D çıktı Three.js ile, tek dosyalık ve kendi başına açılan bir HTML'dir; içindeki her sayı çözülmüş modelden gelir.","status":"kesin"},{"id":"MRK-03","category":"Marka ve çıktı","level":"warn","check":"auto","fn":"unitsSane","rule":"Tüm ölçüler milimetredir. En büyük dış ölçüsü 100 mm'den küçük ya da 6000 mm'den büyük tasarım birim hatası şüphesiyle uyarılır.","status":"kesin"},{"id":"MRK-04","category":"Marka ve çıktı","level":"info","check":"gozle","fn":null,"rule":"Profil yüzeyi doğal eloksal ya da siyah eloksaldır; bir üründe tek renk kullanılır. Uç kapakları ve bağlantı parçaları siyahtır.","status":"varsayım"},{"id":"ERG-01","category":"Ölçü ve ergonomi","level":"info","check":"gozle","fn":null,"rule":"Hedef yükseklikler: çalışma/yemek masası 750 mm, mutfak tezgâhı 850–900 mm, yatak üstü (şilte dahil) 450–550 mm.","status":"varsayım"},{"id":"ERG-02","category":"Ölçü ve ergonomi","level":"info","check":"gozle","fn":null,"rule":"Camper modül ızgarası kararlaştırılmadı: gerçek çekmece modülü (GLB) 500 × 600 × 200 mm; Notion planı 300/450 × 450–600 × 350 mm; site demosu hücresi 500 × 900 × 320 mm. Yeni modül tasarlanırken ölçü kullanıcıya sorulur.","status":"varsayım"},{"id":"ERG-03","category":"Ölçü ve ergonomi","level":"info","check":"gozle","fn":null,"rule":"Kullanıcı yük vermediyse tipik tasarım yükleri: ayakkabı rafı 15 kg/raf; kitap ve dosya rafı raf metresi başına 40 kg; çalışma masası 60 kg yayılı + ön kenarda 15 kg tekil; mutfak tezgâhı 80 kg; oturma bankı kişi başı 120 kg; yatak kişi başı 120 kg + şilte 30 kg; çekmece 25 kg.","status":"varsayım"}]};
  var solve = __m['engine/solver.js'].solve, validate = __m['engine/validate.js'].validate;
  var cutlist = __m['export/cutlist.js'].cutlist, bom = __m['export/bom.js'].bom, evaluate = __m['engine/expr.js'].evaluate;

  /* Ürün sayfasında müşteriye gösterilen kısa notlar (kural metinleri tasarımcı için yazıldı). Burada olmayan kuralda kural metni gösterilir. */
  var SITE_NOT = {"YUK-01":"Bu ölçüde taşıma hesabı sehim sınırını aşıyor; ara destek gerekir.","YUK-02":"Bu ölçüde taşıma hesabı gerilme sınırını aşıyor; ara destek gerekir.","YUK-03":"Bu ölçüde uzun kirişlerin ortasına ara destek gerekir.","YUK-04":"Bu ölçüde serbest kalan uç fazla uzun; destek gerekir.","YUK-06":"Bu oranda ürün duvara sabitlenmelidir.","PNL-04":"Bu ölçüde panellerin altına ara kayıt gerekir.","PNL-07":"Bu ölçüde panel tek levhadan çıkmaz; ikiye bölünür.","KES-02":"Bu ölçüde bir parça 6 m stok boyunu aşıyor.","KES-03":"Bu ölçüde kesim boyları tam milimetre çıkmıyor; ölçüyü 10 mm'lik adımlarla seç."};

  /** Tasarımı verilen parametrelerle çözer. params: { W: 1200, ... } (tasarımın params alanındaki adlar). */
  function run(design, params) {
    var d = JSON.parse(JSON.stringify(design));
    d.params = d.params || {};
    for (var k in (params || {})) if (Object.prototype.hasOwnProperty.call(d.params, k)) d.params[k] = params[k];
    var s = solve(d, catalog);
    if (!s.ok) return { ok: false, solved: false, issues: s.issues };
    var cut = cutlist(s.model, catalog, rules.settings);
    var b = bom(s.model, catalog, cut);
    var report = validate(s.model, d, catalog, rules, { cutlist: cut });
    var byLen = {};
    cut.rows.forEach(function (r) { var key = r.profile + '|' + r.length; (byLen[key] = byLen[key] || { boyMm: r.length, adet: 0, profil: r.profile }).adet += r.qty; });
    return {
      ok: report.ok, solved: true, model: s.model, cutlist: cut, bom: b, report: report,
      kesim: Object.keys(byLen).map(function (k) { return byLen[k]; }).sort(function (a, c) { return c.boyMm - a.boyMm; }),
      paneller: b.panels.map(function (p) { return { olcu: p.cut[0] + ' × ' + p.cut[1], adet: p.qty, malzeme: p.material }; }),
      toplamMm: cut.totals.length_mm,
      stokBoy: cut.stock.reduce(function (n, x) { return n + x.bar_count; }, 0),
      notlar: report.results.filter(function (x) { return x.status === 'fail' && x.level !== 'info'; })
        .map(function (x) { return { id: x.id, duzey: x.level, kural: x.rule, metin: SITE_NOT[x.id] || null, mesajlar: x.messages.map(function (m) { return m.msg; }) }; })
    };
  }

  /** Site sarmalayıcısı: { harita: { W: 'w', D: 'd', H: 'h' }, tasarim: {...} } ve Özelleştir ölçüleri { w, h, d } (mm). */
  function runSite(wrapper, olcu) {
    var params = {};
    for (var k in wrapper.harita) params[k] = evaluate(wrapper.harita[k], olcu);
    return run(wrapper.tasarim, params);
  }

  g.SigmaEngine = { version: "0.1.0", run: run, runSite: runSite, catalog: catalog, rules: rules };
})(typeof window !== 'undefined' ? window : globalThis);
