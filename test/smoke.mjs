// 起動確認: コンソールエラーの有無と、最初の数秒の状態を見る
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8765/';
const GPU = process.env.GPU || 'metal';
const shots = new globalThis.URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });

const args = GPU === 'swiftshader'
  ? ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl']
  : ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu', '--enable-webgl'];
const browser = await chromium.launch({ headless: true, args: [...args, '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(URL + (process.env.QS || '?autopilot=1'));
await page.waitForFunction(() => window.__game && window.__game.frames > 5, null, { timeout: 60000 }).catch((e) => logs.push('[timeout] ' + e.message));
await page.waitForTimeout(3000);
const info = await page.evaluate(() => {
  const g = window.__game;
  const c = document.createElement('canvas').getContext('webgl');
  const ext = c && c.getExtension('WEBGL_debug_renderer_info');
  return g ? { state: g.state, frames: g.frames, fps: g.fps, quality: g.quality, info: g.info, player: g.player, errors: g.errors, gpu: ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a' } : null;
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: shots + 'smoke.png' });
console.log('LOGS', logs.length);
for (const l of logs.slice(0, 30)) console.log(l);
await browser.close();
