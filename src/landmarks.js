// 巨大なお寿司のランドマーク（すべてプリミティブの組み合わせ）
import * as THREE from 'three';
import { Builder, TR, deform, meshesFrom } from './build.js';
import { hash2, mulberry32 } from './util.js';
import { CELL, getIsland, heightAt } from './world.js';

const COL = {
  rice: '#fffaf0', nori: '#1c2a22', maguro: '#c9223a', maguroHi: '#e8566a', salmon: '#ff8440', salmonHi: '#ffe0c8',
  tamago: '#ffd23f', ebi: '#ff6f3c', ebiHi: '#fff0e4', ebiTail: '#e8412a', ikura: '#ff6a1e', cucumber: '#7fc456',
  wood: '#c8975a', woodDark: '#a87a44', gari: '#ffb7c9', wasabi: '#9ccc5a', leaf: '#3f9a4a',
  lacquer: '#b8281f', black: '#1d1d1f', gold: '#e8b84a', soy: '#3b1d12', glass: '#d6e6e0', cap: '#d8261c',
  ceramic: '#35587a', ceramicBand: '#f2efe6', tea: '#a8c64a', belt: '#8f989c', beacon: '#ffcf6a', lantern: '#ff5a36',
  fishBody: '#f7efe0', fishSoy: '#6e3218',
};

// ---- 部品 ----
function addNigiri(b, parent, type, L = 70) {
  const W = L * 0.48, rad = W / 2;
  const rice = new THREE.CapsuleGeometry(rad, L - W, 3, 8).rotateZ(Math.PI / 2);
  b.add(rice, COL.rice, TR(0, rad * 0.78, 0, 0, 0, 0, 1, 0.78, 1), { parent, vary: 0.07 });
  const topY = rad * 1.56;
  const thick = type === 'tamago' ? L * 0.15 : L * 0.085;
  const sl = L * 1.16, sw = W * 1.16;
  const slab = deform(new THREE.BoxGeometry(sl, thick, sw, 8, 1, 3), (v) => {
    const droop = type === 'tamago' ? 0.05 : 0.15;
    v.y -= L * droop * Math.pow(v.x / (sl / 2), 2) + L * 0.05 * Math.pow(v.z / (sw / 2), 2);
  });
  let cf;
  if (type === 'maguro') cf = (x, y, z) => (Math.sin(x * 0.35 + z * 0.22) > 0.8 ? COL.maguroHi : COL.maguro);
  else if (type === 'salmon') cf = (x, y, z) => (Math.sin((x + z * 0.6) * (22 / L)) > 0.45 ? COL.salmonHi : COL.salmon);
  else if (type === 'ebi') cf = (x) => (Math.sin(x * (26 / L)) > 0 ? COL.ebiHi : COL.ebi);
  else cf = COL.tamago;
  b.add(slab, cf, TR(0, topY + thick * 0.4, 0), { parent, vary: 0.05 });
  if (type === 'tamago') {
    b.add(new THREE.BoxGeometry(L * 0.14, topY + thick * 1.5, sw * 1.04), COL.nori, TR(0, (topY + thick * 1.5) / 2 - 0.5, 0), { parent, vary: 0.1 });
  }
  if (type === 'ebi') {
    for (const s of [-1, 1]) {
      const tail = new THREE.ConeGeometry(L * 0.13, L * 0.3, 4);
      b.add(tail, COL.ebiTail, TR(sl / 2 + L * 0.06, topY - L * 0.04, s * L * 0.08, 0, s * 0.45, Math.PI / 2 + 0.25, 1, 1, 0.3), { parent });
    }
  }
}

function addRoll(b, parent, R, H, fill) {
  b.add(new THREE.CylinderGeometry(R, R, H, 14), COL.nori, null, { parent, vary: 0.12 });
  b.add(new THREE.CylinderGeometry(R * 0.9, R * 0.9, H + 1.6, 14), COL.rice, null, { parent, vary: 0.07 });
  b.add(new THREE.CylinderGeometry(R * 0.4, R * 0.4, H + 3, 8), fill, null, { parent, vary: 0.06 });
}

// ---- 各ランドマークの原型 ----
const protoCache = new Map();
function proto(name, make) {
  let p = protoCache.get(name);
  if (!p) { p = make(); p.name = name; protoCache.set(name, p); }
  return p;
}

