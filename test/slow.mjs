// 遅い環境（ソフトウェア描画）で、画質が自動で下がり、エラーなく進むことを確認
import { chromium } from 'playwright';
const shots = new URL('../shots/', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:8765/?autopilot=1');
await page.waitForFunction(() => window.__game && window.__game.frames > 3, null, { timeout: 120000 });
await page.mouse.click(640, 400);
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(10000);
  const g = await page.evaluate(() => ({ q: window.__game.quality, fps: window.__game.fps, frames: window.__game.frames, score: window.__game.score, state: window.__game.state }));
  console.log(JSON.stringify(g));
}
await page.screenshot({ path: shots + 'slow.png' });
console.log('logs', logs.length, logs.slice(0, 6));
await browser.close();
