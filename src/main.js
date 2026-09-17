// そらねこ寿司諸島 — メインループ
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Environment, dayLabel } from './env.js';
import { Terrain, Water, heightAt, solidAt, surfaceAt, sampleTerrain } from './world.js';
import { Landmarks, capsuleDist } from './landmarks.js';
import { Clouds } from './clouds.js';
import { Course } from './rings.js';
import { Cat } from './cat.js';
import { FX } from './fx.js';
import { GameAudio } from './audio.js';
import { UI } from './ui.js';
import { clamp, damp, dampAngle, wrapAngle, lerp, smoothstep } from './util.js';

const params = new URLSearchParams(location.search);
const AUTOPILOT = params.get('autopilot') === '1';
const TIMESCALE = Math.max(parseFloat(params.get('timescale')) || 1, 0.01);
const QUALITY_LOCK = params.has('quality') ? clamp(parseInt(params.get('quality'), 10) || 0, 0, 3) : null;
const DAY_LENGTH = 120;
const BASE_SPEED = 42, BOOST_SPEED = 76;
const TITLE_T = 0.035;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.info.autoReset = false;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 9000);
scene.add(camera);

const ui = new UI();
const audio = new GameAudio();
const env = new Environment(scene);
const terrain = new Terrain(scene);
const water = new Water(scene);
const landmarks = new Landmarks(scene);
const clouds = new Clouds(scene);
const course = new Course(scene, landmarks);
const cat = new Cat();
scene.add(cat.root);
const fx = new FX(scene, camera);

// ---- 画質（重ければ自動で下げる） ----
let quality = QUALITY_LOCK ?? 0;
let composer = null, bloom = null;
// 0: ブルーム+MSAA / 1: ブルーム / 2: ポストプロセスなし / 3: さらに解像度を落とす
function pixelRatio() { return quality === 3 ? 0.7 : Math.min(window.devicePixelRatio || 1, quality === 0 ? 1.5 : 1); }
function buildComposer() {
  if (composer) { composer.dispose(); composer = null; }
  const pr = pixelRatio(), w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (quality < 2) {
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: quality === 0 ? 4 : 0 });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.42, 0.7, 0.86);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
}
buildComposer();
window.addEventListener('resize', buildComposer);

// ---- 状態 ----
const player = {
  pos: new THREE.Vector3(0, 64, 0), yaw: 0.9, pitch: 0, roll: 0, yawRate: 0, speed: BASE_SPEED, boost: 0,
  bounce: new THREE.Vector3(), bounceCool: 0,
};
const game = { sinceStart: 0, state: 'title', dayT: TITLE_T, score: 0, combo: 0, maxCombo: 0, time: 0, endTimer: 0, flights: 0, hintTimer: 0 };
const input = { rx: 0, ry: 0, down: false, px: window.innerWidth / 2, py: window.innerHeight / 2 };
const cam = { yaw: player.yaw, pitch: 0, pos: new THREE.Vector3(), blend: 1, side: 0, shake: 0, fovKick: 0, inited: false };
let hitStop = 0, splashAcc = 0, petalAcc = 0, steamAcc = 0, splashLevel = 0, autoBoostT = 0;
const errors = [];
const stats = { draw: 0, tris: 0 };
let debugLook = null;
window.addEventListener('error', (e) => errors.push(String(e.message)));

const fwd = new THREE.Vector3(), prevPos = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _c = new THREE.Vector3();
const _look = new THREE.Vector3(), _tp = new THREE.Vector3(), _tl = new THREE.Vector3();

