// 追加検証: 低画質パス / 音量 / 水面すれすれ / 迷子からの引き直し / リサイズ / 描画負荷
import { chromium } from 'playwright';
const BASE = process.env.URL || 'http://127.0.0.1:8765/';
const shots = new URL('../shots/', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!ok) failed = true; };
async function open(qs, vp = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport: vp });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(BASE + qs);
  await page.waitForFunction(() => window.__game && window.__game.frames > 10, null, { timeout: 60000 });
  return { page, logs };
}
const G = (page) => page.evaluate(() => { const g = window.__game; return { state: g.state, score: g.score, combo: g.combo, dayT: g.dayT, p: g.player, fps: g.fps, q: g.quality, info: g.info, d: g.nextRingDistance, audio: g.audio }; });

{ // 低画質パス（ポストプロセスなし）
  const { page, logs } = await open('?autopilot=1&quality=2');
  await page.mouse.click(640, 400);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: shots + 'p1-quality2.png' });
  await page.evaluate(() => window.__game.setDay(0.7));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shots + 'p1-quality2-sunset.png' });
  const g = await G(page);
  check('quality=2 renders and plays', g.q === 2 && g.score > 0, JSON.stringify(g.info));
  check('no console errors (quality 2)', logs.length === 0, logs.slice(0, 8).join('\n'));
  await page.close();
}
{ // 音量
  const { page, logs } = await open('?autopilot=1');
  await page.mouse.click(640, 400);
  let peak = 0, rms = 0, n = 0, running = false;
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(250); const a = (await G(page)).audio; peak = Math.max(peak, a.peak); rms += a.rms; n++; running = a.running; }
  check('audio is running and audible', running && rms / n > 0.01, `peak=${peak.toFixed(3)} avgRms=${(rms / n).toFixed(3)}`);
  check('audio does not clip', peak < 0.99, `peak=${peak.toFixed(3)}`);
  await page.evaluate(() => window.__game.setDay(0.93));
  await page.waitForTimeout(4000);
  let rmsN = 0;
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(250); rmsN += (await G(page)).audio.rms; }
  check('night music still audible', rmsN / 16 > 0.005, `avgRms=${(rmsN / 16).toFixed(3)}`);
  await page.click('#mute');
  await page.waitForTimeout(800);
  const m = (await G(page)).audio;
  check('mute silences output', m.peak < 0.002, `peak=${m.peak.toFixed(4)}`);
  const info = (await G(page)).info;
  console.log('   render info', JSON.stringify(info));
  check('no console errors (audio)', logs.length === 0, logs.slice(0, 8).join('\n'));
  await page.close();
}
{ // 手動: 水面すれすれ → 迷子 → 引き直し → リサイズ
  const { page, logs } = await open('');
  await page.mouse.move(640, 360);
  await page.mouse.click(640, 360);
  await page.mouse.move(640, 690, { steps: 5 });
  let minY = 1e9;
  for (let i = 0; i < 28; i++) { await page.waitForTimeout(300); const g = await G(page); minY = Math.min(minY, g.p.y); if (g.p.y < 6 && i > 6) { await page.screenshot({ path: shots + 'p2-skim.png' }); break; } }
  const g1 = await G(page);
  check('can skim the water, never dies', minY < 8 && g1.state === 'flying' && g1.p.y > 0, `minY=${minY.toFixed(1)}`);
  await page.mouse.move(80, 360, { steps: 5 });
  let maxD = 0;
  for (let i = 0; i < 24; i++) { await page.waitForTimeout(300); const g = await G(page); maxD = Math.max(maxD, g.d ?? 0); }
  const g2 = await G(page);
  check('path is re-laid ahead when the player wanders off', g2.d !== null && g2.d < 260 && maxD < 420, `now=${g2.d?.toFixed(0)} max=${maxD.toFixed(0)}`);
  await page.mouse.move(640, 360, { steps: 3 });
  const before = (await G(page)).score;
  await page.waitForTimeout(5000);
  const after = await G(page);
  console.log(`   hands-off for 5s after reroute: score ${before} -> ${after.score}, next ring at ${after.d?.toFixed(0)}`);
  await page.setViewportSize({ width: 900, height: 640 });
  await page.waitForTimeout(1200);
  const size = await page.evaluate(() => { const c = document.getElementById('c'); const r = c.getBoundingClientRect(); return { cw: c.width, ch: c.height, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio }; });
  check('resize is followed', Math.abs(size.w - 900) < 2 && Math.abs(size.h - 640) < 2 && Math.abs(size.cw / size.ch - 900 / 640) < 0.02, JSON.stringify(size));
  await page.screenshot({ path: shots + 'p3-resized.png' });
  check('no console errors (manual)', logs.length === 0, logs.slice(0, 8).join('\n'));
  await page.close();
}
await browser.close();
console.log(failed ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
