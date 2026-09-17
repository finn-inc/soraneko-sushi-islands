// お寿司の島々: 島の定義・地形チャンク・海
import * as THREE from 'three';
import { hash2, mulberry32, vnoise, smooth, clamp, lerp } from './util.js';
import { fogShared, glowShared } from './env.js';
import { matSolid, matGlow, nonIndexedPositions } from './build.js';

export const CELL = 600;      // 島を置く格子
export const CHUNK = 300;     // 地形チャンクの一辺
const SEG = 24;               // チャンクの分割数
export const VIEW_CHUNKS = 6; // 視界（チャンク数）
const SEA_FLOOR = -28;

// ネタの種類
export const NETA = ['maguro', 'salmon', 'tamago', 'ebi', 'gunkan', 'green'];
const islandCache = new Map();

export function getIsland(cx, cz) {
  const key = cx + ',' + cz;
  let isl = islandCache.get(key);
  if (isl !== undefined) return isl;
  const r = mulberry32((hash2(cx, cz, 11) * 4294967296) | 0);
  if (r() < 0.2) { islandCache.set(key, null); return null; }
  const a = 150 + r() * 110;
  const b = a * (0.55 + r() * 0.25);
  const rot = r() * Math.PI;
  const tr = r();
  const type = tr < 0.22 ? 'maguro' : tr < 0.46 ? 'salmon' : tr < 0.62 ? 'tamago' : tr < 0.76 ? 'ebi' : tr < 0.87 ? 'gunkan' : 'green';
  isl = {
    cx, cz, a, b, rot, type,
    x: (cx + 0.5) * CELL + (r() - 0.5) * CELL * 0.36,
    z: (cz + 0.5) * CELL + (r() - 0.5) * CELL * 0.36,
    c: Math.cos(rot), s: Math.sin(rot),
    H: type === 'gunkan' ? 44 + r() * 20 : 42 + r() * 52,
    p1: r() * 6.283, p2: r() * 6.283,
    seed: (r() * 1e6) | 0,
  };
  isl.r2max = (isl.a * 1.75) * (isl.a * 1.75);
  islandCache.set(key, isl);
  if (islandCache.size > 4000) islandCache.clear();
  return isl;
}

function profile(d, isl, x, z) {
  if (d >= 1.0) {
    const t = Math.min((d - 1.0) / 0.38, 1);
    return -1 - 27 * smooth(t);
  }
  if (d > 0.84) return -1 + 6.5 * ((1.0 - d) / 0.16);
  if (d > 0.58) {
    const t = (0.84 - d) / 0.26;
    return 5.5 + (isl.H * 0.86 - 5.5) * smooth(t) + vnoise(x / 22, z / 22, 3) * 2.2 * Math.sin(t * Math.PI);
  }
  const t = 1 - d / 0.58;
  const flat = isl.type === 'gunkan' ? 0.05 : 0.14;
  return isl.H * 0.86 + isl.H * flat * (1 - (1 - t) * (1 - t)) + vnoise(x / 46, z / 46, 5) * 3.0 * t + vnoise(x / 17, z / 17, 6) * 1.0;
}

const _s = { h: 0, isl: null, d: 9, u: 0, v: 0 };
export function sampleTerrain(x, z, out = _s) {
  let best = -1e9, bi = null, bd = 9, bu = 0, bv = 0;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const isl = getIsland(cx + i, cz + j);
    if (!isl) continue;
    const ex = x - isl.x, ez = z - isl.z;
    if (ex * ex + ez * ez > isl.r2max) continue;
    const u = ex * isl.c + ez * isl.s, v = -ex * isl.s + ez * isl.c;
    const qx = u / isl.a, qy = v / isl.b;
    const th = Math.atan2(qy, qx);
    const d = Math.hypot(qx, qy) * (1 + 0.08 * Math.sin(3 * th + isl.p1) + 0.05 * Math.sin(5 * th + isl.p2) + 0.03 * Math.sin(9 * th + isl.p1 + isl.p2));
    if (d > 1.4) continue;
    const h = profile(d, isl, x, z);
    if (h > best) { best = h; bi = isl; bd = d; bu = u; bv = v; }
  }
  const floor = SEA_FLOOR + vnoise(x / 130, z / 130, 9) * 2.5;
  if (best < floor) { best = floor; }
  out.h = best; out.isl = bi; out.d = bd; out.u = bu; out.v = bv;
  return out;
}
export function heightAt(x, z) { return sampleTerrain(x, z, _s).h; }
// 当たり判定用の高さ（軍艦の島は、上に敷きつめた いくら の分だけ高い）
export function solidAt(x, z) {
  const s = sampleTerrain(x, z, _s);
  return s.isl && s.isl.type === 'gunkan' && s.d < 0.6 ? s.h + 17 : s.h;
}
// 地面か海面の高いほう
export function surfaceAt(x, z) { return Math.max(solidAt(x, z), 0); }