// ---- 入力（マウスだけ） ----
function setPointer(e) {
  const w = window.innerWidth, h = window.innerHeight, s = Math.min(w, h) * 0.5 * 0.82;
  input.rx = clamp((e.clientX - w / 2) / s, -1, 1);
  input.ry = clamp((e.clientY - h / 2) / s, -1, 1);
  input.px = e.clientX; input.py = e.clientY;
}
function centerPointer() { input.rx = 0; input.ry = 0; input.down = false; input.px = window.innerWidth / 2; input.py = window.innerHeight / 2; }
window.addEventListener('pointermove', setPointer);
window.addEventListener('pointerdown', (e) => {
  if (e.target.closest && e.target.closest('button')) return;
  if (e.button !== 0) return;
  setPointer(e);
  audio.start();
  if (game.state === 'title') startGame(); else input.down = true;
});
window.addEventListener('pointerup', () => { input.down = false; });
window.addEventListener('pointercancel', () => { input.down = false; });
document.addEventListener('mouseleave', centerPointer);
window.addEventListener('blur', centerPointer);
document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());
ui.el.mute.addEventListener('click', () => {
  audio.start();
  audio.setMuted(!audio.muted);
  ui.el.mute.classList.toggle('muted', audio.muted);
});
ui.el.again.addEventListener('click', () => {
  if (game.state !== 'result') return;
  game.state = 'restarting';
  ui.fade(true);
  ui.result(false);
  setTimeout(() => { startGame(); ui.fade(false); }, 650);
});

const DZ = 0.075;
function shape(v) {
  const a = Math.abs(v);
  if (a < DZ) return 0;
  return Math.sign(v) * Math.pow((a - DZ) / (1 - DZ), 1.35);
}

// ---- 進行 ----
function startGame() {
  game.state = 'flying';
  game.dayT = 0; game.score = 0; game.combo = 0; game.maxCombo = 0; game.flights++;
  game.hintTimer = 9; game.sinceStart = 0;
  player.bounce.set(0, 0, 0);
  course.reset(player.pos, player.yaw, 44, 3);
  ui.title(false); ui.result(false); ui.goodnight(false);
  ui.showGame(true); ui.hint(true);
  ui.el.countNum.textContent = '0'; ui.setCombo(0);
  audio.start(); audio.startChime();
}
function endFlight() {
  game.state = 'ending'; game.endTimer = 0;
  ui.showGame(false); ui.goodnight(true);
}
function showResult() {
  game.state = 'result';
  ui.goodnight(false);
  ui.result(true, game.score, game.maxCombo);
  audio.jingle();
}

const events = {
  onHit(ring, skipped) {
    fx.ringBurst(ring.pos, ring.n, player.speed, ring.color);
    cam.shake = Math.max(cam.shake, 0.7); cam.fovKick = 1;
    if (game.state !== 'flying') return;
    game.combo = skipped > 0 ? 1 : game.combo + 1;
    game.score++;
    game.maxCombo = Math.max(game.maxCombo, game.combo);
    hitStop = 0.045;
    audio.ring(game.combo);
    ui.setCount(game.score); ui.setCombo(game.combo);
    if (game.combo >= 5 && game.combo % 5 === 0) { audio.flourish(game.combo); ui.cheer(game.combo); }
  },
  onMiss() { if (game.state === 'flying') { game.combo = 0; ui.setCombo(0); } },
  onReroute() { if (game.state === 'flying') { game.combo = 0; ui.setCombo(0); } },
};

// ---- 自動操縦（タイトル背景・デバッグ・終幕で共用） ----
function autopilot(dt, wantBoost) {
  const r = course.next();
  if (!r) return { mx: 0, my: 0, boost: false };
  _v.copy(r.pos);
  const d = _v2.copy(r.pos).sub(player.pos).length();
  const act = course.rings.filter((x) => x.state === 'active');
  if (d < 26 && act[1]) _v.lerp(act[1].pos, (1 - d / 26) * 0.6);
  _v.sub(player.pos);
  const yawErr = wrapAngle(Math.atan2(_v.x, _v.z) - player.yaw);
  const wantPitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
  autoBoostT += dt;
  const boost = wantBoost && Math.abs(yawErr) < 0.2 && (autoBoostT % 9) < 3.5;
  return { mx: clamp(-yawErr * 2.4, -1, 1), my: clamp((-wantPitch * 1.7) / 0.62, -1, 1), boost };
}

