import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(900);
await p.evaluate(() => document.getElementById('title-new').click());
await p.waitForTimeout(400);
for (let i = 0; i < 8; i++) { const c = await p.evaluate(() => { const x = document.querySelector('#modal [data-a="0"]'); if (!x) return false; x.click(); return true; }); if (!c) break; await p.waitForTimeout(200); }
await p.evaluate(() => window.game.openSettings());
await p.waitForTimeout(400);
const box = await p.evaluate(() => { const m = document.querySelector('#modal-layer .modal') || document.querySelector('#modal'); const r = m.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; });
await p.screenshot({ path: '/tmp/set2.png', clip: box });
await b.close();