function makeNigiriGeta() {
  const b = new Builder(3);
  b.add(new THREE.BoxGeometry(190, 9, 100), COL.wood, TR(0, 26, 0), { vary: 0.05 });
  for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(14, 32, 100), COL.woodDark, TR(s * 62, 8, 0));
  const top = 30.5;
  addNigiri(b, TR(-58, top, 4, 0, 0.5, 0), 'maguro', 58);
  addNigiri(b, TR(0, top, 0, 0, 0.5, 0), 'tamago', 58);
  addNigiri(b, TR(58, top, -4, 0, 0.5, 0), 'ebi', 58);
  const ico = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 6; i++) b.add(ico, COL.gari, TR(78 + Math.cos(i * 1.1) * 7, top + 2 + i * 1.3, -36 + Math.sin(i * 1.7) * 6, 0, i, 0, 9 - i * 0.7, 3, 8 - i * 0.6));
  b.add(new THREE.ConeGeometry(9, 13, 6), COL.wasabi, TR(-82, top + 6.5, -36));
  for (let i = 0; i < 5; i++) b.add(new THREE.ConeGeometry(7, 22, 4), COL.leaf, TR(-52 + i * 9, top + 11, -44, 0, 0, 0, 1, 1, 0.12));
  return { built: b.build(), colliders: [{ a: [-72, 34, 0], b: [72, 34, 0], r: 44 }] };
}

function makeMakiTower() {
  const b = new Builder(5);
  addRoll(b, TR(0, 14, 0), 42, 34, COL.maguro);
  addRoll(b, TR(5, 46, -3, 0, 0.4, 0.05), 34, 30, COL.cucumber);
  addRoll(b, TR(3, 86, 0, Math.PI / 2, 0.5, 0), 25, 30, COL.tamago);
  return { built: b.build(), colliders: [{ a: [0, 0, 0], b: [0, 50, 0], r: 42 }, { a: [3, 86, 0], b: [3, 86, 0], r: 27 }] };
}

function makeGunkan() {
  const b = new Builder(7);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 16);
  b.add(cyl, COL.nori, TR(0, 17, 0, 0, 0, 0, 52, 40, 36), { vary: 0.12 });
  b.add(cyl, COL.rice, TR(0, 17.6, 0, 0, 0, 0, 48, 40, 32));
  const sph = new THREE.IcosahedronGeometry(1, 1);
  const r = mulberry32(12);
  for (let v = -24; v <= 24; v += 12.5) {
    const row = Math.round(v / 12.5);
    for (let u = -40; u <= 40; u += 14) {
      const uu = u + (row & 1 ? 7 : 0);
      if ((uu * uu) / (44 * 44) + (v * v) / (28 * 28) > 1) continue;
      if (uu > 22) continue;
      const rad = 7.6 + r() * 1.8;
      b.add(sph, COL.ikura, TR(uu + (r() - 0.5) * 3, 40 + r() * 3, v + (r() - 0.5) * 3, r() * 3, r() * 3, 0, rad), { glow: true, vary: 0.12 });
    }
  }
  for (let i = 0; i < 3; i++) b.add(new THREE.CylinderGeometry(17, 17, 2.4, 12), (x, y, z) => (x * x + z * z < 150 ? '#d8eeb0' : COL.cucumber), TR(30 + i * 5, 46, -6 + i * 7, Math.PI / 2 - 0.35, 0.5, 0));
  return { built: b.build(), colliders: [{ a: [-20, 18, 0], b: [20, 18, 0], r: 38 }] };
}

function makeChopsticks() {
  const b = new Builder(9);
  const L = 260, th = 0.367;
  const stick = new THREE.CylinderGeometry(3.2, 6.8, L, 4).rotateY(Math.PI / 4).translate(0, L / 2, 0);
  const cf = (x, y) => (y > L * 0.84 ? COL.black : y > L * 0.815 ? COL.gold : COL.lacquer);
  const colliders = [];
  for (const s of [-1, 1]) {
    b.add(stick, cf, TR(s * 70, -8, s * 6, 0, 0, s * th), { vary: 0.05 });
    colliders.push({ a: [s * 70, -8, s * 6], b: [s * 70 - s * Math.sin(th) * L, -8 + Math.cos(th) * L, s * 6], r: 8 });
  }
  addRoll(b, TR(0, 172, 0, Math.PI / 2, 0, 0), 20, 22, COL.salmon);
  colliders.push({ a: [0, 172, 0], b: [0, 172, 0], r: 22 });
  return { built: b.build(), colliders };
}

