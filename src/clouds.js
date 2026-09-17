// ローポリの雲（くぐると、ふわっと散る）
import * as THREE from 'three';
import { Builder, TR } from './build.js';
import { fogged } from './env.js';
import { hash2, mulberry32 } from './util.js';

const CC = 520; // 雲の格子

export class Clouds {
  constructor(scene) {
    this.scene = scene;
    this.mat = fogged(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.3 }));
    this.geos = [];
    const ico = new THREE.IcosahedronGeometry(1, 1);
    for (let v = 0; v < 4; v++) {
      const r = mulberry32(100 + v), b = new Builder(200 + v);
      const n = 5 + v;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5, s = 13 + r() * 12 - Math.abs(t) * 12;
        b.add(ico, '#ffffff', TR(t * 62 + (r() - 0.5) * 8, (r() - 0.35) * 8, (r() - 0.5) * 22, r() * 3, r() * 3, 0, s, s * 0.62, s * 0.85), { vary: 0.02 });
      }
      const g = b.geometry(false);
      g.deleteAttribute('color');
      this.geos.push(g);
    }
    this.cells = new Map();
    this.list = [];
    this.offset = 0;
  }
  update(px, pz, dt, time, env) {
    this.offset += dt * 3;
    const lx = px - this.offset;
    const cx0 = Math.floor(lx / CC), cz0 = Math.floor(pz / CC), R = 3;
    let changed = false;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const key = (cx0 + i) + ',' + (cz0 + j);
      if (this.cells.has(key)) continue;
      const r = mulberry32((hash2(cx0 + i, cz0 + j, 55) * 4294967296) | 0);
      const n = r() < 0.25 ? 0 : r() < 0.6 ? 1 : 2;
      const arr = [];
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(this.geos[Math.floor(r() * 4)], this.mat);
        const sc = 1 + r() * 1.6;
        m.scale.set(sc, sc * (0.8 + r() * 0.3), sc);
        m.rotation.y = r() * 6.28;
        const c = { m, bx: (cx0 + i + r()) * CC, y: 95 + r() * 150, z: (cz0 + j + r()) * CC, rad: 30 * sc, inside: false, wob: 0 };
        m.position.set(c.bx + this.offset, c.y, c.z);
        this.scene.add(m);
        arr.push(c);
      }
      this.cells.set(key, { cx: cx0 + i, cz: cz0 + j, arr });
      changed = true;
    }
    for (const [key, cell] of this.cells) {
      if (Math.abs(cell.cx - cx0) > R + 1 || Math.abs(cell.cz - cz0) > R + 1) {
        for (const c of cell.arr) this.scene.remove(c.m);
        this.cells.delete(key);
        changed = true;
      }
    }
    if (changed) { this.list = []; for (const cell of this.cells.values()) for (const c of cell.arr) this.list.push(c); }
    for (const c of this.list) {
      c.m.position.x = c.bx + this.offset;
      if (c.wob > 0) {
        c.wob = Math.max(0, c.wob - dt * 1.4);
        const w = 1 + Math.sin(c.wob * 14) * 0.12 * c.wob;
        c.m.scale.y = c.baseY * w;
      }
    }
    this.mat.color.copy(env.cur.cloud);
    this.mat.emissive.copy(env.cur.cloud);
    this.mat.emissiveIntensity = 0.32 - env.night * 0.1;
  }
  // 自機が雲に入った瞬間を返す
  check(pos) {
    let entered = null;
    for (const c of this.list) {
      const dx = pos.x - c.m.position.x, dy = (pos.y - c.y) * 1.7, dz = pos.z - c.z;
      const ins = dx * dx + dy * dy + dz * dz < c.rad * c.rad;
      if (ins && !c.inside) { entered = c; if (!c.baseY) c.baseY = c.m.scale.y; c.wob = 1; }
      c.inside = ins;
    }
    return entered;
  }
}
