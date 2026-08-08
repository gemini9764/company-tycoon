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
import { createCanvas, GlobalFonts, Image } from '@napi-rs/canvas';
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

/* `@napi-rs/canvas`(1.0.3) 는 `drawImage` 의 소스가 **캔버스**면 호출마다
   스냅샷을 붙잡고 놓지 않는다 — `global.gc()` 로도 안 돌아오는 네이티브 누수다.
   도시 지면 레이어가 2532×912(약 9MB)라 프레임마다 그만큼 쌓여, 마지막
   400프레임 루프에서 프로세스가 통째로 죽었다(`Killed`).

   소스가 `Image` 면 새지 않으므로 레이어를 한 번만 구워 재사용한다. 다만
   `img.src = buffer` 의 디코드는 **이벤트 루프를 한 번 돌아야** 끝난다
   (`complete` 가 true 여도 그 전에 그리면 아무것도 안 나온다 — 회전 중간
   프레임의 지면이 통째로 사라져서 알았다).

   그래서 **디코드가 끝나기 전에는 원본 캔버스를 그대로 쓴다.** 그림이 먼저고
   누수는 그 다음이다. 굽기 한 번당 한 프레임만 원본을 타므로 누수는
   레이어 수만큼(수십 MB)으로 묶인다. 대신 프레임 루프가 `frames()` 로
   매 프레임 이벤트 루프에 양보해야 디코드가 실제로 끝난다. */
const snaps = new WeakMap();
function drawSrc(src) {
  if (!src || typeof src.toBuffer !== 'function') return src;
  let s = snaps.get(src);
  if (!s) {
    s = { img: new Image(), ok: false };
    s.img.onload = () => { s.ok = true; };
    s.img.src = src.toBuffer('image/png');
    snaps.set(src, s);
  }
  return s.ok ? s.img : src;
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
        c.drawImage = (img, ...a) => orig(drawSrc(img && img.__napi ? img.__napi : img), ...a);
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

/* 프레임을 n 장 돌린다. **매 프레임 이벤트 루프에 한 번 양보한다** —
   레이어 스냅샷 디코드가 그 틈에 끝난다 (위 `drawSrc` 주석 참고).
   `setImmediate` 라 벽시계 비용은 사실상 없다. */
async function frames(n) {
  for (let i = 0; i < n; i++) { win.eval('game.draw()'); await new Promise(r => setImmediate(r)); }
}

await mkdir(join(ROOT, 'shots'), { recursive: true });

// 타이틀 배경 그림 — DOM 은 jsdom 이 그리지 못하므로 캔버스만 떨군다
{
  const t = doc.getElementById('title-cv');
  t.getContext('2d');
  await writeFile(join(ROOT, 'shots/title.png'), t.__napi.toBuffer('image/png'));
  console.log('title → shots/title.png');
}

doc.getElementById('title-new').click();     // 타이틀 → 새로 시작
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

/* 카메라 4방향. 회전은 타일 좌표 변환 하나로 도는 구조라 한 방향만 보면
   나머지가 깨진 걸 못 잡는다. 네 장 다 떨군다. */
win.eval("game.setMode('city')");
for (let v = 0; v < 4; v++) {
  win.eval(`game.S.view = ${v}`);
  await frames(60);
  await writeFile(join(ROOT, `shots/view${v}.png`), surface.toBuffer('image/png'));
}
win.eval('game.S.view = 0');
console.log('views → shots/view0..3.png');

/* 회전 전환의 중간 프레임. 시작·끝 모습은 view0..3 로 보이지만, 이 연출에서
   정작 확인해야 하는 건 '도는 도중'이다 — 지면과 건물이 어긋나지 않는지. */
{
  win.eval("game.setMode('city'); game.S.view = 0; game.draw(); game.beginRotate(1)");
  await frames(9);
  await writeFile(join(ROOT, 'shots/rot-mid.png'), surface.toBuffer('image/png'));
  await frames(14);                                       // 전환을 끝까지 돌린다
  win.eval('game.S.view = 0; game.draw()');
  console.log('rot → shots/rot-mid.png  (전환 50%)');
}

/* 건물 5종을 한 종류씩 몰아서 본다. 3단계 재작화는 "한 종류씩 고치고 대조"라
   섞여 있는 도시 그림으로는 확인이 안 된다. 업종을 통째로 바꿔 다시 그리고,
   3x 로 확대해 마감(기단·층 띠·창틀·파라펫)이 실제로 들어갔는지 본다. */
{
  const STYLES = [['tower', 'it'], ['lab', 'pharma'], ['plant', 'build'], ['neon', 'media'], ['shop', 'daily']];
  const keep = win.eval('game.S.market.map(c => c.sector)');
  win.eval("game.setMode('city'); game.zoomBy(1); game.zoomBy(1)");   // 1x → 3x
  for (const [tag, sector] of STYLES) {
    win.eval(`game.S.market.forEach(c => c.sector = '${sector}')`);
    await frames(40);
    await writeFile(join(ROOT, `shots/style-${tag}.png`), surface.toBuffer('image/png'));
  }
  win.eval(`game.S.market.forEach((c, i) => c.sector = ${JSON.stringify(Array.from(keep))}[i]);`);
  win.eval('game.zoomBy(-1); game.zoomBy(-1)');
  console.log('styles → shots/style-{tower,lab,plant,neon,shop}.png');
}

/* 시설 0단계 / 최대 단계를 나란히 — 증설이 그림에 반영되는지 눈으로 본다 */
for (const [tag, lv] of [['facil0', 0], ['facil3', 5]]) {
  win.eval(`game.S.co.inv = 100; game.S.co.facil = { space:Math.min(3,${lv}), shelf:${lv}, counter:Math.min(3,${lv}), cold:${lv}, office:Math.min(3,${lv}) }; game.setMode('store')`);
  await frames(120);
  await writeFile(join(ROOT, `shots/${tag}.png`), surface.toBuffer('image/png'));
  console.log(`${tag} → shots/${tag}.png  (시설 Lv.${lv})`);
}
win.eval('game.S.co.facil = { shelf:0, counter:0, cold:0, office:0 }');

for (const mode of ['city', 'store']) {
  win.eval(`game.setMode('${mode}')`);
  await frames(400);                                      // 애니메이션이 자리를 잡게
  await writeFile(join(ROOT, `shots/${mode}.png`), surface.toBuffer('image/png'));
  const g = game.S;
  console.log(`${mode} → shots/${mode}.png  (${g.day}일차 · ${g.co.subs.length}계열사 · 직원 ${g.staff.length}명 · 등급 ${g.co.tier})`);
}