function makeSoyBottle() {
  const b = new Builder(11);
  b.add(new THREE.CylinderGeometry(30, 34, 56, 12), COL.soy, TR(0, 25, 0), { vary: 0.1 });
  b.add(new THREE.CylinderGeometry(13, 30, 40, 12), (x, y) => (y < -8 ? COL.soy : COL.glass), TR(0, 73, 0), { vary: 0.05 });
  b.add(new THREE.CylinderGeometry(13, 13, 8, 12), COL.glass, TR(0, 97, 0));
  b.add(new THREE.CylinderGeometry(18, 18, 14, 12), COL.cap, TR(0, 108, 0));
  b.add(new THREE.CylinderGeometry(10, 18, 6, 12), COL.cap, TR(0, 118, 0));
  for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(3, 3.6, 10, 6), COL.cap, TR(s * 21, 109, 0, 0, 0, Math.PI / 2));
  b.add(new THREE.BoxGeometry(32, 26, 3), '#fffdf6', TR(0, 28, 32.5, -0.07, 0, 0));
  b.add(new THREE.CylinderGeometry(8, 8, 1, 12), COL.cap, TR(0, 28, 34.3, Math.PI / 2 - 0.07, 0, 0));
  b.add(new THREE.IcosahedronGeometry(6, 1), COL.beacon, TR(0, 126, 0), { glow: true });
  return { built: b.build(), colliders: [{ a: [0, 0, 0], b: [0, 100, 0], r: 34 }] };
}

function makeYunomi() {
  const b = new Builder(13);
  b.add(new THREE.CylinderGeometry(44, 34, 66, 14), COL.ceramic, TR(0, 30, 0), { vary: 0.07 });
  b.add(new THREE.CylinderGeometry(42.4, 41.2, 8, 14), COL.ceramicBand, TR(0, 44, 0));
  b.add(new THREE.CylinderGeometry(38.4, 37.4, 5, 14), COL.ceramicBand, TR(0, 18, 0));
  b.add(new THREE.CylinderGeometry(41.5, 41.5, 1.4, 14), COL.tea, TR(0, 63.2, 0), { vary: 0.03 });
  b.add(new THREE.TorusGeometry(43, 2, 5, 14).rotateX(Math.PI / 2), COL.ceramic, TR(0, 63.4, 0));
  // 茶柱
  b.add(new THREE.CylinderGeometry(0.9, 0.9, 9, 5), '#6f8a2a', TR(6, 66, -4, 0.25, 0.3, 0.1));
  return { built: b.build(), colliders: [{ a: [0, 0, 0], b: [0, 46, 0], r: 44 }], steam: [0, 68, 0] };
}

