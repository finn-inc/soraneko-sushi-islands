// 主役: はちまきを締めた三毛猫（竹とんぼで飛ぶ）。+Z が進行方向
import * as THREE from 'three';
import { Builder, TR } from './build.js';
import { fogShared } from './env.js';

const S = 1.75;
const WHITE = '#fffdf8', ORANGE = '#f29a3a', BLACK = '#2e2a2c', PINK = '#ff9db0', RED = '#e0322c', BAMBOO = '#d8c070';

export class Cat {
  constructor() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.root = root; this.body = body;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    // 夜や逆光でも主役が沈まないよう、わずかに自発光させる
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFogSunView = fogShared.uFogSunView;
      shader.uniforms.uFogGlow = fogShared.uFogGlow;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vColor.rgb * 0.2;');
    };
    const mk = (b) => new THREE.Mesh(b.geometry(false), mat);

    const ico1 = new THREE.IcosahedronGeometry(1, 1);
    const ico0 = new THREE.IcosahedronGeometry(1, 0);
    const b = new Builder(41);
    // 胴体と三毛のぶち
    b.add(ico1, WHITE, TR(0, 0, 0, 0, 0, 0, 0.98, 0.86, 1.55), { vary: 0.03 });
    b.add(ico1, ORANGE, TR(0.32, 0.5, -0.55, 0, 0.3, 0, 0.66, 0.46, 0.85), { vary: 0.04 });
    b.add(ico1, BLACK, TR(-0.42, 0.47, 0.35, 0, -0.2, 0, 0.55, 0.44, 0.7), { vary: 0.04 });
    b.add(ico0, ORANGE, TR(-0.55, 0.1, -0.95, 0, 0, 0, 0.5, 0.5, 0.55), { vary: 0.04 });
    // 頭
    b.add(ico1, WHITE, TR(0, 0.38, 1.78, 0, 0, 0, 0.95, 0.86, 0.88), { vary: 0.03 });
    b.add(ico1, ORANGE, TR(0.42, 0.78, 1.62, 0, 0, -0.5, 0.5, 0.36, 0.55), { vary: 0.04 });
    b.add(ico1, BLACK, TR(-0.42, 0.78, 1.62, 0, 0, 0.5, 0.5, 0.36, 0.55), { vary: 0.04 });
    b.add(ico0, WHITE, TR(0, 0.18, 2.48, 0, 0, 0, 0.4, 0.3, 0.3), { vary: 0.02 });
    // 耳
    for (const s of [-1, 1]) {
      b.add(new THREE.ConeGeometry(0.36, 0.66, 4), s > 0 ? ORANGE : BLACK, TR(s * 0.52, 1.28, 1.72, 0, 0, -s * 0.28));
      b.add(new THREE.ConeGeometry(0.2, 0.42, 4), PINK, TR(s * 0.52, 1.24, 1.84, 0, 0, -s * 0.28));
    }
    // 顔
    for (const s of [-1, 1]) {
      b.add(ico0, '#1c1a1c', TR(s * 0.36, 0.52, 2.52, 0, 0, 0, 0.13, 0.17, 0.08), { vary: 0 });
      b.add(ico0, '#ffffff', TR(s * 0.33, 0.58, 2.6, 0, 0, 0, 0.045), { vary: 0 });
      b.add(ico0, '#ffc2cc', TR(s * 0.62, 0.22, 2.36, 0, 0, 0, 0.16, 0.1, 0.08), { vary: 0 });
      for (const k of [-1, 1]) b.add(new THREE.BoxGeometry(0.7, 0.025, 0.025), '#e8e2da', TR(s * 0.82, 0.2 + k * 0.07, 2.3, 0, -s * 0.35, s * k * 0.18));
    }
    b.add(ico0, PINK, TR(0, 0.3, 2.76, 0, 0, 0, 0.08, 0.06, 0.06), { vary: 0 });
    // はちまき
    b.add(new THREE.TorusGeometry(0.9, 0.11, 5, 14).rotateX(Math.PI / 2), '#ffffff', TR(0, 0.72, 1.76, 0.22, 0, 0, 1, 1.5, 0.95), { vary: 0.02 });
    b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 8).rotateX(Math.PI / 2), RED, TR(0, 0.9, 2.6, 0.2, 0, 0), { vary: 0 });
    b.add(ico0, '#ffffff', TR(0, 0.62, 0.9, 0, 0, 0, 0.18, 0.16, 0.16), { vary: 0.02 });
    // 竹とんぼの軸
    b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 5), BAMBOO, TR(0, 1.5, 1.55));
    body.add(mk(b));

    // 脚（前に2本、後ろに2本）
    this.legs = [];
    const legB = new Builder(43);
    legB.add(new THREE.CapsuleGeometry(0.2, 0.85, 2, 6).rotateX(Math.PI / 2), WHITE, TR(0, 0, 0.5), { vary: 0.03 });
    legB.add(ico0, WHITE, TR(0, 0, 1.12, 0, 0, 0, 0.27, 0.22, 0.3), { vary: 0.03 });
    const legGeo = legB.geometry(false);
    const legDefs = [[0.46, -0.42, 1.0, 0], [-0.46, -0.42, 1.0, 0], [0.5, -0.38, -1.0, Math.PI], [-0.5, -0.38, -1.0, Math.PI]];
    for (const [x, y, z, ry] of legDefs) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.rotation.y = ry;
      const m = new THREE.Mesh(legGeo, mat);
      pivot.add(m);
      body.add(pivot);
      this.legs.push(m);
    }

    // しっぽ（入れ子のグループで波打たせる）
    this.tail = [];
    let parent = new THREE.Group();
    parent.position.set(0, 0.35, -1.4);
    parent.rotation.x = -0.35;
    body.add(parent);
    for (let i = 0; i < 6; i++) {
      const sb = new Builder(50 + i);
      const r = 0.2 - i * 0.015;
      sb.add(new THREE.CylinderGeometry(r * 0.9, r, 0.46, 6).rotateX(Math.PI / 2), i >= 4 ? ORANGE : BLACK, TR(0, 0, -0.23), { vary: 0.05 });
      const seg = new THREE.Group();
      seg.add(new THREE.Mesh(sb.geometry(false), mat));
      parent.add(seg);
      this.tail.push(seg);
      const next = new THREE.Group();
      next.position.z = -0.44;
      seg.add(next);
      parent = next;
    }

    // はちまきの垂れ（2本）
    this.ribbons = [];
    for (const s of [-1, 1]) {
      let p = new THREE.Group();
      p.position.set(s * 0.1, 0.62, 0.86);
      p.rotation.y = s * 0.25;
      body.add(p);
      const chain = [];
      for (let i = 0; i < 4; i++) {
        const rb = new Builder(60 + i);
        rb.add(new THREE.BoxGeometry(0.2, 0.03, 0.42), '#ffffff', TR(0, 0, -0.21), { vary: 0.03 });
        const seg = new THREE.Group();
        seg.add(new THREE.Mesh(rb.geometry(false), mat));
        p.add(seg);
        chain.push(seg);
        const next = new THREE.Group();
        next.position.z = -0.4;
        seg.add(next);
        p = next;
      }
      this.ribbons.push(chain);
    }

    // 竹とんぼの羽根
    const pb = new Builder(70);
    pb.add(new THREE.BoxGeometry(2.3, 0.04, 0.24), BAMBOO, TR(0, 0, 0, 0, 0, 0.0));
    pb.add(new THREE.BoxGeometry(0.24, 0.04, 2.3), '#eedc98', TR(0, 0.01, 0));
    this.prop = new THREE.Mesh(pb.geometry(false), mat);
    this.prop.position.set(0, 1.86, 1.55);
    body.add(this.prop);

    body.scale.setScalar(S);
    this.squash = 0;
    this.t = 0;
  }

  // roll: バンク角、boost: 0..1、turn: -1..1
  update(dt, time, roll, boost, turn) {
    this.t += dt * (1 + boost * 1.2);
    const t = this.t;
    this.body.rotation.z = roll;
    this.body.position.y = Math.sin(time * 2.1) * 0.18;
    this.squash = Math.max(0, this.squash - dt * 3.2);
    const sq = Math.sin(this.squash * Math.PI) * 0.3;
    this.body.scale.set(S * (1 + sq * 0.6), S * (1 - sq), S * (1 + sq * 0.6));
    for (let i = 0; i < this.tail.length; i++) {
      this.tail[i].rotation.y = Math.sin(t * 4.2 - i * 0.7) * (0.16 + i * 0.035) - turn * 0.16;
      this.tail[i].rotation.x = Math.sin(t * 2.6 - i * 0.5) * 0.07 + 0.06;
    }
    for (let k = 0; k < 2; k++) for (let i = 0; i < 4; i++) {
      const seg = this.ribbons[k][i];
      seg.rotation.x = Math.sin(t * 11 - i * 1.1 + k) * (0.12 + i * 0.07) * (0.7 + boost);
      seg.rotation.y = Math.sin(t * 7 - i * 0.9 + k * 2) * 0.12 - turn * 0.1;
    }
    this.prop.rotation.y += dt * (26 + boost * 30);
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      this.legs[i].rotation.x = Math.sin(t * 3 + i * 1.7) * 0.1 + (front ? -0.08 - boost * 0.12 : 0.1 + boost * 0.1);
    }
  }
}
