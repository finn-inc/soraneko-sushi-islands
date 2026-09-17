// 音はすべて Web Audio API で合成する。調は G のヨナ抜き（五音音階）
import { clamp, smoothstep } from './util.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const STEP = 60 / 100 / 4; // 16分音符（テンポ100）
const SCALE = [67, 69, 71, 74, 76, 79, 81, 83, 86, 88, 91];

const CHORDS = {
  G: { pad: [55, 62, 71], bass: 43, arp: [55, 62, 67, 71, 74, 71, 67, 62] },
  Em: { pad: [52, 59, 67], bass: 40, arp: [52, 59, 64, 67, 71, 67, 64, 59] },
  C: { pad: [48, 55, 62, 64], bass: 36, arp: [48, 55, 60, 64, 67, 64, 62, 55] },
  D: { pad: [50, 57, 64], bass: 38, arp: [50, 57, 62, 64, 69, 64, 62, 57] },
};
const PROG = ['G', 'Em', 'C', 'D', 'Em', 'C', 'G', 'D'];
// 旋律 [開始ステップ, 音, 長さ]
const MEL = [
  [[0, 71, 6], [6, 74, 2], [8, 76, 8]],
  [[0, 74, 4], [4, 71, 4], [8, 69, 6], [14, 67, 2]],
  [[0, 69, 4], [4, 71, 2], [6, 74, 2], [8, 76, 6], [14, 79, 2]],
  [[0, 76, 4], [4, 74, 4], [8, 74, 8]],
  [[0, 79, 6], [6, 76, 2], [8, 74, 4], [12, 76, 4]],
  [[0, 79, 4], [4, 76, 4], [8, 74, 2], [10, 71, 2], [12, 69, 4]],
  [[0, 71, 4], [4, 74, 4], [8, 76, 4], [12, 74, 2], [14, 71, 2]],
  [[0, 69, 6], [6, 71, 2], [8, 69, 8]],
];