// ---- 色 ----
const C = (h) => new THREE.Color(h);
const PAL = {
  rice: C('#fffaf0'), riceShade: C('#e9dfcc'), sand: C('#fff4dc'), floorShallow: C('#f2e9c8'), floorDeep: C('#2f8088'),
  nori: C('#1c2a22'), noriHi: C('#2c4232'),
  maguro: C('#c9223a'), maguroHi: C('#e8566a'),
  salmon: C('#ff8440'), salmonHi: C('#ffd9bd'),
  tamago: C('#ffd23f'), tamagoHi: C('#ffe785'),
  ebi: C('#ff6f3c'), ebiHi: C('#fff0e4'),
  ikuraBase: C('#d8481c'),
  green: C('#8fcf58'), greenHi: C('#b8e06a'),
  sakura: C('#ffb3cc'), sakura2: C('#ff8fb6'), leaf: C('#5cae4a'), leaf2: C('#7fc456'), trunk: C('#7a5236'),
  wall: C('#fff6e6'), roofRed: C('#d8412f'), roofBlue: C('#3a6ea8'), roofNori: C('#26382e'), window: C('#ffd27a'),
  ikura: C('#ff6a1e'),
};
const _c = new THREE.Color();
function terrainColor(s, x, z, out) {
  const isl = s.isl, h = s.h;
  if (!isl || h < -0.8) {
    const t = clamp(-h / 24, 0, 1);
    return out.copy(PAL.floorShallow).lerp(PAL.floorDeep, Math.sqrt(t));
  }
  const tamagoBand = isl.type === 'tamago' && Math.abs(s.u) < isl.a * 0.13 && s.d < 0.9 && h > 3.5;
  if (tamagoBand) return out.copy(PAL.nori).lerp(PAL.noriHi, vnoise(x / 9, z / 9, 2) * 0.5 + 0.5);
  if (s.d > 0.84 || h < 5.6) return out.copy(PAL.sand).lerp(PAL.rice, 0.5);
  const top = h > isl.H * 0.63;
  if (!top) {
    if (isl.type === 'gunkan') return out.copy(PAL.nori).lerp(PAL.noriHi, clamp(h / isl.H, 0, 1));
    return out.copy(PAL.riceShade).lerp(PAL.rice, clamp(h / (isl.H * 0.6), 0, 1));
  }
  const u = s.u, v = s.v;
  switch (isl.type) {
    case 'maguro': return out.copy(PAL.maguro).lerp(PAL.maguroHi, Math.sin(u * 0.055 + v * 0.03) > 0.86 ? 0.8 : 0);
    case 'salmon': return out.copy(PAL.salmon).lerp(PAL.salmonHi, Math.sin(u * 0.07 + Math.sin(v * 0.035) * 1.4) > 0.62 ? 0.9 : 0);
    case 'tamago': return out.copy(PAL.tamago).lerp(PAL.tamagoHi, vnoise(x / 30, z / 30, 4) * 0.5 + 0.5);
    case 'ebi': return out.copy(PAL.ebi).lerp(PAL.ebiHi, Math.sin(u * 0.085) > 0.1 ? 0.92 : 0);
    case 'gunkan': return out.copy(PAL.ikuraBase);
    default: return out.copy(PAL.green).lerp(PAL.greenHi, vnoise(x / 40, z / 40, 8) * 0.5 + 0.5);
  }
}