function bounceFrom(nx, ny, nz, power) {
  player.bounce.x += nx * power; player.bounce.y += ny * power; player.bounce.z += nz * power;
  // 向かっていく成分を打ち消して、よそへ向き直る
  const fx_ = Math.sin(player.yaw), fz_ = Math.cos(player.yaw);
  const hl = Math.hypot(nx, nz);
  if (hl > 0.3) {
    const ux = nx / hl, uz = nz / hl, dot = fx_ * ux + fz_ * uz;
    if (dot < 0) { const rx = fx_ - 1.6 * dot * ux, rz = fz_ - 1.6 * dot * uz; player.yaw = Math.atan2(rx, rz); }
  }
  cat.squash = 1;
  cam.shake = Math.max(cam.shake, 0.5);
  if (player.bounceCool <= 0) { audio.bounce(); player.bounceCool = 0.25; }
}

function updatePlayer(dt, ctl) {
  player.bounceCool -= dt;
  player.yawRate = damp(player.yawRate, -ctl.mx * 1.3, 5, dt);
  player.yaw += player.yawRate * dt;
  let pitchT = -ctl.my * 0.62;
  const p = player.pos;
  const sx = Math.sin(player.yaw), cz = Math.cos(player.yaw);
  // 前方の地形を見て、やさしく機首を上げる
  for (const dist of [22, 50, 85]) {
    const sAhead = surfaceAt(p.x + sx * dist, p.z + cz * dist);
    if (sAhead < 0.01) continue; // 海は障害物ではない
    const need = Math.atan2(sAhead + 9 - p.y, dist);
    if (need > pitchT) pitchT = lerp(pitchT, Math.min(need, 0.8), 0.9);
  }
  const here = surfaceAt(p.x, p.z), clearance = p.y - here;
  if (here < 0.01) {
    // 海の上: 水面すれすれで自然に水平へ戻る（押し続ければ水を切って飛べる）
    if (clearance < 10) pitchT = Math.max(pitchT, (1 - clearance / 10) * 0.8 - 0.5);
  } else if (clearance < 5) pitchT = Math.max(pitchT, (1 - clearance / 5) * 0.3);
  if (p.y > 205) pitchT -= ((p.y - 205) / 45) * 0.7;
  pitchT = clamp(pitchT, -0.72, 0.8);
  player.pitch = damp(player.pitch, pitchT, 3.2, dt);
  player.roll = damp(player.roll, clamp(ctl.mx * 0.72 - player.yawRate * 0.1, -0.85, 0.85), 5.5, dt);
  player.speed = damp(player.speed, ctl.boost ? BOOST_SPEED : BASE_SPEED, ctl.boost ? 2.6 : 1.6, dt);
  player.boost = clamp((player.speed - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED), 0, 1);

  const cp = Math.cos(player.pitch);
  fwd.set(Math.sin(player.yaw) * cp, Math.sin(player.pitch), Math.cos(player.yaw) * cp);
  p.addScaledVector(fwd, player.speed * dt).addScaledVector(player.bounce, dt);
  player.bounce.multiplyScalar(Math.exp(-3.2 * dt));

  // リングへの、ごく弱い吸い寄せ（初めての人向け）
  const nx = course.next();
  if (nx) {
    _v.copy(nx.pos).sub(p);
    const ahead = _v.dot(nx.n);
    if (ahead > 0 && ahead < 46) {
      _v.addScaledVector(nx.n, -ahead);
      const off = _v.length();
      if (off < 17) p.addScaledVector(_v, Math.min(dt * 1.1 * (1 - off / 17) * 1.4, 0.5));
    }
  }

  // 地面・海面: ふわっと跳ね返るだけ
  const h = solidAt(p.x, p.z);
  if (h > 0 && p.y < h + 2.4) {
    const e = 5, gx = solidAt(p.x + e, p.z) - solidAt(p.x - e, p.z), gz = solidAt(p.x, p.z + e) - solidAt(p.x, p.z - e);
    _v.set(-gx, 2 * e, -gz).normalize();
    p.y = h + 2.4;
    player.pitch = Math.max(player.pitch, 0.28);
    bounceFrom(_v.x, _v.y, _v.z, 20);
    const s = sampleTerrain(p.x, p.z);
    fx.puff(p.x, p.y, p.z, 12, 5, 1, 0.97, 0.9, 0.7);
    if (s.isl) fx.petals(p.x, h, p.z, 0, 0, s.isl.type !== 'green');
  } else if (h <= 0 && p.y < 1.7) {
    p.y = 1.7;
    player.pitch = Math.max(player.pitch, 0.22);
    player.bounce.y += 15;
    cat.squash = 1;
    for (let i = 0; i < 5; i++) fx.splash(p.x, p.z, fwd.x * player.speed, fwd.z * player.speed, 1.6);
    if (player.bounceCool <= 0) { audio.splashHit(); player.bounceCool = 0.3; }
  }
  // ランドマーク
  for (const c of landmarks.colliders) {
    const d = capsuleDist(c, p.x, p.y, p.z, _c);
    const rr = c.r + 2.2;
    if (d < rr && d > 0.001) {
      _v.copy(p).sub(_c).multiplyScalar(1 / d);
      p.copy(_c).addScaledVector(_v, rr);
      bounceFrom(_v.x, _v.y * 0.6 + 0.3, _v.z, 24);
      fx.puff(p.x, p.y, p.z, 10, 5, 1, 0.97, 0.9, 0.7);
    }
  }
}

