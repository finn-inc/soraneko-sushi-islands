// 巻き寿司のリングと、前方へ引き直され続ける道筋
import * as THREE from 'three';
import { Builder, TR } from './build.js';
import { fogged } from './env.js';
import { clamp, noise1, wrapAngle, lerp } from './util.js';
import { surfaceAt } from './world.js';
import { capsuleDist } from './landmarks.js';

export const RING_R = 9.5;
const SPACING = 62;
const AHEAD = 7;
const NETA_COLORS = ['#c9223a', '#ff8440', '#ffd23f', '#ff6f3c', '#7fc456'];

const noriGeo = new THREE.TorusGeometry(RING_R + 1.5, 1.35, 6, 22);
const riceGeo = new THREE.TorusGeometry(RING_R, 1.25, 6, 22);
const _z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _c = new THREE.Vector3();

function makeSushi(kind) {
  const b = new Builder(80 + kind);
  const color = NETA_COLORS[kind];
  b.add(new THREE.CapsuleGeometry(0.62, 1.5, 2, 6).rotateZ(Math.PI / 2), '#fffaf0', TR(0, 0, 0, 0, 0, 0, 1, 0.8, 1), { vary: 0.05 });
  b.add(new THREE.BoxGeometry(3.1, 0.34, 1.5), color, TR(0, 0.62, 0), { vary: 0.05 });
  if (kind === 2) b.add(new THREE.BoxGeometry(0.5, 1.5, 1.6), '#1c2a22', TR(0, 0.1, 0));
  return b.geometry(false);
}
const sushiGeos = NETA_COLORS.map((_, i) => makeSushi(i));

class Ring {
  constructor(scene) {
    this.g = new THREE.Group();
    this.noriMat = fogged(new THREE.MeshLambertMaterial({ color: 0x1c2a22, flatShading: true, transparent: true, emissive: 0x16261e, emissiveIntensity: 0.4 }));
    this.riceMat = fogged(new THREE.MeshLambertMaterial({ color: 0xfffaf0, flatShading: true, transparent: true, emissive: 0xffe2a8, emissiveIntensity: 0.2 }));
    this.sushiMat = fogged(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, emissive: 0xffffff, emissiveIntensity: 0.12 }));
    this.nori = new THREE.Mesh(noriGeo, this.noriMat);
    this.rice = new THREE.Mesh(riceGeo, this.riceMat);
    this.sushi = new THREE.Mesh(sushiGeos[0], this.sushiMat);
    this.sushi.scale.setScalar(1.5);
    this.g.add(this.nori, this.rice, this.sushi);
    this.g.visible = false;
    scene.add(this.g);
    this.pos = new THREE.Vector3(); this.n = new THREE.Vector3();
    this.state = 'free'; this.t = 0; this.kind = 0; this.index = 0;
    this.color = new THREE.Color();
  }
  place(pos, n, kind, index) {
    this.pos.copy(pos); this.n.copy(n);
    this.g.position.copy(pos);
    this.g.quaternion.setFromUnitVectors(_z, n);
    this.g.scale.setScalar(0.01);
    this.g.visible = true;
    this.kind = kind; this.index = index;
    this.sushi.geometry = sushiGeos[kind];
    this.sushi.visible = true;
    this.color.set(NETA_COLORS[kind]);
    this.state = 'active'; this.t = 0;
    this.setAlpha(1);
  }
  setAlpha(a) { this.noriMat.opacity = a; this.riceMat.opacity = a; this.sushiMat.opacity = a; }
}

