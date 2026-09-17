// 検証一式: スクリーンショット / 自動操縦でのスコア増加 / 早送りで1日完走 / マウス入力
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.URL || 'http://127.0.0.1:8765/';
const GPU = process.env.GPU || 'metal';
const ONLY = process.env.ONLY || 'ABC';
const shots = new URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const args = GPU === 'swiftshader'
  ? ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl']
  : ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu', '--enable-webgl'];
const browser = await chromium.launch({ headless: true, args: [...args, '--autoplay-policy=no-user-gesture-required'] });
const results = {};
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!ok) failed = true; };

async function open(qs) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()}`));
  page.on('request', (r) => { if (!r.url().startsWith(BASE)) logs.push(`[external] ${r.url()}`); });
  await page.goto(BASE + qs);
  await page.waitForFunction(() => window.__game && window.__game.frames > 10, null, { timeout: 60000 });
  return { page, logs };
}
const G = (page) => page.evaluate(() => { const g = window.__game; return { state: g.state, score: g.score, combo: g.combo, maxCombo: g.maxCombo, dayT: g.dayT, tod: g.timeOfDay, p: g.player, fps: g.fps, q: g.quality, info: g.info, d: g.nextRingDistance }; });
const shot = (page, name) => page.screenshot({ path: `${shots}${name}.png` });

if (ONLY.includes('A')) {
  const { page, logs } = await open('?autopilot=1&quality=0');
  await page.waitForTimeout(2500);
  await shot(page, '1-title');
  check('title state', (await G(page)).state === 'title');
  await page.mouse.click(640, 400);
  await page.waitForTimeout(5000);
  await shot(page, '2-start5s');
  let g = await G(page);
  check('flying after click', g.state === 'flying', JSON.stringify({ score: g.score, combo: g.combo }));
  check('first rings collected within 5s', g.score >= 2, `score=${g.score}`);
  await page.waitForTimeout(12000);
  const g2 = await G(page);
  check('score keeps rising on autopilot', g2.score > g.score + 4, `${g.score} -> ${g2.score}, combo=${g2.combo}, max=${g2.maxCombo}`);
  check('combo builds', g2.maxCombo >= 5, `maxCombo=${g2.maxCombo}`);
  for (const [t, name, wait] of [[0.3, '3-noon', 5000], [0.5, '4a-golden', 12000], [0.66, '4-sunset', 5000], [0.725, '4b-horizon', 3000], [0.78, '4c-afterglow', 3000], [0.9, '5-night', 5000]]) {
    await page.evaluate((v) => window.__game.setDay(v), t);
    await page.waitForTimeout(wait);
    await shot(page, name);
    const s = await G(page);
    console.log(`   ${name}: tod=${s.tod} dayT=${s.dayT.toFixed(3)} score=${s.score} fps=${s.fps} q=${s.q} y=${s.p.y.toFixed(0)}`);
  }
  await page.evaluate(() => window.__game.setDay(0.997));
  await page.waitForFunction(() => window.__game.state === 'result', null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot(page, '6-result');
  const res = await page.evaluate(() => ({ rank: document.getElementById('rank').textContent, count: document.getElementById('resCount').textContent, combo: document.getElementById('resCombo').textContent }));
  check('result reached', true, JSON.stringify(res));
  await page.click('#again');
  await page.waitForTimeout(2500);
  g = await G(page);
  check('again restarts', g.state === 'flying' && g.dayT < 0.05 && g.score <= 3, JSON.stringify({ state: g.state, dayT: g.dayT, score: g.score }));
  await shot(page, '7-again');
  check('no console errors (run A)', logs.length === 0, logs.slice(0, 10).join('\n'));
  await page.close();
}

if (ONLY.includes('B')) {
  const { page, logs } = await open('?autopilot=1&timescale=12');
  await page.mouse.click(640, 400);
  const t0 = Date.now();
  await page.waitForFunction(() => window.__game.state === 'result', null, { timeout: 60000 });
  const g = await G(page);
  check('full day with timescale reaches result', true, `${((Date.now() - t0) / 1000).toFixed(1)}s score=${g.score} maxCombo=${g.maxCombo}`);
  check('no console errors (run B)', logs.length === 0, logs.slice(0, 10).join('\n'));
  await page.close();
}

if (ONLY.includes('C')) {
  const { page, logs } = await open('');
  // 実際の人と同じく、画面下の「クリックして とびたつ」を押して、そのまま手を止める
  await page.mouse.move(640, 600);
  await page.mouse.click(640, 600);
  await page.waitForTimeout(1500);
  const a = await G(page);
  check('first ring collected hands-free (cursor left on the start pill)', a.score >= 1, `score=${a.score}`);
  await shot(page, '2b-handover');
  await page.mouse.move(1100, 360, { steps: 8 });
  await page.waitForTimeout(1500);
  const b = await G(page);
  check('mouse right turns right (yaw decreases)', b.p.yaw < a.p.yaw - 0.3, `${a.p.yaw.toFixed(2)} -> ${b.p.yaw.toFixed(2)} roll=${b.p.roll.toFixed(2)}`);
  await shot(page, '8-bank');
  await page.mouse.move(640, 80, { steps: 8 });
  await page.waitForTimeout(1200);
  const c = await G(page);
  check('mouse up climbs', c.p.pitch > 0.25 && c.p.y > b.p.y, `pitch=${c.p.pitch.toFixed(2)} y ${b.p.y.toFixed(1)} -> ${c.p.y.toFixed(1)}`);
  await page.mouse.move(640, 360, { steps: 4 });
  await page.waitForTimeout(1500);
  const d = await G(page);
  check('centering levels out', Math.abs(d.p.pitch) < 0.15 && Math.abs(d.p.roll) < 0.1, `pitch=${d.p.pitch.toFixed(2)} roll=${d.p.roll.toFixed(2)}`);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  const e = await G(page);
  check('hold to boost', e.p.speed > d.p.speed + 15, `${d.p.speed.toFixed(1)} -> ${e.p.speed.toFixed(1)}`);
  await shot(page, '9-boost');
  await page.mouse.up();
  await page.waitForTimeout(2000);
  const f = await G(page);
  check('release slows down', f.p.speed < e.p.speed - 10, `${e.p.speed.toFixed(1)} -> ${f.p.speed.toFixed(1)}`);
  // 海へ突っ込んでも終わらない
  await page.mouse.move(640, 700, { steps: 4 });
  await page.waitForTimeout(6000);
  const h = await G(page);
  check('diving never ends the game', h.state === 'flying' && h.p.y > 0, `y=${h.p.y.toFixed(1)} state=${h.state}`);
  await shot(page, '10-dive');
  check('no console errors (run C)', logs.length === 0, logs.slice(0, 10).join('\n'));
  await page.close();
}

await browser.close();
console.log(failed ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