function worldReactions(dt) {
  const p = player.pos;
  const h = heightAt(p.x, p.z);
  // 1) 水面すれすれで水しぶきと航跡
  let lvl = 0;
  if (h < 0 && p.y < 11) {
    lvl = 1 - p.y / 11;
    splashAcc += dt * (22 + player.speed * 0.4);
    while (splashAcc > 1) { splashAcc -= 1; fx.splash(p.x - fwd.x * 2, p.z - fwd.z * 2, fwd.x * player.speed, fwd.z * player.speed, lvl); }
  }
  splashLevel = damp(splashLevel, lvl, 8, dt);
  // 2) 島の上を低く飛ぶと、花びらが舞い上がる
  if (h > 5 && p.y - h < 15) {
    petalAcc += dt * 16;
    const s = sampleTerrain(p.x, p.z);
    while (petalAcc > 1) { petalAcc -= 1; fx.petals(p.x, h + 1, p.z, fwd.x * player.speed, fwd.z * player.speed, !s.isl || s.isl.type !== 'green'); }
  }
  // 3) 雲をくぐると、ふわっと散る
  const c = clouds.check(p);
  if (c) { fx.puff(p.x + fwd.x * 8, p.y, p.z + fwd.z * 8, 34, 12, 1, 1, 1, 0.5); audio.whoosh(); }
  // 4) 湯のみの湯気は上昇気流
  steamAcc += dt;
  const emit = steamAcc > 0.1;
  if (emit) steamAcc = 0;
  for (const s of landmarks.steams) {
    const dx = p.x - s.x, dz = p.z - s.z, d2 = dx * dx + dz * dz;
    if (emit && d2 < 900 * 900) fx.steam(s);
    if (d2 < 46 * 46 && p.y > s.y - 6 && p.y < s.y + 130) player.bounce.y += 95 * dt;
  }
  if (player.boost > 0.25) fx.sparkleTrail(p.x - fwd.x * 4, p.y + 0.4, p.z - fwd.z * 4, fwd.x * 8, 0, fwd.z * 8);
}

