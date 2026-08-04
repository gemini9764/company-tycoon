import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
p.on('requestfailed', r => errs.push('REQFAIL ' + r.url()));
p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const st = await p.evaluate(() => ({
  game: typeof window.game,
  title: document.getElementById('title-layer')?.className,
  newBtn: !!document.getElementById('title-new'),
  bodyLen: document.body.innerHTML.length,
}));
console.log('상태:', JSON.stringify(st));
console.log('오류:', errs.length ? errs.slice(0, 8).join('\n  ') : '없음');
await p.screenshot({ path: '/tmp/pages-title.png' });
if (st.newBtn) {
  await p.evaluate(() => document.getElementById('title-new').click());
  await p.waitForTimeout(800);
  await p.evaluate(() => { const x = document.querySelector('#modal [data-a="0"]'); if (x) x.click(); });
  await p.waitForTimeout(1200);
  console.log('시작 후 오류:', errs.length ? errs.slice(0, 8).join('\n  ') : '없음');
  await p.screenshot({ path: '/tmp/pages-game.png' });
}
await b.close();