// ---- 木・家のテンプレート ----
const T_ICO = nonIndexedPositions(new THREE.IcosahedronGeometry(1, 0));
const T_TRUNK = nonIndexedPositions(new THREE.CylinderGeometry(0.22, 0.34, 1, 5).translate(0, 0.5, 0));
const T_BOX = nonIndexedPositions(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
const T_ROOF = nonIndexedPositions(new THREE.ConeGeometry(0.82, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0));
const T_SPH = nonIndexedPositions(new THREE.IcosahedronGeometry(1, 1));

function pushT(pos, col, tmpl, sx, sy, sz, ry, tx, ty, tz, color, vary, rnd) {
  const c = Math.cos(ry), s = Math.sin(ry);
  for (let i = 0; i < tmpl.length; i += 9) {
    const f = 1 + (rnd() - 0.5) * 2 * vary;
    for (let k = 0; k < 9; k += 3) {
      const x = tmpl[i + k] * sx, y = tmpl[i + k + 1] * sy, z = tmpl[i + k + 2] * sz;
      pos.push(x * c + z * s + tx, y + ty, -x * s + z * c + tz);
      col.push(color.r * f, color.g * f, color.b * f);
    }
  }
}

function buildChunk(kx, kz) {
  const x0 = kx * CHUNK, z0 = kz * CHUNK, step = CHUNK / SEG, n = SEG + 1;
  const hs = new Float32Array(n * n);
  let maxH = -1e9;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const h = heightAt(x0 + i * step, z0 + j * step);
    hs[j * n + i] = h;
    if (h > maxH) maxH = h;
  }
  if (maxH < -23) return null; // 深い海だけのチャンクは作らない
  const pos = [], col = [], gpos = [], gcol = [];
  const rnd = mulberry32((hash2(kx, kz, 77) * 4294967296) | 0);
  const s = { h: 0, isl: null, d: 9, u: 0, v: 0 };
  const tri = (ax, az, ah, bx, bz, bh, cx, cz, ch) => {
    if (ah < -24 && bh < -24 && ch < -24) return;
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
    sampleTerrain(mx, mz, s);
    s.h = (ah + bh + ch) / 3;
    terrainColor(s, mx, mz, _c);
    const f = 0.95 + rnd() * 0.08;
    pos.push(ax, ah, az, bx, bh, bz, cx, ch, cz);
    for (let k = 0; k < 3; k++) col.push(_c.r * f, _c.g * f, _c.b * f);
  };
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const xa = x0 + i * step, xb = xa + step, za = z0 + j * step, zb = za + step;
    const h00 = hs[j * n + i], h10 = hs[j * n + i + 1], h01 = hs[(j + 1) * n + i], h11 = hs[(j + 1) * n + i + 1];
    if ((i + j) & 1) { tri(xa, za, h00, xa, zb, h01, xb, za, h10); tri(xb, za, h10, xa, zb, h01, xb, zb, h11); }
    else { tri(xa, za, h00, xa, zb, h01, xb, zb, h11); tri(xa, za, h00, xb, zb, h11, xb, za, h10); }
  }
  // 木・家・いくら
  for (let k = 0; k < 46; k++) {
    const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
    sampleTerrain(x, z, s);
    const isl = s.isl;
    if (!isl || s.h < 2) continue;
    const ry = rnd() * 6.283;
    if (s.d < 0.5) {
      if (isl.type === 'gunkan') continue;
      if (isl.type === 'tamago' && Math.abs(s.u) < isl.a * 0.16) continue;
      const village = vnoise(x / 70, z / 70, 21);
      if (village > 0.42) {
        const w = 6 + rnd() * 3, hh = 4.5 + rnd() * 2;
        const roof = rnd() < 0.45 ? PAL.roofRed : rnd() < 0.5 ? PAL.roofBlue : PAL.roofNori;
        pushT(pos, col, T_BOX, w, hh, w * 0.85, ry, x, s.h - 0.5, z, PAL.wall, 0.04, rnd);
        pushT(pos, col, T_ROOF, w * 1.05, hh * 0.85, w * 0.95, ry, x, s.h - 0.5 + hh, z, roof, 0.06, rnd);
        const c = Math.cos(ry), sn = Math.sin(ry);
        pushT(gpos, gcol, T_BOX, 1.8, 1.8, 0.4, ry, x + sn * w * 0.43, s.h + hh * 0.35, z + c * w * 0.43, PAL.window, 0.05, rnd);
        pushT(gpos, gcol, T_BOX, 1.8, 1.8, 0.4, ry, x - sn * w * 0.43, s.h + hh * 0.35, z - c * w * 0.43, PAL.window, 0.05, rnd);
      } else if (rnd() < (isl.type === 'green' ? 0.85 : 0.5)) {
        const sc = 1 + rnd() * 0.9;
        const pink = isl.type === 'green' ? rnd() < 0.3 : rnd() < 0.8;
        const c1 = pink ? PAL.sakura : PAL.leaf, c2 = pink ? PAL.sakura2 : PAL.leaf2;
        pushT(pos, col, T_TRUNK, 3 * sc, 7 * sc, 3 * sc, ry, x, s.h - 0.5, z, PAL.trunk, 0.08, rnd);
        pushT(pos, col, T_ICO, 4.6 * sc, 3.8 * sc, 4.6 * sc, ry, x, s.h + 8.5 * sc, z, c1, 0.08, rnd);
        pushT(pos, col, T_ICO, 3.2 * sc, 2.8 * sc, 3.2 * sc, ry + 1, x + 2.2 * sc, s.h + 11 * sc, z + 1.2 * sc, c2, 0.08, rnd);
      }
    } else if (s.d > 0.86 && s.d < 0.96 && rnd() < 0.5) {
      const sc = 0.8 + rnd() * 0.7;
      pushT(pos, col, T_ICO, 3.4 * sc, 2.4 * sc, 3.4 * sc, ry, x, s.h + 1.2 * sc, z, rnd() < 0.5 ? PAL.leaf : PAL.leaf2, 0.08, rnd);
    }
  }
  // 軍艦の島: いくらを敷きつめる
  const cx = Math.floor((x0 + CHUNK / 2) / CELL), cz = Math.floor((z0 + CHUNK / 2) / CELL);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const isl = getIsland(cx + i, cz + j);
    if (!isl || isl.type !== 'gunkan') continue;
    const sp = 21;
    const ir = mulberry32(isl.seed);
    for (let v = -isl.b; v <= isl.b; v += sp * 0.87) {
      const row = Math.round(v / (sp * 0.87));
      for (let u = -isl.a; u <= isl.a; u += sp) {
        const uu = u + (row & 1 ? sp / 2 : 0) + (ir() - 0.5) * 5, vv = v + (ir() - 0.5) * 5;
        const rad = 9.5 + ir() * 3.5;
        const wx = isl.x + uu * isl.c - vv * isl.s, wz = isl.z + uu * isl.s + vv * isl.c;
        if (wx < x0 || wx >= x0 + CHUNK || wz < z0 || wz >= z0 + CHUNK) continue;
        sampleTerrain(wx, wz, s);
        if (s.isl !== isl || s.d > 0.55) continue;
        pushT(gpos, gcol, T_SPH, rad, rad, rad, ir() * 6, wx, s.h + rad * 0.45, wz, PAL.ikura, 0.1, rnd);
      }
    }
  }
  const group = new THREE.Group();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  group.add(new THREE.Mesh(g, matSolid));
  if (gpos.length) {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gpos), 3));
    gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(gcol), 3));
    gg.computeBoundingSphere();
    group.add(new THREE.Mesh(gg, matGlow));
  }
  return group;
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
  }
  update(px, pz, budget = 1) {
    const kx0 = Math.floor(px / CHUNK), kz0 = Math.floor(pz / CHUNK), R = VIEW_CHUNKS;
    const want = [];
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const d2 = i * i + j * j;
      if (d2 > (R + 0.5) * (R + 0.5)) continue;
      const key = (kx0 + i) + ',' + (kz0 + j);
      if (!this.chunks.has(key)) want.push([d2, kx0 + i, kz0 + j, key]);
    }
    if (want.length) {
      want.sort((a, b) => a[0] - b[0]);
      const t0 = performance.now();
      let made = 0;
      for (const w of want) {
        const grp = buildChunk(w[1], w[2]);
        if (grp) this.scene.add(grp);
        this.chunks.set(w[3], { grp, kx: w[1], kz: w[2] });
        made++;
        if (budget !== Infinity && (made >= budget || performance.now() - t0 > 5)) break;
      }
    }
    for (const [key, ch] of this.chunks) {
      const dx = ch.kx - kx0, dz = ch.kz - kz0;
      if (dx * dx + dz * dz > (R + 2) * (R + 2)) {
        if (ch.grp) {
          this.scene.remove(ch.grp);
          for (const m of ch.grp.children) m.geometry.dispose();
        }
        this.chunks.delete(key);
      }
    }
  }
}