function updateCamera(dt, rawDt) {
  cam.yaw = dampAngle(cam.yaw, player.yaw, 3.4, dt);
  cam.pitch = damp(cam.pitch, player.pitch * 0.55, 3, dt);
  const cp = Math.cos(cam.pitch);
  _v.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
  const back = 12.5 + player.boost * 3;
  _v2.copy(player.pos).addScaledVector(_v, -back); _v2.y += 4.4;
  if (!cam.inited) { cam.pos.copy(_v2); cam.inited = true; }
  cam.pos.x = damp(cam.pos.x, _v2.x, 10, dt); cam.pos.y = damp(cam.pos.y, _v2.y, 7, dt); cam.pos.z = damp(cam.pos.z, _v2.z, 10, dt);
  _look.copy(player.pos).addScaledVector(_v, 14); _look.y += 2.4;

  // タイトルと終幕は、ねこの横顔が見える引きのカメラ。リザルトではカードの横にねこを置く
  const cinematic = game.state === 'title' || game.state === 'ending' || game.state === 'result';
  const target = cinematic ? 1 : 0;
  cam.side = damp(cam.side, game.state === 'result' || game.state === 'ending' ? 1 : 0, 1.5, rawDt);
  cam.blend = damp(cam.blend, target, target ? 2 : 1.7, rawDt);
  const b = cam.blend * cam.blend * (3 - 2 * cam.blend);
  camera.position.copy(cam.pos);
  if (b > 0.001) {
    const a = player.yaw + 2.15 + Math.sin(game.time * 0.11) * 0.3;
    _tp.set(player.pos.x + Math.sin(a) * 17, player.pos.y + 0.9 + Math.sin(game.time * 0.17) * 1.0, player.pos.z + Math.cos(a) * 17);
    _tl.copy(player.pos); _tl.y += 2.6 - cam.side * 2.2;
    if (cam.side > 0.001 && window.innerWidth > 900) {
      const dx = _tl.x - _tp.x, dz = _tl.z - _tp.z, dl = Math.hypot(dx, dz) || 1;
      _tl.x += (-dz / dl) * 5.5 * cam.side; _tl.z += (dx / dl) * 5.5 * cam.side;
    }
    camera.position.lerp(_tp, b);
    _look.lerp(_tl, b);
  }
  const floor = surfaceAt(camera.position.x, camera.position.z) + 2.2;
  if (camera.position.y < floor) camera.position.y = floor;
  cam.shake = Math.max(0, cam.shake - rawDt * 4.5);
  cam.fovKick = Math.max(0, cam.fovKick - rawDt * 4);
  if (cam.shake > 0) {
    const s = cam.shake * cam.shake * 0.4;
    camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s;
  }
  camera.lookAt(_look);
  if (debugLook) { _v.set(Math.cos(debugLook.el) * Math.sin(debugLook.az), Math.sin(debugLook.el), Math.cos(debugLook.el) * Math.cos(debugLook.az)); camera.lookAt(_v.add(camera.position)); }
  camera.rotateZ(-player.roll * 0.16 * (1 - b));
  const fov = 62 + player.boost * 15 + cam.fovKick * 2.5;
  if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

function updateArrow() {
  const r = course.next();
  if (!r || game.state !== 'flying') return ui.arrow(false);
  _v.copy(r.pos).project(camera);
  _v2.copy(r.pos).applyMatrix4(camera.matrixWorldInverse);
  const behind = _v2.z > 0;
  let x = _v.x, y = _v.y;
  if (behind) { x = -x; y = -y; }
  if (!behind && Math.abs(x) < 0.88 && Math.abs(y) < 0.84) return ui.arrow(false);
  const ang = Math.atan2(y, x), w = window.innerWidth, h = window.innerHeight;
  ui.arrow(true, w / 2 + Math.cos(ang) * w * 0.4, h / 2 - Math.sin(ang) * h * 0.38, 90 - (ang * 180) / Math.PI);
}

// ---- 毎フレーム ----
let last = performance.now(), frames = 0, ftAcc = 0, ftN = 0, fps = 60, warm = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min((now - last) / 1000, 1 / 15);
  const realMs = now - last;
  last = now;
  game.time += rawDt;
  let dt = rawDt;
  if (hitStop > 0) { hitStop -= rawDt; dt = 0; }

  const human = game.state === 'flying' && !AUTOPILOT;
  // 開始直後は舵を預かり、1個目のリングをまっすぐくぐらせてから、少しずつ操作を渡す
  game.sinceStart += dt;
  const authority = smoothstep(1.1, 3.0, game.sinceStart);
  const ctl = human ? { mx: shape(input.rx) * authority, my: shape(input.ry) * authority, boost: input.down } : autopilot(dt, AUTOPILOT && game.state === 'flying');
  prevPos.copy(player.pos);
  if (dt > 0) {
    updatePlayer(dt, ctl);
    worldReactions(dt);
    course.sunAz = env.sunAz; // 夕方は太陽のある方角へ道を寄せる
    course.sunBias = smoothstep(0.5, 0.58, game.dayT) * (1 - smoothstep(0.8, 0.84, game.dayT));
    course.update(dt, game.time, prevPos, player.pos, player.yaw, events);
  }

  if (game.state === 'flying') {
    game.dayT += (dt / DAY_LENGTH) * TIMESCALE;
    if (game.hintTimer > 0) { game.hintTimer -= dt; if (game.hintTimer <= 0) ui.hint(false); }
    if (game.dayT >= 1) { game.dayT = 1; endFlight(); }
  } else if (game.state === 'ending') {
    game.endTimer += rawDt;
    if (game.endTimer > 2.8) showResult();
  }

  terrain.update(player.pos.x, player.pos.z, 1);
  landmarks.update(player.pos.x, player.pos.z, game.time, 1);
  cat.root.position.copy(player.pos);
  cat.root.rotation.set(-player.pitch, player.yaw, 0, 'YXZ');
  cat.update(dt, game.time, player.roll, player.boost, clamp(-player.yawRate, -1, 1));
  updateCamera(dt, rawDt);
  camera.updateMatrixWorld();
  env.update(game.dayT, game.time, camera, pixelRatio());
  clouds.update(player.pos.x, player.pos.z, dt, game.time, env);
  water.update(player.pos.x, player.pos.z, game.time, env, scene.fog);
  fx.setView(window.innerHeight * pixelRatio(), camera.fov, scene.fog);
  fx.update(dt, game.time, player, fwd, camera, surfaceAt(player.pos.x, player.pos.z), env.night);
  if (bloom) bloom.strength = 0.36 + env.night * 0.34;
  audio.frame(game.dayT, player.speed / BOOST_SPEED, player.boost, splashLevel);

  if (game.state === 'flying') { ui.dial(game.dayT); ui.reticle(input.px, input.py, window.innerWidth, window.innerHeight); }
  updateArrow();

  stats.draw = renderer.info.render.calls; stats.tris = renderer.info.render.triangles;
  renderer.info.reset();
  if (composer) composer.render(); else renderer.render(scene, camera);

  // 重い環境では画質を段階的に下げる
  frames++;
  if (!document.hidden && realMs < 250) {
    if (warm < 45) warm++;
    else { ftAcc += realMs; ftN++; }
    if (ftN >= 80) {
      const avg = ftAcc / ftN;
      fps = 1000 / avg;
      if (QUALITY_LOCK === null && avg > 25 && quality < 3) { quality++; buildComposer(); warm = 0; }
      ftAcc = 0; ftN = 0;
    }
  }
}

