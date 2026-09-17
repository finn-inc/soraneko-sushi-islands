// 空・光・霧・一日の移ろい
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';

// ---- 霧に「太陽の方向のにじみ」を足す（全マテリアル共通のシェーダ片を差し替え） ----
export const fogShared = {
  uFogSunView: { value: new THREE.Vector3(0, 1, 0) },
  uFogGlow: { value: new THREE.Color(0, 0, 0) },
};
export const glowShared = { uGlow: { value: 0.2 } };

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogViewPos;
#endif`;
THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogViewPos = mvPosition.xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogViewPos;
  uniform vec3 uFogSunView;
  uniform vec3 uFogGlow;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogSd = max( dot( normalize( vFogViewPos ), uFogSunView ), 0.0 );
  vec3 fogCol = fogColor + uFogGlow * ( pow( fogSd, 6.0 ) * 0.5 + pow( fogSd, 40.0 ) * 0.35 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;

export function fogged(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFogSunView = fogShared.uFogSunView;
    shader.uniforms.uFogGlow = fogShared.uFogGlow;
  };
  return mat;
}

// 頂点カラーをそのまま発光色に使うマテリアル（夜に灯るもの用）
export function makeGlowMaterial({ glowBoost = 1, ...extra } = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...extra });
  const boost = { value: glowBoost };
  mat.userData.boost = boost;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFogSunView = fogShared.uFogSunView;
    shader.uniforms.uFogGlow = fogShared.uFogGlow;
    shader.uniforms.uGlow = glowShared.uGlow;
    shader.uniforms.uGlowBoost = boost;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;\nuniform float uGlowBoost;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vColor.rgb * uGlow * uGlowBoost;');
  };
  return mat;
}

// ---- 一日のキーフレーム ----
const K = (t, o) => ({ t, ...o });
const KEYS = [
  K(0.0, { el: 7, top: '#5a8ad6', mid: '#d3b4dc', hor: '#ffd0b0', glow: '#ff8a5c', sun: '#ffd2a0', light: '#ffcfa8', li: 2.1, sky: '#a9c0ff', gnd: '#f2c6ac', ai: 1.25, deep: '#2a8790', shal: '#9deed6', refl: '#ffd9c4', stars: 0.0, night: 0.0, cloud: '#ffe3d6', sunSize: 1.5 }),
  K(0.1, { el: 26, top: '#3c8ce6', mid: '#9ccff5', hor: '#e2f3f0', glow: '#ffe9bf', sun: '#fff3d6', light: '#fff0dc', li: 2.7, sky: '#b5d6ff', gnd: '#e6dcc4', ai: 1.35, deep: '#1b8fa6', shal: '#86f2dc', refl: '#d8f0f6', stars: 0.0, night: 0.0, cloud: '#ffffff', sunSize: 1.0 }),
  K(0.34, { el: 63, top: '#2374dc', mid: '#77bdf2', hor: '#d2eff4', glow: '#fff6dc', sun: '#ffffff', light: '#ffffff', li: 3.0, sky: '#b9dcff', gnd: '#dfe3c8', ai: 1.4, deep: '#128aa8', shal: '#7af2de', refl: '#cdeaf8', stars: 0.0, night: 0.0, cloud: '#ffffff', sunSize: 1.0 }),
  K(0.5, { el: 30, top: '#3579d2', mid: '#a3c9ea', hor: '#ffe6bd', glow: '#ffc47a', sun: '#ffe9b8', light: '#ffe6c0', li: 2.7, sky: '#b0cdf6', gnd: '#eed4ae', ai: 1.3, deep: '#1d86a0', shal: '#8cecd2', refl: '#f6e6cc', stars: 0.0, night: 0.0, cloud: '#fff4e2', sunSize: 1.1 }),
  K(0.6, { el: 12, top: '#4568ba', mid: '#f0b08e', hor: '#ffc07c', glow: '#ff8a3c', sun: '#ffb45e', light: '#ffb070', li: 2.5, sky: '#9aa4e0', gnd: '#ffb98a', ai: 1.15, deep: '#2d6f98', shal: '#9ad6c0', refl: '#ffc896', stars: 0.0, night: 0.05, cloud: '#ffd0a6', sunSize: 1.6 }),
  K(0.69, { el: 4.2, top: '#2a3088', mid: '#c84e8c', hor: '#ff8f4e', glow: '#ff5222', sun: '#ff7a36', light: '#ff8048', li: 2.3, sky: '#7a62b0', gnd: '#ff8e66', ai: 1.0, deep: '#35427e', shal: '#c08aa0', refl: '#ff9a62', stars: 0.08, night: 0.25, cloud: '#ff9a7a', sunSize: 2.3 }),
  K(0.75, { el: 0.6, top: '#1f2470', mid: '#a8407e', hor: '#ff7a48', glow: '#ff3e1e', sun: '#ff5a2a', light: '#f06a50', li: 1.7, sky: '#6252a4', gnd: '#e87868', ai: 0.98, deep: '#2a3470', shal: '#a87a9c', refl: '#ff8660', stars: 0.2, night: 0.45, cloud: '#d8708a', sunSize: 2.5 }),
  K(0.8, { el: -5, top: '#141a54', mid: '#6c3a88', hor: '#ee6258', glow: '#d83c68', sun: '#ff5a30', light: '#c06a90', li: 0.9, sky: '#4a4a98', gnd: '#b8607a', ai: 0.95, deep: '#1f2a62', shal: '#7a6a9a', refl: '#e0667a', stars: 0.45, night: 0.7, cloud: '#9a5a8a', sunSize: 2.3 }),
  K(0.88, { el: -18, top: '#050a28', mid: '#0e1b4c', hor: '#244474', glow: '#1c3a70', sun: '#000000', light: '#9db8ff', li: 1.1, sky: '#4460b8', gnd: '#22346a', ai: 1.2, deep: '#0c1c46', shal: '#2c6a8e', refl: '#2c4c82', stars: 1.0, night: 1.0, cloud: '#33477e', sunSize: 1.0 }),
  K(1.0, { el: -30, top: '#03061e', mid: '#0a1440', hor: '#1c3460', glow: '#162c5c', sun: '#000000', light: '#a8c0ff', li: 1.15, sky: '#3c54ac', gnd: '#1c2c5e', ai: 1.15, deep: '#0a1840', shal: '#265e84', refl: '#243f74', stars: 1.0, night: 1.0, cloud: '#2b3c70', sunSize: 1.0 }),
];
const COLOR_FIELDS = ['top', 'mid', 'hor', 'glow', 'sun', 'light', 'sky', 'gnd', 'deep', 'shal', 'refl', 'cloud'];
const NUM_FIELDS = ['el', 'li', 'ai', 'stars', 'night', 'sunSize'];
for (const k of KEYS) for (const f of COLOR_FIELDS) k[f] = new THREE.Color(k[f]);

