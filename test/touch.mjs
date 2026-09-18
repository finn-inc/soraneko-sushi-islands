// タッチ操作の検証: iPhone 相当のエミュレーションで、タップ開始 / なぞって操舵 / 離して直進 / 2本目の指と右下ボタンで加速 / 縦横のレイアウト
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.URL || 'http://127.0.0.1:8765/';
const GPU = process.env.GPU || 'metal';
const shots = new URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const args = GPU === 'swiftshader'
  ? ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl']
  : ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu', '--enable-webgl'];
const browser = await chromium.launch({ headless: true, args: [...args, '--autoplay-policy=no-user-gesture-required'] });
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!ok) failed = true; };
const G = (page) => page.evaluate(() => { const g = window.__game; return { state: g.state, score: g.score, p: g.player, in: g.input, fps: g.fps, q: g.quality }; });
const shot = (page, name) => page.screenshot({ path: `${shots}${name}.png` });
const style = (page, sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);

async function open(device, qs = '') {
  const { defaultBrowserType, ...dev } = device;
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(BASE + qs);
  await page.waitForFunction(() => window.__game && window.__game.frames > 10, null, { timeout: 60000 });
  const cdp = await ctx.newCDPSession(page);
  const pts = (a) => a.map(([id, x, y]) => ({ id, x, y }));
  // CDP のタッチ: start は列挙した点のうち新しい点を押下、end は列挙した点を解放（end([]) で全部離す）
  const touch = {
    start: (a) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(a) }),
    move: (a) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(a) }),
    end: (a = []) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts(a) }),
  };
  return { page, ctx, logs, touch };
}

// ---- 縦持ち（iPhone 13 相当: 390x664） ----
{
  const { page, ctx, logs, touch } = await open(devices['iPhone 13']);
  await page.waitForTimeout(1500);
  const ui0 = {
    touch: await page.evaluate(() => document.body.classList.contains('touch')),
    tapText: await style(page, '#title .start .t', 'display'), clickText: await style(page, '#title .start .m', 'display'),
    turn: await style(page, '#turn', 'display'), boost: await style(page, '#boost', 'opacity'),
  };
  check('touch mode detected before first touch', ui0.touch, JSON.stringify(ui0));
  check('tap wording + landscape tip shown in portrait', ui0.tapText !== 'none' && ui0.clickText === 'none' && ui0.turn !== 'none', JSON.stringify(ui0));
  await shot(page, 't1-title-portrait');
  const vp = page.viewportSize();
  await page.touchscreen.tap(vp.width / 2, vp.height * 0.86);
  await page.waitForTimeout(600);
  let g = await G(page);
  check('tap starts the flight', g.state === 'flying', g.state);
  check('finger lifted -> stick centered, no boost', g.in.stick === false && g.in.rx === 0 && g.in.ry === 0 && !g.in.boost, JSON.stringify(g.in));
  check('boost button shown while flying', await page.evaluate(() => document.getElementById('boost').classList.contains('on')));
  await page.waitForTimeout(3500); // 舵が完全に渡るまで待つ（開始直後は自動で1個目のリングをくぐる）
  const a = await G(page);
  await touch.start([[1, 120, 500]]);
  await touch.move([[1, 235, 500]]);
  await page.waitForTimeout(150);
  g = await G(page);
  check('drag right -> stick pushed right, no boost', g.in.stick && g.in.rx > 0.8 && Math.abs(g.in.ry) < 0.1 && !g.in.boost, JSON.stringify(g.in));
  await page.waitForTimeout(1500);
  await shot(page, 't2-drag-portrait');
  const b = await G(page);
  check('drag right turns right (yaw decreases)', b.p.yaw < a.p.yaw - 0.3, `${a.p.yaw.toFixed(2)} -> ${b.p.yaw.toFixed(2)} roll=${b.p.roll.toFixed(2)}`);
  await touch.end();
  await page.waitForTimeout(150);
  g = await G(page);
  check('release -> straight (rx=ry=0)', !g.in.stick && g.in.rx === 0 && g.in.ry === 0, JSON.stringify(g.in));
  await page.waitForTimeout(1600);
  const c = await G(page);
  check('levels out after release', Math.abs(c.p.roll) < 0.12, `roll=${c.p.roll.toFixed(2)} pitch=${c.p.pitch.toFixed(2)}`);
  // 2本目の指は無視される（手のひらの誤タッチで加速しない）
  await touch.start([[1, 120, 500]]);
  await touch.start([[1, 120, 500], [2, 300, 380]]);
  await page.waitForTimeout(150);
  g = await G(page);
  check('second finger is ignored (no boost, still steering)', !g.in.boost && g.in.stick, JSON.stringify(g.in));
  await touch.end();
  await page.waitForTimeout(150);
  // 右下のボタン = 加速（操舵にはならない）
  const bb = await page.locator('#boost').boundingBox();
  await touch.start([[3, bb.x + bb.width / 2, bb.y + bb.height / 2]]);
  await page.waitForTimeout(150);
  g = await G(page);
  check('boost button hold -> boost on, not steering', g.in.btn && g.in.boost && !g.in.stick, JSON.stringify(g.in));
  await shot(page, 't3-boost-button');
  await page.waitForTimeout(300); // 長押し扱いになるまで押し続ける
  await touch.end();
  await page.waitForTimeout(150);
  g = await G(page);
  check('boost button release (after hold) -> boost off', !g.in.btn && !g.in.boost && !g.in.lock, JSON.stringify(g.in));
  // 短いタップでロック、もう一度タップで解除
  const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
  await touch.start([[4, cx, cy]]); await page.waitForTimeout(60); await touch.end();
  await page.waitForTimeout(150);
  g = await G(page);
  check('quick tap on boost button -> boost locked on', g.in.lock && g.in.boost && !g.in.btn, JSON.stringify(g.in));
  await page.waitForTimeout(1200);
  const e = await G(page);
  check('locked boost keeps speed up', e.p.speed > 60, `speed=${e.p.speed.toFixed(1)}`);
  await touch.start([[5, cx, cy]]); await page.waitForTimeout(60); await touch.end();
  await page.waitForTimeout(150);
  g = await G(page);
  check('tap again -> boost unlocked', !g.in.lock && !g.in.boost, JSON.stringify(g.in));
  // 案内文と加速ボタンが重ならない
  const hb = await page.locator('#hint').boundingBox();
  check('hint does not overlap boost button', hb && (hb.y + hb.height <= bb.y || hb.x + hb.width <= bb.x), JSON.stringify({ hint: hb, boost: bb }));
  check('no console errors (portrait)', logs.length === 0, logs.slice(0, 10).join('\n'));
  console.log(`   portrait: fps=${g.fps} quality=${g.q}`);
  await ctx.close();
}

