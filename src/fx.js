// パーティクル・スピード線・影
import * as THREE from 'three';
import { fogShared } from './env.js';

const pVert = /* glsl */ `
attribute vec4 aColor; attribute float aSize; attribute float aSoft;
uniform float uScale; uniform float uMaxPx;
varying vec4 vColor; varying float vSoft; varying float vDepth; varying vec3 vView;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float cap = mix(uMaxPx * 0.06, uMaxPx, step(0.3, aSoft)); // 粒はカメラの近くでも大きくしすぎない
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, cap);
  vColor = aColor; vSoft = aSoft; vDepth = -mv.z; vView = mv.xyz;
}`;
const pFrag = /* glsl */ `
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uUseFog; uniform float uGain;
varying vec4 vColor; varying float vSoft; varying float vDepth; varying vec3 vView;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float hard = 1.0 - smoothstep(0.82, 1.0, r);
  float soft = (1.0 - r) * (1.0 - r);
  float a = vColor.a * mix(hard, soft, vSoft);
  vec3 col = vColor.rgb * uGain;
  float f = smoothstep(uFogNear, uFogFar, vDepth) * uUseFog;
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Pool {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 4); this.s = new Float32Array(max); this.soft = new Float32Array(max);
    // life, maxLife, size0, size1, alpha0, gravity, drag
    this.d = new Float32Array(max * 7);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSoft', new THREE.BufferAttribute(this.soft, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = {
      uScale: { value: 500 }, uMaxPx: { value: 64 }, uFogColor: { value: new THREE.Color() }, uFogNear: { value: 1 }, uFogFar: { value: 2 },
      uUseFog: { value: additive ? 0 : 1 }, uGain: { value: additive ? 1.6 : 1 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: pVert, fragmentShader: pFrag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    this.geo = g;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size0, size1, r, g, b, a, gravity = 0, drag = 0, soft = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = a;
    this.soft[i] = soft;
    const d = this.d, k = i * 7;
    d[k] = life; d[k + 1] = life; d[k + 2] = size0; d[k + 3] = size1; d[k + 4] = a; d[k + 5] = gravity; d[k + 6] = drag;
  }
  update(dt) {
    const { p, v, c, s, d, soft } = this;
    for (let i = 0; i < this.n; i++) {
      const k = i * 7;
      d[k] -= dt;
      if (d[k] <= 0) {
        const j = --this.n;
        if (j !== i) {
          for (let q = 0; q < 3; q++) { p[i * 3 + q] = p[j * 3 + q]; v[i * 3 + q] = v[j * 3 + q]; }
          for (let q = 0; q < 4; q++) c[i * 4 + q] = c[j * 4 + q];
          for (let q = 0; q < 7; q++) d[k + q] = d[j * 7 + q];
          soft[i] = soft[j];
        }
        i--;
        continue;
      }
      const drag = Math.exp(-d[k + 6] * dt);
      v[i * 3] *= drag; v[i * 3 + 1] = v[i * 3 + 1] * drag - d[k + 5] * dt; v[i * 3 + 2] *= drag;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      const t = 1 - d[k] / d[k + 1];
      s[i] = d[k + 2] + (d[k + 3] - d[k + 2]) * t;
      const fadeIn = Math.min(t * 8, 1);
      c[i * 4 + 3] = d[k + 4] * fadeIn * (1 - t * t);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = true; a.aColor.needsUpdate = true; a.aSize.needsUpdate = true; a.aSoft.needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
  }
}

const R = Math.random;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

export class FX {
  constructor(scene, camera) {
    this.norm = new Pool(scene, 2600, false);
    this.add = new Pool(scene, 900, true);

    // スピード線（カメラの子）
    const N = 110;
    this.lineN = N;
    this.linePos = new Float32Array(N * 6);
    this.lineSeed = [];
    for (let i = 0; i < N; i++) this.lineSeed.push({ a: R() * 6.283, r: 7 + R() * 10, z: -R() * 70, sp: 0.7 + R() * 0.6 });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 7;
    camera.add(this.lines);

    // 丸い影
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x0a1020, transparent: true, opacity: 0.25, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), this.shadowMat);
    this.shadow.renderOrder = 2;
    scene.add(this.shadow);
    this.windAcc = 0;
  }

  setView(heightPx, fovDeg, fog) {
    const sc = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const pool of [this.norm, this.add]) {
      pool.uniforms.uScale.value = sc;
      pool.uniforms.uMaxPx.value = heightPx * (pool === this.add ? 0.022 : 0.3);
      pool.uniforms.uFogColor.value.copy(fog.color);
      pool.uniforms.uFogNear.value = fog.near; pool.uniforms.uFogFar.value = fog.far;
    }
  }

  // リング通過: 輪の面に沿って米粒がはじける
  ringBurst(pos, normal, fwdSpeed, color) {
    _n.copy(normal);
    _a.set(0, 1, 0).cross(_n).normalize();
    _b.copy(_n).cross(_a);
    for (let i = 0; i < 46; i++) {
      const ang = R() * 6.283, sp = 16 + R() * 26, rr = 7 + R() * 2;
      const cx = Math.cos(ang), sy = Math.sin(ang);
      const dx = _a.x * cx + _b.x * sy, dy = _a.y * cx + _b.y * sy, dz = _a.z * cx + _b.z * sy;
      const f = fwdSpeed * (0.5 + R() * 0.4);
      const neta = i % 4 === 0;
      this.norm.emit(pos.x + dx * rr, pos.y + dy * rr, pos.z + dz * rr, dx * sp + _n.x * f, dy * sp + _n.y * f + 4, dz * sp + _n.z * f,
        0.55 + R() * 0.45, neta ? 0.9 : 0.5 + R() * 0.35, 0, neta ? color.r : 1, neta ? color.g : 0.98, neta ? color.b : 0.9, 1, 22, 1.6, 0);
    }
    for (let i = 0; i < 26; i++) {
      const ang = R() * 6.283, sp = 8 + R() * 40;
      const cx = Math.cos(ang), sy = Math.sin(ang);
      const dx = _a.x * cx + _b.x * sy, dy = _a.y * cx + _b.y * sy, dz = _a.z * cx + _b.z * sy;
      const f = fwdSpeed * 0.8;
      this.add.emit(pos.x + dx * 6, pos.y + dy * 6, pos.z + dz * 6, dx * sp + _n.x * f, dy * sp + _n.y * f, dz * sp + _n.z * f,
        0.35 + R() * 0.4, 1.7, 0, 1, 0.82, 0.45, 0.8, 0, 2.5, 1);
    }
  }
  splash(x, z, vx, vz, power) {
    const n = Math.ceil(power * 9);
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283, sp = 3 + R() * 9;
      this.norm.emit(x + (R() - 0.5) * 3, 0.4, z + (R() - 0.5) * 3, Math.cos(a) * sp + vx * 0.35, 9 + R() * 14 * power, Math.sin(a) * sp + vz * 0.35,
        0.5 + R() * 0.5, 0.28 + R() * 0.5, 0.05, 0.9, 1, 1, 0.95, 34, 0.6, 0);
    }
    // 航跡の泡
    this.norm.emit(x + (R() - 0.5) * 4, 0.9, z + (R() - 0.5) * 4, (R() - 0.5) * 3, 0.2, (R() - 0.5) * 3, 1.3 + R(), 2.5, 6.5, 1, 1, 1, 0.5, 0, 1, 0.35);
  }
  petals(x, y, z, vx, vz, pink) {
    for (let i = 0; i < 3; i++) {
      const c = pink ? [1, 0.62 + R() * 0.2, 0.78 + R() * 0.12] : [0.62 + R() * 0.2, 0.9, 0.45];
      this.norm.emit(x + (R() - 0.5) * 10, y + R() * 2, z + (R() - 0.5) * 10, vx * 0.3 + (R() - 0.5) * 12, 5 + R() * 9, vz * 0.3 + (R() - 0.5) * 12,
        1.2 + R() * 1.1, 0.75 + R() * 0.5, 0.3, c[0], c[1], c[2], 1, 5, 1.4, 0);
    }
  }
  puff(x, y, z, n = 26, size = 9, r = 1, g = 1, b = 1, alpha = 0.55) {
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283, e = (R() - 0.5) * 2, sp = 6 + R() * 16;
      const h = Math.sqrt(1 - e * e);
      this.norm.emit(x, y, z, Math.cos(a) * h * sp, e * sp * 0.7 + 2, Math.sin(a) * h * sp, 0.7 + R() * 0.7, size * 0.4, size * (0.9 + R() * 0.6), r, g, b, alpha, -1, 2.2, 0.85);
    }
  }
  steam(p) {
    this.norm.emit(p.x + (R() - 0.5) * 50, p.y, p.z + (R() - 0.5) * 50, (R() - 0.5) * 3, 9 + R() * 6, (R() - 0.5) * 3, 5 + R() * 3, 10, 34, 1, 1, 1, 0.3, 0, 0.1, 1);
  }
  sparkleTrail(x, y, z, vx, vy, vz) {
    this.add.emit(x + (R() - 0.5), y + (R() - 0.5), z + (R() - 0.5), vx + (R() - 0.5) * 4, vy + (R() - 0.5) * 4, vz + (R() - 0.5) * 4, 0.45 + R() * 0.35, 0.8, 0, 1, 0.8, 0.4, 0.7, 3, 1, 1);
  }

  update(dt, time, player, fwd, camera, surfaceY, night) {
    // 風の粒: 進行方向の先に置いて、通り過ぎるのを見せる
    this.windAcc += dt * (14 + player.boost * 60);
    while (this.windAcc > 1) {
      this.windAcc -= 1;
      const d = 70 + R() * 90, a = R() * 6.283, rr = 6 + R() * 42;
      _a.set(0, 1, 0).cross(fwd).normalize();
      _b.copy(fwd).cross(_a);
      const ox = _a.x * Math.cos(a) * rr + _b.x * Math.sin(a) * rr, oy = _a.y * Math.cos(a) * rr + _b.y * Math.sin(a) * rr, oz = _a.z * Math.cos(a) * rr + _b.z * Math.sin(a) * rr;
      const br = 1 - night * 0.35;
      this.norm.emit(player.pos.x + fwd.x * d + ox, Math.max(player.pos.y + fwd.y * d + oy, 1.5), player.pos.z + fwd.z * d + oz, 0, 0, 0, 2.2, 0.32, 0.32, br, br, br, 0.55, 0, 0, 0);
    }
    this.norm.update(dt);
    this.add.update(dt);

    // スピード線
    const b = player.boost, P = this.linePos;
    this.lineMat.opacity = Math.min(b * 0.4, 0.3) * (1 - night * 0.3);
    this.lines.visible = b > 0.02;
    if (this.lines.visible) {
      for (let i = 0; i < this.lineN; i++) {
        const s = this.lineSeed[i];
        s.z += dt * 150 * s.sp * (0.4 + b);
        if (s.z > -6) { s.z = -70 - R() * 20; s.a = R() * 6.283; s.r = 7 + R() * 10; }
        const x = Math.cos(s.a) * s.r, y = Math.sin(s.a) * s.r, len = Math.min(2 + b * 6, (-s.z - 3) * 0.5);
        P[i * 6] = x; P[i * 6 + 1] = y; P[i * 6 + 2] = s.z;
        P[i * 6 + 3] = x * 1.02; P[i * 6 + 4] = y * 1.02; P[i * 6 + 5] = s.z - len;
      }
      this.lines.geometry.attributes.position.needsUpdate = true;
    }

    // 影
    const h = player.pos.y - surfaceY;
    const k = Math.max(0, 1 - h / 150);
    this.shadow.position.set(player.pos.x, surfaceY + 0.35, player.pos.z);
    this.shadow.scale.setScalar(3.2 + h * 0.05);
    this.shadowMat.opacity = 0.3 * k * k * (1 - night * 0.5);
    this.shadow.visible = k > 0.02;
  }
}
