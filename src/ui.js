// 最小限の UI（DOM）
const $ = (id) => document.getElementById(id);

const RANKS = [
  [0, 'がりをかじる 子ねこ', 'まずは ひとくち。空はひろいよ'],
  [8, 'かっぱ巻き 見習い', 'きゅうりの風を おぼえた'],
  [20, '回転ずしの 常連ねこ', 'レーンの流れが 見えてきた'],
  [35, 'サーモン好きの 風来ねこ', '夕焼けと同じ色が いちばん好き'],
  [50, '中とろ級の そらねこ', 'とろける飛びっぷり'],
  [65, '大とろ級の そらねこ', '板前さんも 二度見する'],
  [80, 'すし諸島の 大将ねこ', 'へい、らっしゃい。空ごと握った'],
];
const CHEERS = ['いいね！', 'うまい！', 'へい お待ち！', '大漁！', '特上！', 'おまかせ！', '天晴れ！'];

export function rankFor(count) {
  let r = RANKS[0];
  for (const x of RANKS) if (count >= x[0]) r = x;
  return r;
}

export class UI {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'countNum', 'combo', 'comboNum', 'cheer', 'hint', 'reticle', 'retRing', 'retDot', 'retLine', 'arrow', 'boost', 'title', 'result', 'rank', 'rankNote', 'resCount', 'resCombo', 'again', 'mute', 'fade', 'loading', 'goodnight', 'dialSun', 'dialProg']) this.el[id] = $(id);
    this.cheerTimer = 0; this.comboShown = 0;
  }
  pop(el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  setCount(n) { this.el.countNum.textContent = n; this.pop(this.el.countNum); }
  setCombo(n) {
    const e = this.el;
    if (n >= 2) {
      e.comboNum.textContent = n;
      e.combo.classList.add('on');
      this.pop(e.comboNum);
    } else e.combo.classList.remove('on');
  }
  cheer(combo) {
    const e = this.el.cheer;
    e.textContent = CHEERS[Math.min(Math.floor(combo / 5) - 1, CHEERS.length - 1)];
    e.classList.add('on');
    clearTimeout(this.cheerTimer);
    this.cheerTimer = setTimeout(() => e.classList.remove('on'), 1400);
  }
  showGame(on) {
    this.el.hud.classList.toggle('on', on);
    this.el.reticle.classList.toggle('on', on);
    this.el.boost.classList.toggle('on', on);
    if (!on) { this.el.combo.classList.remove('on'); this.el.arrow.classList.remove('on'); this.el.hint.classList.remove('on'); }
  }
  hint(on) { this.el.hint.classList.toggle('on', on); }
  title(on) { this.el.title.classList.toggle('off', !on); }
  goodnight(on) { this.el.goodnight.classList.toggle('on', on); }
  fade(on) { this.el.fade.classList.toggle('on', on); }
  loaded() { this.el.loading.classList.add('off'); setTimeout(() => (this.el.loading.style.display = 'none'), 900); }
  result(on, count = 0, combo = 0) {
    this.el.result.classList.toggle('on', on);
    if (!on) return;
    const r = rankFor(count);
    this.el.rank.textContent = r[1];
    this.el.rankNote.textContent = r[2];
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min((performance.now() - t0) / 1100, 1), e = 1 - Math.pow(1 - k, 3);
      this.el.resCount.textContent = Math.round(count * e);
      this.el.resCombo.textContent = Math.round(combo * e);
      if (k < 1) requestAnimationFrame(tick);
    };
    tick();
  }
  dial(t) {
    const a = Math.PI * (1 - t);
    const x = 66 + Math.cos(a) * 56, y = 54 - Math.sin(a) * 56;
    const s = this.el.dialSun;
    s.setAttribute('cx', x.toFixed(1)); s.setAttribute('cy', y.toFixed(1));
    s.setAttribute('fill', t < 0.55 ? '#ffe08a' : t < 0.82 ? '#ff9a5a' : '#dfe6ff');
    this.el.dialProg.setAttribute('stroke-dasharray', `${(t * 100).toFixed(1)} 100`);
  }
  // マウス: 中心の輪からカーソルへ線を引く / タッチ: 指を置いた位置 (ax, ay) に輪を出し、指先へ線を引く
  reticle(px, py, w, h, ax = w / 2, ay = h / 2) {
    const ox = ax - w / 2, oy = ay - h / 2;
    this.el.retDot.style.transform = `translate(${px}px, ${py}px)`;
    this.el.retRing.style.transform = `translate(${ox}px, ${oy}px)`;
    const dx = px - ax, dy = py - ay, len = Math.hypot(dx, dy);
    this.el.retLine.style.transform = `translate(${ox}px, ${oy}px) rotate(${Math.atan2(dy, dx)}rad) scaleX(${Math.max(len - 8, 0) / 100})`;
  }
  stickIdle(idle) { this.el.reticle.classList.toggle('idle', idle); }
  arrow(on, x = 0, y = 0, deg = 0) {
    this.el.arrow.classList.toggle('on', on);
    if (on) this.el.arrow.style.transform = `translate(${x}px, ${y}px) rotate(${deg}deg)`;
  }
}