// ---- 海 ----
const N_ISL = 25;
const waterVert = /* glsl */ `
uniform float uTime; uniform vec2 uCenter;
varying vec3 vWorld; varying vec3 vView;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = length(wp.xz - uCenter);
  float amp = 1.0 - smoothstep(420.0, 760.0, dist);
  float w = sin(wp.x * 0.045 + uTime * 1.1) * 0.55 + sin(wp.z * 0.06 - uTime * 0.9) * 0.45 + sin((wp.x + wp.z) * 0.021 + uTime * 0.6) * 0.8;
  wp.y += w * amp;
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const waterFrag = /* glsl */ `
uniform float uTime; uniform vec2 uCenter; uniform float uIsFar; uniform float uNearHalf;
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uRefl; uniform vec3 uLightDir; uniform vec3 uLightCol;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform vec3 uFogSunView; uniform vec3 uFogGlow;
uniform vec4 uIslA[${N_ISL}]; uniform vec4 uIslB[${N_ISL}];
varying vec3 vWorld; varying vec3 vView;
void main(){
  if (uIsFar > 0.5 && max(abs(vWorld.x - uCenter.x), abs(vWorld.z - uCenter.y)) < uNearHalf - 2.0) discard;
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (N.y < 0.0) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float shallow = 0.0; float foam = 0.0;
  for (int i = 0; i < ${N_ISL}; i++) {
    vec4 A = uIslA[i];
    if (A.z < 1.0) continue;
    vec2 dl = vWorld.xz - A.xy;
    float lim = A.z * 1.75;
    if (dot(dl, dl) > lim * lim) continue;
    vec4 B = uIslB[i];
    float u = dl.x * B.x + dl.y * B.y;
    float v = -dl.x * B.y + dl.y * B.x;
    vec2 q = vec2(u / A.z, v / A.w);
    float th = atan(q.y, q.x);
    float d = length(q) * (1.0 + 0.08 * sin(3.0 * th + B.z) + 0.05 * sin(5.0 * th + B.w) + 0.03 * sin(9.0 * th + B.z + B.w));
    shallow = max(shallow, 1.0 - smoothstep(0.98, 1.4, d));
    float wob = sin(uTime * 0.9 + th * 9.0) * 0.012;
    float f1 = (1.0 - smoothstep(1.005 + wob, 1.04 + wob, d)) * step(0.9, d);
    float ph = fract(uTime * 0.11 + th * 0.35);
    float r2 = 1.04 + ph * 0.1;
    float f2 = (1.0 - smoothstep(0.0, 0.012, abs(d - r2))) * (1.0 - ph) * 0.7;
    foam = max(foam, max(f1, f2));
  }
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = mix(uDeep, uShallow, shallow * 0.9);
  float diff = dot(N, normalize(uLightDir + vec3(0.0, 0.8, 0.0)));
  col *= mix(0.82, 1.1, clamp(diff, 0.0, 1.0));
  col = mix(col, uRefl, clamp(fres * 0.75 + 0.06, 0.0, 1.0));
  vec3 R = reflect(-V, N);
  float spec = pow(max(dot(R, uLightDir), 0.0), 90.0);
  col += uLightCol * spec * 1.1;
  col = mix(col, mix(vec3(1.0), uRefl, 0.25) * (0.55 + 0.45 * clamp(uLightCol.g * 1.2, 0.0, 1.0)), foam);
  float alpha = mix(0.9, 0.62, shallow);
  alpha = max(alpha, foam);
  alpha = max(alpha, fres);
  float fogFactor = smoothstep(uFogNear, uFogFar, -vView.z);
  float sd = max(dot(normalize(vView), uFogSunView), 0.0);
  vec3 fc = uFogColor + uFogGlow * (pow(sd, 6.0) * 0.5 + pow(sd, 40.0) * 0.35);
  col = mix(col, fc, fogFactor);
  alpha = mix(alpha, 1.0, fogFactor);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Water {
  constructor(scene) {
    const islA = [], islB = [];
    for (let i = 0; i < N_ISL; i++) { islA.push(new THREE.Vector4()); islB.push(new THREE.Vector4()); }
    this.islA = islA; this.islB = islB;
    this.cell = 16;
    const half = 800;
    const shared = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector2() }, uNearHalf: { value: half },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uRefl: { value: new THREE.Color() },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightCol: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() }, uFogNear: { value: 1 }, uFogFar: { value: 2 },
      uFogSunView: fogShared.uFogSunView, uFogGlow: fogShared.uFogGlow,
      uIslA: { value: islA }, uIslB: { value: islB },
    };
    this.u = shared;
    const mk = (far) => new THREE.ShaderMaterial({
      uniforms: { ...shared, uIsFar: { value: far } }, vertexShader: waterVert, fragmentShader: waterFrag,
      transparent: true, depthWrite: false, fog: false,
    });
    const near = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2, (half * 2) / this.cell, (half * 2) / this.cell).rotateX(-Math.PI / 2), mk(0));
    const far = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000, 8, 8).rotateX(-Math.PI / 2), mk(1));
    for (const m of [near, far]) { m.frustumCulled = false; m.renderOrder = -5; scene.add(m); }
    this.near = near; this.far = far;
    // 海の底（チャンクの無い所を埋める）
    this.abyssMat = new THREE.MeshBasicMaterial({ color: 0x0 });
    this.abyssMat.onBeforeCompile = (sh) => { sh.uniforms.uFogSunView = fogShared.uFogSunView; sh.uniforms.uFogGlow = fogShared.uFogGlow; };
    this.abyss = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), this.abyssMat);
    this.abyss.position.y = -40;
    this.abyss.frustumCulled = false;
    scene.add(this.abyss);
    this.lastCell = null;
  }
  update(px, pz, time, env, fog) {
    const c = this.cell;
    const sx = Math.round(px / c) * c, sz = Math.round(pz / c) * c;
    this.near.position.set(sx, 0, sz);
    this.far.position.set(sx, -0.05, sz);
    this.abyss.position.set(sx, -40, sz);
    const u = this.u;
    u.uTime.value = time;
    u.uCenter.value.set(sx, sz);
    u.uDeep.value.copy(env.cur.deep); u.uShallow.value.copy(env.cur.shal); u.uRefl.value.copy(env.cur.refl);
    u.uLightDir.value.copy(env.lightDir); u.uLightCol.value.copy(env.cur.light).multiplyScalar(env.sunLight.intensity / 2.6);
    u.uFogColor.value.copy(fog.color); u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
    this.abyssMat.color.copy(env.cur.deep).multiplyScalar(0.7);
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    const key = cx + ',' + cz;
    if (key !== this.lastCell) {
      this.lastCell = key;
      let n = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        const isl = getIsland(cx + i, cz + j);
        if (isl) { this.islA[n].set(isl.x, isl.z, isl.a, isl.b); this.islB[n].set(isl.c, isl.s, isl.p1, isl.p2); }
        else this.islA[n].set(0, 0, 0, 0);
        n++;
      }
    }
  }
}
