// プリミティブを頂点カラー付きの1メッシュにまとめるビルダー
import * as THREE from 'three';
import { fogged, makeGlowMaterial } from './env.js';

export const matSolid = fogged(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
export const matGlow = makeGlowMaterial();

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

// 位置・回転(XYZ)・拡縮から行列を作る
export function TR(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), _q.clone(), new THREE.Vector3(sx, sy, sz));
}

export function nonIndexedPositions(geom) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  return g.attributes.position.array;
}

export class Builder {
  constructor(seed = 1) {
    this.pos = []; this.col = [];
    this.gpos = []; this.gcol = [];
    this.seed = seed;
  }
  rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
  // color: 色 or (x,y,z)=>色。opts: {glow, vary, parent}
  add(geom, color, matrix = null, opts = {}) {
    const p = nonIndexedPositions(geom);
    const pos = opts.glow ? this.gpos : this.pos;
    const col = opts.glow ? this.gcol : this.col;
    const vary = opts.vary ?? 0.06;
    const fixed = typeof color === 'function' ? null : new THREE.Color(color);
    const m = _m.identity();
    if (opts.parent) m.copy(opts.parent);
    if (matrix) m.multiply(matrix);
    const e = m.elements;
    for (let i = 0; i < p.length; i += 9) {
      let c = fixed;
      if (!c) {
        const cx = (p[i] + p[i + 3] + p[i + 6]) / 3, cy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3, cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
        c = new THREE.Color(color(cx, cy, cz));
      }
      const f = 1 + (this.rnd() - 0.5) * 2 * vary;
      for (let k = 0; k < 3; k++) {
        const x = p[i + k * 3], y = p[i + k * 3 + 1], z = p[i + k * 3 + 2];
        pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
        col.push(c.r * f, c.g * f, c.b * f);
      }
    }
    return this;
  }
  geometry(glow = false) {
    const pos = glow ? this.gpos : this.pos, col = glow ? this.gcol : this.col;
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.computeBoundingSphere();
    return g;
  }
  // {solid, glow} のジオメトリを返す（インスタンス間で共有する）
  build() {
    return { solid: this.geometry(false), glow: this.geometry(true) };
  }
}

export function meshesFrom(built, solidMat = matSolid, glowMat = matGlow) {
  const g = new THREE.Group();
  if (built.solid) g.add(new THREE.Mesh(built.solid, solidMat));
  if (built.glow) g.add(new THREE.Mesh(built.glow, glowMat));
  return g;
}

// ジオメトリの頂点を関数で変形する
export function deform(geom, fn) {
  const a = geom.attributes.position;
  for (let i = 0; i < a.count; i++) {
    _v.fromBufferAttribute(a, i);
    fn(_v);
    a.setXYZ(i, _v.x, _v.y, _v.z);
  }
  return geom;
}