// ---- 横持ち ----
{
  const { page, ctx, logs, touch } = await open(devices['iPhone 13 landscape']);
  await page.waitForTimeout(1500);
  check('landscape tip hidden in landscape', (await style(page, '#turn', 'display')) === 'none');
  await shot(page, 't4-title-landscape');
  const vp = page.viewportSize();
  await page.touchscreen.tap(vp.width / 2, vp.height * 0.8);
  await page.waitForTimeout(4000);
  await touch.start([[1, 140, vp.height * 0.6]]);
  await touch.move([[1, 140, vp.height * 0.6 - 90]]);
  await page.waitForTimeout(1200);
  const g = await G(page);
  check('drag up climbs (landscape)', g.state === 'flying' && g.in.ry < -0.8 && g.p.pitch > 0.2, `pitch=${g.p.pitch.toFixed(2)} ${JSON.stringify(g.in)}`);
  await shot(page, 't5-drag-landscape');
  await touch.end();
  const hb = await page.locator('#hint').boundingBox(), bb = await page.locator('#boost').boundingBox();
  check('hint does not overlap boost button (landscape)', hb && (hb.y + hb.height <= bb.y || hb.x + hb.width <= bb.x), JSON.stringify({ hint: hb, boost: bb }));
  check('no console errors (landscape)', logs.length === 0, logs.slice(0, 10).join('\n'));
  await ctx.close();
}

// ---- マウス環境ではタッチ用の要素が出ない ----
{
  const { page, ctx, logs } = await open({ viewport: { width: 1280, height: 720 } });
  await page.mouse.move(640, 400);
  await page.waitForTimeout(500);
  const m = { touch: await page.evaluate(() => document.body.classList.contains('touch')), boost: await style(page, '#boost', 'display'), click: await style(page, '#title .start .m', 'display') };
  check('desktop stays in mouse mode (no boost button, click wording)', !m.touch && m.boost === 'none' && m.click !== 'none', JSON.stringify(m));
  check('no console errors (desktop)', logs.length === 0, logs.slice(0, 10).join('\n'));
  await ctx.close();
}

await browser.close();
console.log(failed ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