export class Course {
  constructor(scene, landmarks) {
    this.scene = scene; this.landmarks = landmarks;
    this.pool = []; for (let i = 0; i < 16; i++) this.pool.push(new Ring(scene));
    this.rings = []; // 進行順
    this.head = { pos: new THREE.Vector3(), heading: 0, s: 0 };
    this.count = 0;
    this.sunBias = 0; this.sunAz = 0;
    this.lostTimer = 0;
    // 道しるべの米粒
    const N = 36;
    this.grainN = N;
    this.grains = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color: 0xfff2c4, fog: true, transparent: true, opacity: 0.9 }), N);
    this.grains.frustumCulled = false;
    this.grains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.grains);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
  }

  // pos/yaw の少し先から道を引き直す
  reset(pos, yaw, firstDist = 40, keepStraight = 2) {
    for (const r of this.rings) if (r.state === 'active') { r.state = 'missed'; r.t = 0; }
    this.rings = this.rings.filter((r) => r.state !== 'free');
    const h = this.head;
    h.heading = yaw; h.s = Math.random() * 100; h.straight = keepStraight;
    h.pos.set(pos.x + Math.sin(yaw) * (firstDist - SPACING), pos.y, pos.z + Math.cos(yaw) * (firstDist - SPACING));
    h.first = true;
    this.lostTimer = 0;
    this._fill();
  }

  _free() {
    for (const r of this.pool) if (r.state === 'free') return r;
    return null;
  }

  _clear(x, y, z, margin) {
    for (const c of this.landmarks.colliders) if (capsuleDist(c, x, y, z, _c) < c.r + margin) return false;
    return true;
  }

  _add() {
    const ring = this._free();
    if (!ring) return false;
    const h = this.head;
    h.s += 1;
    let turn = 0;
    if (h.straight > 0) h.straight--;
    else {
      turn = noise1(h.s * 0.23, 3) * 0.42 + noise1(h.s * 0.071, 5) * 0.2;
      if (this.sunBias > 0) turn += clamp(wrapAngle(this.sunAz - h.heading) * 0.22, -0.3, 0.3) * this.sunBias;
      turn = clamp(turn, -0.42, 0.42);
    }
    // ランドマークを避ける向きを探す
    let best = null;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
      const hd = h.heading + turn + off;
      const x = h.pos.x + Math.sin(hd) * SPACING, z = h.pos.z + Math.cos(hd) * SPACING;
      // 高さ: ゆるやかな波 + 地形の先読み
      let want = 46 + Math.sin(h.s * 0.19) * 34 + Math.sin(h.s * 0.071 + 1.3) * 22;
      want = Math.max(want, 9);
      const here = surfaceAt(x, z);
      let need = here + (here > 0.01 ? 17 : 9); // 海の上では水面近くまで下げて、水しぶきを誘う
      for (let k = 1; k <= 3; k++) {
        const sx = x + Math.sin(hd) * SPACING * k, sz = z + Math.cos(hd) * SPACING * k;
        need = Math.max(need, surfaceAt(sx, sz) + 17 - 19 * k);
      }
      need = Math.max(need, surfaceAt((x + h.pos.x) / 2, (z + h.pos.z) / 2) + 15);
      let y = Math.max(want, need);
      if (!h.first) y = clamp(y, h.pos.y - 17, h.pos.y + 21);
      else y = clamp(Math.max(h.pos.y, need), 10, 190);
      y = Math.max(y, here + (here > 0.01 ? 13 : 9));
      if (this._clear(x, y, z, 26) || off === -1.1) { best = { hd, x, y, z }; break; }
    }
    _v.set(best.x - h.pos.x, best.y - h.pos.y, best.z - h.pos.z).normalize();
    if (h.first) _v.set(Math.sin(best.hd), 0, Math.cos(best.hd));
    h.first = false;
    h.heading = best.hd;
    h.pos.set(best.x, best.y, best.z);
    ring.place(h.pos, _v, this.count % NETA_COLORS.length, this.count);
    this.count++;
    this.rings.push(ring);
    return true;
  }

  _fill() {
    let active = 0;
    for (const r of this.rings) if (r.state === 'active') active++;
    while (active < AHEAD && this._add()) active++;
  }

  next() {
    for (const r of this.rings) if (r.state === 'active') return r;
    return null;
  }

  // 戻り値: 通過したリング（あれば）。onMiss は取り逃し時
  update(dt, time, prev, cur, yaw, events) {
    let hit = null;
    const nx = this.next();
    for (const r of this.rings) {
      if (r.state !== 'active') continue;
      const s0 = _v.copy(prev).sub(r.pos).dot(r.n), s1 = _v2.copy(cur).sub(r.pos).dot(r.n);
      if (s0 < 0 && s1 >= 0) {
        const t = s0 / (s0 - s1);
        _c.copy(prev).lerp(cur, t).sub(r.pos);
        if (_c.length() < RING_R * 1.12) { hit = r; break; }
      }
    }
    if (hit) {
      // 手前の取り逃しを片付ける
      let skipped = 0;
      for (const r of this.rings) {
        if (r === hit) break;
        if (r.state === 'active') { r.state = 'missed'; r.t = 0; skipped++; }
      }
      hit.state = 'passed'; hit.t = 0; hit.sushi.visible = false;
      events.onHit(hit, skipped);
    } else if (nx) {
      const s1 = _v.copy(cur).sub(nx.pos).dot(nx.n);
      if (s1 > 14) { nx.state = 'missed'; nx.t = 0; events.onMiss(nx); }
    }
    // 迷子なら、いまの向きの先へ道を引き直す
    const n2 = this.next();
    if (n2) {
      _v.copy(n2.pos).sub(cur);
      const dist = _v.length();
      const ang = Math.abs(wrapAngle(Math.atan2(_v.x, _v.z) - yaw));
      if (dist > 210 || (ang > 1.75 && dist > 30)) this.lostTimer += dt; else this.lostTimer = Math.max(0, this.lostTimer - dt * 2);
      if (this.lostTimer > 1.3 || dist > 320) { this.reset(cur, yaw, 75, 1); events.onReroute(); }
    }
    this._fill();

    // 見た目の更新
    const first = this.next();
    for (const r of this.rings) {
      r.t += dt;
      if (r.state === 'active') {
        const grow = Math.min(r.t * 2.5, 1);
        const e = 1 - Math.pow(1 - grow, 3);
        const isNext = r === first;
        const pulse = isNext ? 1 + Math.sin(time * 6) * 0.035 : 1;
        r.g.scale.setScalar(e * pulse);
        r.riceMat.emissiveIntensity = isNext ? 0.62 + Math.sin(time * 6) * 0.2 : 0.3;
        r.sushi.rotation.y = time * 1.6 + r.index;
        r.sushi.position.y = Math.sin(time * 2 + r.index) * 0.5;
      } else if (r.state === 'passed') {
        const k = Math.min(r.t / 0.2, 1);
        r.g.scale.setScalar(1 + k * 0.35);
        r.riceMat.emissiveIntensity = 1.6 * (1 - k) + 0.3;
        r.setAlpha(Math.max(0, (1 - k) * (1 - k) * 0.8));
        if (k >= 1) { r.state = 'free'; r.g.visible = false; }
      } else if (r.state === 'missed') {
        const k = r.t / 0.7;
        r.setAlpha(Math.max(0, 1 - k));
        r.g.scale.setScalar(1 - k * 0.2);
        if (k >= 1) { r.state = 'free'; r.g.visible = false; }
      }
    }
    this.rings = this.rings.filter((r) => r.state !== 'free');

    // 道しるべ: リングからリングへ流れる米粒
    const act = this.rings.filter((r) => r.state === 'active');
    let gi = 0;
    const per = 6;
    for (let i = 0; i < act.length - 1 && gi < this.grainN; i++) {
      const a = act[i], b = act[i + 1];
      for (let k = 0; k < per && gi < this.grainN; k++) {
        const f = ((k + (time * 0.9) % 1) / per);
        _v.copy(a.pos).lerp(b.pos, f);
        _v.y += Math.sin(f * Math.PI) * 1.5 + Math.sin(time * 3 + gi) * 0.25;
        const sc = (i === 0 ? 1.25 : 0.9) * Math.sin(Math.min(f * Math.PI * 1.0, Math.PI)) * 1.0 + 0.25;
        this._q.setFromAxisAngle(_z, time * 2 + gi);
        this._s.setScalar(sc);
        this._m.compose(_v, this._q, this._s);
        this.grains.setMatrixAt(gi++, this._m);
      }
    }
    // 自機から最初のリングまで
    if (first) {
      for (let k = 1; k <= 3 && gi < this.grainN; k++) {
        const f = ((k - 1 + (time * 0.9) % 1) / 3);
        _v.copy(cur).lerp(first.pos, 0.25 + f * 0.75);
        this._s.setScalar(0.9 * Math.sin(f * Math.PI) + 0.15);
        this._q.identity();
        this._m.compose(_v, this._q, this._s);
        this.grains.setMatrixAt(gi++, this._m);
      }
    }
    this.grains.count = gi;
    this.grains.instanceMatrix.needsUpdate = true;
    return hit;
  }
}