// ---- デバッグ用の窓 ----
window.__game = {
  get state() { return game.state; },
  get score() { return game.score; },
  get combo() { return game.combo; },
  get maxCombo() { return game.maxCombo; },
  get dayT() { return game.dayT; },
  get timeOfDay() { return dayLabel(game.dayT); },
  get player() { return { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, roll: player.roll, speed: player.speed, boost: player.boost }; },
  get fps() { return Math.round(fps); },
  get quality() { return quality; },
  get frames() { return frames; },
  get nextRingDistance() { const r = course.next(); return r ? r.pos.distanceTo(player.pos) : null; },
  get errors() { return errors; },
  get audio() { return audio.level(); },
  get info() { return { chunks: terrain.chunks.size, landmarks: landmarks.cells.size, colliders: landmarks.colliders.length, draw: stats.draw, tris: stats.tris }; },
  autopilot: AUTOPILOT, timescale: TIMESCALE,
  setDay(t) { game.dayT = clamp(t, 0, 1); },
  look(azDeg, elDeg) { debugLook = azDeg === undefined ? null : { az: (azDeg * Math.PI) / 180, el: (elDeg * Math.PI) / 180 }; },
  get sun() { return { az: (env.sunAz * 180) / Math.PI, moon: env.moonDir.toArray() }; },
  start() { if (game.state === 'title') startGame(); },
};

// ---- 起動 ----
terrain.update(player.pos.x, player.pos.z, Infinity);
landmarks.prewarm(player.pos.x, player.pos.z);
player.pos.y = Math.max(player.pos.y, surfaceAt(player.pos.x, player.pos.z) + 30);
course.reset(player.pos, player.yaw, 60, 2);
ui.loaded();
requestAnimationFrame((t) => { last = t; frame(t); });