function makeFishBlimp() {
  const b = new Builder(17);
  b.add(new THREE.SphereGeometry(1, 10, 8), (x, y) => (y < -0.3 ? COL.fishSoy : COL.fishBody), TR(0, 0, 0, 0, 0, 0, 32, 17, 12), { vary: 0.05 });
  b.add(new THREE.ConeGeometry(15, 20, 4), COL.fishBody, TR(-38, 0, 0, 0, 0, -Math.PI / 2, 1, 1, 0.22));
  b.add(new THREE.ConeGeometry(7, 10, 4), COL.fishBody, TR(-2, 17, 0, 0, 0, 0.5, 1, 1, 0.22));
  b.add(new THREE.CylinderGeometry(5, 5.5, 8, 8), COL.cap, TR(33, 0, 0, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) b.add(new THREE.IcosahedronGeometry(2.4, 0), COL.black, TR(19, 5, s * 9.6));
  return { built: b.build(), colliders: [{ a: [-22, 0, 0], b: [22, 0, 0], r: 17 }], bob: true };
}

function makeLanterns() {
  const b = new Builder(19);
  const r = mulberry32(5);
  for (let i = 0; i < 8; i++) {
    const x = (r() - 0.5) * 120, z = (r() - 0.5) * 120, y = r() * 55, s = 0.8 + r() * 0.7;
    const P = TR(x, y, z, 0, 0, 0, s);
    b.add(new THREE.SphereGeometry(1, 8, 6), COL.lantern, TR(0, 0, 0, 0, 0, 0, 6, 7.4, 6), { parent: P, glow: true, vary: 0.1 });
    b.add(new THREE.CylinderGeometry(3, 3, 1.6, 8), COL.black, TR(0, 7.4, 0), { parent: P });
    b.add(new THREE.CylinderGeometry(3, 3, 1.6, 8), COL.black, TR(0, -7.4, 0), { parent: P });
    b.add(new THREE.BoxGeometry(0.8, 5, 0.8), COL.gold, TR(0, -10.5, 0), { parent: P });
  }
  return { built: b.build(), colliders: [], bob: true };
}

const PLATE_COLORS = ['#f2c14e', '#d8412f', '#3a6ea8', '#5cae4a', '#ffffff'];
function makeKaiten(R) {
  const belt = new Builder(23);
  belt.add(new THREE.TorusGeometry(R, 10, 4, 72).rotateX(Math.PI / 2), COL.belt, TR(0, 0, 0, 0, 0, 0, 1, 0.22, 1), { vary: 0.04 });
  belt.add(new THREE.TorusGeometry(R - 11, 1.4, 4, 72).rotateX(Math.PI / 2), '#e6e9ea', TR(0, 2.6, 0));
  belt.add(new THREE.TorusGeometry(R + 11, 1.4, 4, 72).rotateX(Math.PI / 2), '#e6e9ea', TR(0, 2.6, 0));
  const plates = new Builder(29);
  const n = Math.floor((Math.PI * 2 * R) / 58);
  const kinds = ['maguro', 'salmon', 'tamago', 'ebi'];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const P = TR(Math.cos(a) * R, 2.4, Math.sin(a) * R, 0, -a, 0);
    plates.add(new THREE.CylinderGeometry(12, 8.5, 2.4, 10), PLATE_COLORS[i % PLATE_COLORS.length], TR(0, 1.2, 0), { parent: P, vary: 0.04 });
    if (i % 3 === 2) {
      addRoll(plates, new THREE.Matrix4().multiplyMatrices(P, TR(-5, 5.9, 0)), 4.6, 7, COL.cucumber);
      addRoll(plates, new THREE.Matrix4().multiplyMatrices(P, TR(5, 5.9, 0)), 4.6, 7, COL.maguro);
    } else {
      addNigiri(plates, new THREE.Matrix4().multiplyMatrices(P, TR(0, 2.4, 0, 0, 0.6, 0)), kinds[i % 4], 17);
    }
  }
  return { built: belt.build(), plates: plates.build(), colliders: [] };
}

const MAKERS = {
  nigiriGeta: makeNigiriGeta, makiTower: makeMakiTower, gunkan: makeGunkan, chopsticks: makeChopsticks,
  soyBottle: makeSoyBottle, yunomi: makeYunomi, fishBlimp: makeFishBlimp, lanterns: makeLanterns,
};
export const LANDMARK_TYPES = [...Object.keys(MAKERS), 'kaiten'];

// ---- 配置（格子ごとに決定的） ----
function planCell(cx, cz) {
  const r = mulberry32((hash2(cx, cz, 31) * 4294967296) | 0);
  const items = [];
  const isl = getIsland(cx, cz);
  if (isl) {
    const top = heightAt(isl.x, isl.z);
    const roll = r();
    if (isl.type !== 'gunkan') {
      if (roll < 0.3) items.push({ type: 'makiTower', x: isl.x, y: top - 3, z: isl.z, ry: r() * 6.28, s: 0.85 });
      else if (roll < 0.58) items.push({ type: 'soyBottle', x: isl.x, y: top - 3, z: isl.z, ry: r() * 6.28, s: 0.95 });
    }
    if (r() < 0.42) items.push({ type: 'kaiten', x: isl.x, y: top + 34, z: isl.z, ry: 0, s: 1, R: Math.round((isl.a + 50) / 20) * 20 });
    if (r() < 0.65) {
      const a = r() * 6.28;
      items.push({ type: 'lanterns', x: isl.x + Math.cos(a) * isl.b * 0.3, y: top + 30, z: isl.z + Math.sin(a) * isl.b * 0.3, ry: r() * 6.28, s: 1 });
    }
  }
  const seaTypes = ['nigiriGeta', 'chopsticks', 'yunomi', 'gunkan', 'makiTower', 'chopsticks', 'nigiriGeta'];
  const spots = [[cx * CELL, cz * CELL, 0.8], [(cx + 0.5) * CELL, cz * CELL, 0.3], [cx * CELL, (cz + 0.5) * CELL, 0.3]];
  for (const [bx, bz, prob] of spots) {
    const x = bx + (r() - 0.5) * 220, z = bz + (r() - 0.5) * 220, pick = r(), ry = r() * 6.28, ok = r() < prob;
    if (!ok || (Math.abs(x) < 200 && Math.abs(z) < 200)) continue;
    let deep = true;
    for (let k = 0; k < 8 && deep; k++) if (heightAt(x + Math.cos(k * 0.785) * 95, z + Math.sin(k * 0.785) * 95) > -14) deep = false;
    if (!deep) continue;
    items.push({ type: seaTypes[Math.floor(pick * seaTypes.length)], x, y: 0, z, ry, s: 1 });
  }
  if (r() < 0.38) items.push({ type: 'fishBlimp', x: (cx + r()) * CELL, y: 130 + r() * 70, z: (cz + r()) * CELL, ry: r() * 6.28, s: 1 + r() * 0.5 });
  return items;
}