const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // 常に最遠
}`;
const skyFrag = /* glsl */ `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uGlow;
uniform vec3 uSunCol; uniform vec3 uSunDir; uniform vec3 uMoonDir;
uniform float uSunSize; uniform float uNight; uniform float uTime;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.24, h));
  col = mix(col, uTop, smoothstep(0.1, 0.72, h));
  // 水平線より下は霧色で埋める
  col = mix(col, uHor, 1.0 - smoothstep(-0.05, 0.0, d.y));
  float sd = max(dot(d, uSunDir), 0.0);
  float band = exp(-abs(d.y) * 5.0);
  col += uGlow * (pow(sd, 6.0) * 0.5 * (0.35 + 0.65 * band) + pow(sd, 40.0) * 0.35);
  // 太陽（角ばらせず、素直な円盤）
  float cr = cos(radians(2.1 * uSunSize));
  float disc = smoothstep(cr - 0.00035, cr + 0.00015, dot(d, uSunDir));
  col += uSunCol * disc * 3.0 * step(-0.02, d.y);
  // 月（三日月）
  float md = dot(d, uMoonDir);
  float moon = smoothstep(0.99905, 0.99925, md);
  vec3 off = normalize(uMoonDir + vec3(0.022, 0.012, 0.0));
  float cut = smoothstep(0.9990, 0.99925, dot(d, off));
  float cres = clamp(moon - cut, 0.0, 1.0);
  col += vec3(1.0, 0.96, 0.82) * cres * 2.4 * uNight;
  col += vec3(0.5, 0.6, 1.0) * pow(max(md, 0.0), 300.0) * 0.25 * uNight;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const starVert = /* glsl */ `
attribute float aPhase; attribute float aSize;
uniform float uTime; uniform float uAlpha; uniform float uPx;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + aPhase * 2.0) + aPhase * 40.0);
  vA = uAlpha * tw * smoothstep(0.02, 0.25, normalize(position).y);
  gl_PointSize = aSize * uPx;
}`;
const starFrag = /* glsl */ `
varying float vA;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.1, 0.5, length(p))) * vA;
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a * 1.6, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.cur = {};
    for (const f of COLOR_FIELDS) this.cur[f] = new THREE.Color();
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, 1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.sunAz = 0;
    this.night = 0;

    scene.fog = new THREE.Fog(0xffffff, 420, 1750);

    this.skyUniforms = {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
      uSunSize: { value: 1 }, uNight: { value: 0 }, uTime: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(100, 32, 20),
      new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -100;
    this.sky = sky;
    scene.add(sky);

    // 星
    const N = 1400;
    const pos = new Float32Array(N * 3), ph = new Float32Array(N), sz = new Float32Array(N);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
      const y = Math.abs(u), r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 100; pos[i * 3 + 1] = y * 100; pos[i * 3 + 2] = Math.sin(a) * r * 100;
      ph[i] = rnd(); sz[i] = 1.2 + Math.pow(rnd(), 6) * 3.2;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    sg.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    this.starUniforms = { uTime: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: 1 } };
    // 深度は最遠(1.0)で書くので、地形が描かれた所には星が出ない
    const stars = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: this.starUniforms, vertexShader: starVert, fragmentShader: starFrag, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false }));
    stars.frustumCulled = false;
    stars.renderOrder = -99;
    this.stars = stars;
    scene.add(stars);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 2);
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(this.hemi);
  }

  update(dayT, time, camera, pixelRatio) {
    const t = clamp(dayT, 0, 1);
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const f = clamp((t - a.t) / (b.t - a.t), 0, 1);
    const c = this.cur;
    for (const n of COLOR_FIELDS) c[n].copy(a[n]).lerp(b[n], f);
    for (const n of NUM_FIELDS) c[n] = lerp(a[n], b[n], f);

    // 太陽は東から昇り、西（az≈250°）へ沈む
    const az = THREE.MathUtils.degToRad(80 + 243 * t);
    const el = THREE.MathUtils.degToRad(c.el);
    this.sunAz = az;
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const mEl = THREE.MathUtils.degToRad(lerp(16, 46, smoothstep(0.78, 1.0, t)));
    const mAz = THREE.MathUtils.degToRad(250 + 150 + 40 * t);
    this.moonDir.set(Math.cos(mEl) * Math.sin(mAz), Math.sin(mEl), Math.cos(mEl) * Math.cos(mAz));

    const sunI = smoothstep(-3, 4, c.el);
    const moonI = smoothstep(-3, -10, c.el);
    this.lightDir.copy(sunI >= moonI && c.el > -3 ? this.sunDir : this.moonDir);
    if (c.el > -3 && this.lightDir.y < 0.12) { this.lightDir.y = 0.12; this.lightDir.normalize(); }
    this.night = c.night;

    const u = this.skyUniforms;
    u.uTop.value.copy(c.top); u.uMid.value.copy(c.mid); u.uHor.value.copy(c.hor);
    u.uGlow.value.copy(c.glow); u.uSunCol.value.copy(c.sun);
    u.uSunSize.value = c.sunSize; u.uNight.value = c.night; u.uTime.value = time;
    this.starUniforms.uTime.value = time;
    this.starUniforms.uAlpha.value = c.stars;
    this.starUniforms.uPx.value = pixelRatio;

    this.scene.fog.color.copy(c.hor);
    fogShared.uFogGlow.value.copy(c.glow);
    fogShared.uFogSunView.value.copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
    glowShared.uGlow.value = 0.12 + c.night * 1.5;

    this.sunLight.color.copy(c.light);
    this.sunLight.intensity = c.li * Math.max(sunI, moonI);
    this.sunLight.position.copy(camera.position).addScaledVector(this.lightDir, 500);
    this.sunLight.target.position.copy(camera.position);
    this.hemi.color.copy(c.sky);
    this.hemi.groundColor.copy(c.gnd);
    this.hemi.intensity = c.ai;

    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
  }
}

export function dayLabel(t) {
  if (t < 0.12) return '朝';
  if (t < 0.48) return '昼';
  if (t < 0.58) return '午後';
  if (t < 0.82) return '夕焼け';
  return '夜';
}