export class GameAudio {
  constructor() {
    this.ctx = null; this.muted = false; this.dayT = 0; this.step = 0; this.nextTime = 0;
    this.speed = 0; this.boost = 0; this.splashLevel = 0;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; comp.connect(this.analyser);
    this._buf = new Float32Array(2048);

    // 残響（ノイズから作るインパルス応答）
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const rev = ctx.createConvolver(); rev.buffer = ir;
    const revGain = ctx.createGain(); revGain.gain.value = 0.34;
    rev.connect(revGain); revGain.connect(master);
    this.rev = rev;

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 9000;
    this.music = ctx.createGain(); this.music.gain.value = 0.0;
    this.music.connect(this.musicFilter); this.musicFilter.connect(master);
    this.musicSend = ctx.createGain(); this.musicSend.gain.value = 0.5;
    this.musicFilter.connect(this.musicSend); this.musicSend.connect(rev);
    this.music.gain.setTargetAtTime(0.9, ctx.currentTime, 1.2);

    const bus = (g) => { const n = ctx.createGain(); n.gain.value = g; n.connect(this.music); return n; };
    this.bKoto = bus(0.5); this.bPad = bus(0.2); this.bFlute = bus(0.0); this.bPerc = bus(0.0); this.bBass = bus(0.0);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(master);
    const sfxSend = ctx.createGain(); sfxSend.gain.value = 0.45; this.sfx.connect(sfxSend); sfxSend.connect(rev);

    this.kotoWave = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.56, 0.34, 0.2, 0.13, 0.08, 0.05, 0.03]));

    // ノイズ
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;

    // 風
    const wind = ctx.createBufferSource(); wind.buffer = nb; wind.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wind.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(master);
    wind.start();
    // 水しぶき
    const spray = ctx.createBufferSource(); spray.buffer = nb; spray.loop = true; spray.playbackRate.value = 1.3;
    const sf = ctx.createBiquadFilter(); sf.type = 'highpass'; sf.frequency.value = 2400;
    this.sprayGain = ctx.createGain(); this.sprayGain.gain.value = 0;
    spray.connect(sf); sf.connect(this.sprayGain); this.sprayGain.connect(master);
    spray.start();

    this.nextTime = ctx.currentTime + 0.12;
    this.timer = setInterval(() => this._schedule(), 30);
  }

  // デバッグ用: いま鳴っている音の大きさ
  level() {
    if (!this.ctx) return { running: false, peak: 0, rms: 0 };
    this.analyser.getFloatTimeDomainData(this._buf);
    let peak = 0, sum = 0;
    for (const v of this._buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
    return { running: this.ctx.state === 'running', peak, rms: Math.sqrt(sum / this._buf.length) };
  }

  // タブが隠れている間は音を止める
  setHidden(hidden) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend(); else this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // 毎フレーム: 時間帯・速度を音に反映
  frame(dayT, speedNorm, boost, splash) {
    this.dayT = dayT;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const day = smoothstep(0.04, 0.14, dayT), eve = smoothstep(0.56, 0.66, dayT), night = smoothstep(0.8, 0.9, dayT);
    this.bPerc.gain.setTargetAtTime(0.55 * day * (1 - night), t, 0.8);
    this.bBass.gain.setTargetAtTime(0.5 * day * (1 - night * 0.45), t, 0.8);
    this.bFlute.gain.setTargetAtTime((0.24 * day + 0.12 * eve) * (1 - night * 0.35), t, 0.8);
    this.bPad.gain.setTargetAtTime(0.2 + eve * 0.08 + night * 0.08, t, 0.8);
    this.bKoto.gain.setTargetAtTime(0.5 - night * 0.08, t, 0.8);
    this.musicFilter.frequency.setTargetAtTime(9000 - night * 6200, t, 1.0);
    this.windFilter.frequency.setTargetAtTime(380 + speedNorm * 500 + boost * 700, t, 0.15);
    this.windGain.gain.setTargetAtTime(0.035 + speedNorm * 0.03 + boost * 0.11, t, 0.15);
    this.sprayGain.gain.setTargetAtTime(clamp(splash, 0, 1) * 0.16, t, 0.08);
  }

  _schedule() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.25) {
      this._step(this.step, this.nextTime);
      this.step++;
      this.nextTime += STEP;
    }
  }

  _step(step, t) {
    const bar = Math.floor(step / 16) % 16, s = step % 16;
    const chord = CHORDS[PROG[bar % 8]];
    const night = this.dayT > 0.85, eve = this.dayT > 0.58 && !night;
    if (s === 0) this._pad(t, chord.pad, STEP * 16);
    // 琴のアルペジオ
    if (s % 2 === 0) {
      const i = s / 2;
      const sparse = night && (i % 2 === 1) && i !== 7;
      if (!sparse) this._koto(t + (i % 2 ? 0.012 : 0), chord.arp[i] + (bar >= 8 && i >= 3 && i <= 5 ? 12 : 0), i === 0 ? 0.5 : 0.3, this.bKoto);
    }
    if (bar === 15 && s >= 8 && !night) this._koto(t, SCALE[(s - 8) % SCALE.length] + 0, 0.16, this.bKoto);
    // 旋律（尺八ふう）
    if (bar < 12) {
      for (const [st, note, len] of MEL[bar % 8]) if (st === s) this._flute(t, note + (night ? -12 : 0), len * STEP, eve ? 1.0 : 0.85);
    }
    // 低音と打ちもの
    if (s === 0 || s === 10) this._bass(t, chord.bass, s === 0 ? 0.9 : 0.6);
    if (s === 6 && bar % 2 === 1) this._bass(t, chord.bass + 7, 0.5);
    if (s === 0 || s === 8 || (s === 14 && bar % 4 === 3)) this._taiko(t, s === 0 ? 0.8 : 0.5);
    if (s === 4 || s === 12) this._click(t, 0.3, 1900);
    if (s % 4 === 2) this._click(t, 0.1, 5200);
  }

  _koto(t, midi, vel, dest) {
    const ctx = this.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.setPeriodicWave(this.kotoWave);
    o.frequency.value = mtof(midi);
    o.detune.setValueAtTime(28, t); o.detune.exponentialRampToValueAtTime(0.01, t + 0.07);
    f.type = 'lowpass'; f.frequency.setValueAtTime(7000, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.7);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.5);
    o.connect(f); f.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 1.55);
  }

  _flute(t, midi, dur, vel) {
    const ctx = this.ctx, fr = mtof(midi);
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = fr; o2.frequency.value = fr * 2;
    o.detune.setValueAtTime(-45, t); o.detune.linearRampToValueAtTime(0, t + 0.09);
    lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(fr * 0.011, t + Math.min(dur, 0.5));
    lfo.connect(lg); lg.connect(o.frequency);
    const g2 = ctx.createGain(); g2.gain.value = 0.12;
    o2.connect(g2); g2.connect(g); o.connect(g);
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = fr * 2; nf.Q.value = 3;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.22, t); ng.gain.exponentialRampToValueAtTime(0.04, t + 0.15);
    n.connect(nf); nf.connect(ng); ng.connect(g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.07);
    g.gain.setValueAtTime(vel * 0.5, t + Math.max(dur - 0.08, 0.08)); g.gain.linearRampToValueAtTime(0, t + dur + 0.16);
    g.connect(this.bFlute);
    const end = t + dur + 0.2;
    for (const x of [o, o2, lfo, n]) { x.start(t); x.stop(end); }
  }

  _pad(t, notes, dur) {
    const ctx = this.ctx;
    for (const m of notes) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = mtof(m + 12); o.detune.value = det;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11, t + 0.7);
      g.gain.setValueAtTime(0.11, t + dur - 0.2); g.gain.linearRampToValueAtTime(0, t + dur + 1.2);
      o.connect(g); g.connect(this.bPad);
      o.start(t); o.stop(t + dur + 1.3);
    }
  }

  _bass(t, midi, vel) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(midi + 12);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.55, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g); g.connect(this.bBass);
    o.start(t); o.stop(t + 0.75);
  }

  _taiko(t, vel, dest = this.bPerc) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.22);
    g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.42);
    this._click(t, vel * 0.25, 900, dest);
  }

  _click(t, vel, freq, dest = this.bPerc) {
    const ctx = this.ctx, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.noise;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2.5;
    g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(f); f.connect(g); g.connect(dest);
    n.start(t, Math.random()); n.stop(t + 0.08);
  }

  _bell(t, midi, vel, dur = 0.7) {
    const ctx = this.ctx;
    for (const [mul, v] of [[1, 1], [2.01, 0.4], [3.0, 0.15]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = mtof(midi) * mul;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + dur / mul);
      o.connect(g); g.connect(this.sfx);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  comboNote(combo) {
    const i = combo - 1;
    return SCALE[i <= 10 ? i : 6 + ((i - 6) % 5)];
  }

  // リング通過: コンボが続くほど五音音階を1音ずつ上がる
  ring(combo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, m = this.comboNote(combo);
    this._koto(t, m, 0.55, this.sfx);
    this._bell(t, m + 12, 0.2);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.09);
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.15);
  }
  // コンボの節目: 駆け上がる飾り
  flourish(combo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, base = SCALE.indexOf(this.comboNote(combo));
    for (let k = 1; k <= 4; k++) this._bell(t + 0.05 + k * 0.055, SCALE[Math.min(base + k, SCALE.length - 1)] + (base + k >= SCALE.length ? 12 : 0), 0.16, 0.5);
  }
  bounce() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._taiko(t, 0.55, this.sfx);
    this._koto(t, 55, 0.25, this.sfx);
  }
  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.noise; n.loop = true;
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.25); f.frequency.exponentialRampToValueAtTime(260, t + 0.8);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.2); g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    n.connect(f); f.connect(g); g.connect(this.sfx);
    n.start(t); n.stop(t + 0.9);
  }
  splashHit() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.noise;
    f.type = 'bandpass'; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.4); f.Q.value = 0.8;
    g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(f); f.connect(g); g.connect(this.sfx);
    n.start(t, Math.random()); n.stop(t + 0.55);
  }
  startChime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    [67, 74, 79].forEach((m, i) => { this._koto(t + i * 0.09, m, 0.4, this.sfx); this._bell(t + i * 0.09, m + 12, 0.1); });
  }
  jingle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.1;
    [67, 71, 74, 79].forEach((m, i) => { this._koto(t + i * 0.14, m, 0.5, this.sfx); this._bell(t + i * 0.14, m, 0.12); });
    const t2 = t + 0.62;
    [55, 62, 67, 71, 74, 79].forEach((m, i) => this._koto(t2 + i * 0.018, m, 0.42, this.sfx));
    [79, 81, 83, 86, 88, 91].forEach((m, i) => this._bell(t2 + 0.25 + i * 0.07, m, 0.1, 0.9));
    this._taiko(t2, 0.7, this.sfx);
  }
}
