/**
 * 캔버스 렌더 스냅샷 — 두 모드를 실제 픽셀로 그려 PNG 로 떨군다.
 *
 * 스모크는 캔버스를 스텁으로 삼켜서 "터지지 않는다"까지만 본다. 화면이
 * 의도대로 나오는지는 눈으로 봐야 하므로 진짜 2D 컨텍스트를 물려 그린다.
 *
 *   node tools/shot.mjs [경과일수]
 *
 * 개발 도구다. 빌드에는 들어가지 않는다.
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { JSDOM } from 'jsdom';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = Number(process.argv[2] || 400);

// 1920×1080 에서 실제로 잡히는 캔버스 영역 크기
const VIEW_W = 1904, VIEW_H = 865;

/* 노드에는 Galmuri 가 없다. 한글 라벨의 자리 차지를 확인하려면 대역 폰트가
   필요하므로 시스템 CJK 폰트를 같은 이름으로 등록한다. 픽셀 모양은 다르지만
   글자 폭·줄 높이는 비슷해 레이아웃 검수에는 충분하다. */
for (const p of ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']) {
  for (const n of ['Galmuri9', 'Galmuri11', 'Galmuri14']) {
    try { GlobalFonts.registerFromPath(p, n); } catch { /* 없으면 라틴만 나온다 */ }
  }
}

const surface = createCanvas(VIEW_W, VIEW_H);

const html = await readFile(join(ROOT, 'dist/company-tycoon.html'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://localhost/',
  beforeParse(w) {
    /* 캔버스마다 진짜 백킹 서피스를 하나씩 물린다. 게임이 오프스크린 레이어를
       만들어 drawImage 로 붙이므로 공유 컨텍스트 하나로는 안 된다. */
    w.HTMLCanvasElement.prototype.getContext = function () {
      if (!this.__napi) this.__napi = this.id === 'cv' ? surface : createCanvas(this.width || 1, this.height || 1);
      const c = this.__napi.getContext('2d');
      if (!c.__patched) {
        const orig = c.drawImage.bind(c);
        c.drawImage = (img, ...a) => orig(img && img.__napi ? img.__napi : img, ...a);
        c.__patched = true;
      }
      return c;
    };
    w.requestAnimationFrame = () => 0;
    w.devicePixelRatio = 1;
    // jsdom 은 레이아웃을 안 하므로 clientWidth/Height 가 0 이다. fitCanvas 가
    // 실제 크기를 볼 수 있게 무대 크기만 심어준다.
    for (const k of ['clientWidth', 'clientHeight']) {
      Object.defineProperty(w.HTMLElement.prototype, k, {
        get() { return this.id === 'canvas-wrap' ? (k === 'clientWidth' ? VIEW_W : VIEW_H) : 0; },
      });
    }
    w.console.log = () => {};
  },
});

await new Promise(r => setTimeout(r, 300));
const { window: win } = dom;
const doc = win.document;
const game = win.game;
if (!game) throw new Error('window.game 이 없습니다');

doc.getElementById('co-name').value = '한별상사';
doc.querySelector('#modal [data-a="0"]').click();

// 계열사·직원이 붙은 중반 상태를 만든다. 화면 밀도를 이때 기준으로 본다.
win.eval(`
  game.S.co.cash = 5e11;
  for (let i = 0; i < 6; i++) game.S.staff.push(game.makeStaff(2));
  game.S.staff[1].onTeam = true; game.S.staff[3].onTeam = true;
  for (let i = 0; i < ${DAYS}; i++) game.tickDay();
`);
win.eval(`
  const t = game.S.market.filter(c => !c.owned && c.cap <= game.capCeiling(game.S)).sort((a,b)=>b.cap-a.cap)[0];
  game.S.staff.forEach(e => e.onTeam = true);
  if (t) game.startNego(game.S, t);
  game.S.staff.forEach((e,i) => e.onTeam = i % 3 === 0);
  game.S.market[0].curse = 20;
`);

await mkdir(join(ROOT, 'shots'), { recursive: true });

// 아이콘은 12×12 격자를 손으로 찍은 것이라 눈으로 봐야 확인이 된다
{
  const N = Object.keys(win.game.ICONS);
  const sh = createCanvas(N.length * 56 + 8, 64);
  const g = sh.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#242B45'; g.fillRect(0, 0, sh.width, sh.height);
  N.forEach((n, i) => {
    const el = win.game.iconEl(n, 4);
    g.drawImage(el.__napi, 8 + i * 56, 8);
  });
  await writeFile(join(ROOT, 'shots/icons.png'), sh.toBuffer('image/png'));
  console.log('icons → shots/icons.png  (' + N.join(' ') + ')');
}

for (const mode of ['city', 'store']) {
  win.eval(`game.setMode('${mode}')`);
  for (let i = 0; i < 400; i++) win.eval('game.draw()');   // 애니메이션이 자리를 잡게
  await writeFile(join(ROOT, `shots/${mode}.png`), surface.toBuffer('image/png'));
  const g = game.S;
  console.log(`${mode} → shots/${mode}.png  (${g.day}일차 · ${g.co.subs.length}계열사 · 직원 ${g.staff.length}명 · 등급 ${g.co.tier})`);
}