export class Landmarks {
  constructor(scene) {
    this.scene = scene;
    this.cells = new Map();
    this.colliders = [];
    this.steams = [];
    this.animated = [];
    this.R = 3;
  }
  _spawn(it) {
    const p = it.type === 'kaiten' ? proto('kaiten' + it.R, () => makeKaiten(it.R)) : proto(it.type, MAKERS[it.type]);
    const g = meshesFrom(p.built);
    g.position.set(it.x, it.y, it.z);
    g.rotation.y = it.ry;
    g.scale.setScalar(it.s);
    const inst = { g, colliders: [], steam: null, anim: null };
    if (p.plates) {
      const spin = meshesFrom(p.plates);
      g.add(spin);
      inst.anim = { kind: 'spin', obj: spin };
    }
    if (p.bob) inst.anim = { kind: 'bob', obj: g, y0: it.y, ph: it.x * 0.01 };
    g.updateMatrixWorld(true);
    const va = new THREE.Vector3(), vb = new THREE.Vector3();
    for (const c of p.colliders) {
      va.fromArray(c.a).applyMatrix4(g.matrixWorld);
      vb.fromArray(c.b).applyMatrix4(g.matrixWorld);
      inst.colliders.push({ ax: va.x, ay: va.y, az: va.z, bx: vb.x, by: vb.y, bz: vb.z, r: c.r * it.s });
    }
    if (p.steam) inst.steam = new THREE.Vector3().fromArray(p.steam).applyMatrix4(g.matrixWorld);
    this.scene.add(g);
    return inst;
  }
  update(px, pz, time, budget = 1) {
    const cx0 = Math.floor(px / CELL), cz0 = Math.floor(pz / CELL), R = this.R;
    let changed = false, made = 0;
    for (let j = -R; j <= R && made < budget; j++) for (let i = -R; i <= R && made < budget; i++) {
      const key = (cx0 + i) + ',' + (cz0 + j);
      if (this.cells.has(key)) continue;
      const insts = planCell(cx0 + i, cz0 + j).map((it) => this._spawn(it));
      this.cells.set(key, { cx: cx0 + i, cz: cz0 + j, insts });
      changed = true; made++;
    }
    for (const [key, cell] of this.cells) {
      if (Math.abs(cell.cx - cx0) > R + 1 || Math.abs(cell.cz - cz0) > R + 1) {
        for (const inst of cell.insts) this.scene.remove(inst.g);
        this.cells.delete(key);
        changed = true;
      }
    }
    if (changed) {
      this.colliders = []; this.steams = []; this.animated = [];
      for (const cell of this.cells.values()) for (const inst of cell.insts) {
        for (const c of inst.colliders) this.colliders.push(c);
        if (inst.steam) this.steams.push(inst.steam);
        if (inst.anim) this.animated.push(inst.anim);
      }
    }
    for (const a of this.animated) {
      if (a.kind === 'spin') a.obj.rotation.y = time * 0.06;
      else a.obj.position.y = a.y0 + Math.sin(time * 0.5 + a.ph) * 4;
    }
  }
  prewarm(px, pz) { this.update(px, pz, 0, Infinity); }
}

// 点とカプセルの最近点。out に最近点、戻り値は距離
export function capsuleDist(c, x, y, z, out) {
  const dx = c.bx - c.ax, dy = c.by - c.ay, dz = c.bz - c.az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((x - c.ax) * dx + (y - c.ay) * dy + (z - c.az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.set(c.ax + dx * t, c.ay + dy * t, c.az + dz * t);
  return Math.hypot(x - out.x, y - out.y, z - out.z);
}
