import { TIERS } from '../core/data.js';
import { unlockAudio, sfx, startBgm } from '../core/audio.js';
import { $, esc, won } from '../core/util.js';
import { HH, HW, isoX, isoY, prism, rhomb } from '../render/iso.js';
import { openModal } from './modal.js';
import { openSettings } from './settings.js';

/* ══════════════════════════════════════════════════════════════
   TITLE — 첫 화면

   메뉴는 셋. 새로 시작 / 이어하기 / 설정.
   세이브가 없으면 '이어하기'는 비활성으로 두고 이유를 적는다 — 버튼을 숨기면
   "저장이 안 되나?" 로 읽힌다.

   배경 그림은 render/iso.js 의 도형을 그대로 쓴다. 타이틀에서부터 쿼터뷰라는
   걸 보여 주려는 것이고, 그림 파일을 두지 않는 '외부 에셋 0' 원칙도 지킨다.
   ══════════════════════════════════════════════════════════════ */

/* [타일x, 타일y, 높이, 폭반경, 몸통색] — 가운데 금빛이 플레이어 사옥 */
const TITLE_CITY = [
  [0, 4, 26, 16, '#57607F'], [1, 5, 18, 14, '#6B6E86'], [4, 0, 30, 16, '#5E7480'],
  [5, 1, 20, 14, '#7A6E6A'], [2, 1, 40, 18, '#4A5474'], [0, 1, 22, 14, '#6E6480'],
  [4, 3, 34, 16, '#59627E'], [5, 4, 16, 12, '#7A7460'], [1, 3, 46, 20, '#F2B233'],
];

function drawTitleArt() {
  const cv = $('title-cv');
  if (!cv) return;
  const g = cv.getContext('2d');
  if (!g) return;                                   // jsdom — 조용히 건너뛴다
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);

  const O = { x: cv.width / 2 - HW, y: 44 };
  for (let gy = -1; gy < 7; gy++) for (let gx = -1; gx < 7; gx++) {
    rhomb(g, isoX(O, gx, gy), isoY(O, gx, gy), HW, HH, (gx + gy) % 2 ? '#2F5A3C' : '#2B5138');
  }
  const items = TITLE_CITY.map(([gx, gy, h, rx, c]) => ({
    y: isoY(O, gx, gy), x: isoX(O, gx, gy), h, rx, c,
  })).sort((a, b) => a.y - b.y);

  for (const b of items) {
    g.save(); g.globalAlpha = 0.28; rhomb(g, b.x + 3, b.y + 2, b.rx, b.rx / 2, '#000000'); g.restore();
    prism(g, b.x, b.y, b.rx, b.rx / 2, b.h, shadeHex(b.c, 0.26), shadeHex(b.c, -0.30), b.c);
    g.fillStyle = 'rgba(255,225,160,.55)';          // 창문
    for (let r = 6; r < b.h - 4; r += 7) {
      for (let i = 4; i < b.rx - 4; i += 6) {
        g.fillRect(Math.round(b.x - b.rx + i), Math.round(b.y + b.rx / 2 - (b.rx - i) / 2 - r), 2, 3);
      }
    }
  }
}

/** canvas.js 의 shade 와 같은 일. 렌더 모듈을 끌어오지 않으려고 따로 둔다. */
function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.min(255, Math.round(c * (1 + amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/**
 * 타이틀을 띄운다.
 * @param info 세이브 요약 (없으면 null)
 * @param on   { onNew, onContinue } — 실제 게임 시작은 호출자가 맡는다
 */
function showTitle(info, on) {
  const layer = $('title-layer');
  layer.classList.add('on');
  $('title-menu').innerHTML = `
    <button class="tbtn gold" id="title-new">새로 시작<small>${info ? '기존 저장 데이터를 덮어씁니다' : '구멍가게에서 출발합니다'}</small></button>
    <button class="tbtn" id="title-cont" ${info ? '' : 'disabled'}>이어하기<small>${info
      ? `${esc(info.name)} · ${TIERS[info.tier].name} · ${info.day}일차 · ${won(info.cash)}`
      : '저장된 게임이 없습니다'}</small></button>
    <button class="tbtn" id="title-set">설정<small>사운드</small></button>`;

  drawTitleArt();

  const go = fn => { unlockAudio(); sfx('tap'); startBgm(); fn(); };
  $('title-new').onclick = () => go(() => {
    if (!info) return on.onNew();
    openModal({
      title: '새로 시작',
      body: `<p>저장된 게임(<b>${esc(info.name)}</b> · ${info.day}일차)이 지워집니다.</p>`,
      choices: [
        { label: '지우고 새로 시작', run: on.onNew },
        { label: '취소', run: () => {} },
      ],
    });
  });
  $('title-cont').onclick = () => { if (info) go(on.onContinue); };
  $('title-set').onclick = () => go(openSettings);
}

function hideTitle() { $('title-layer').classList.remove('on'); }

/* 게임 → 타이틀 복귀. 실제 동작(루프 정지·세이브 요약 갱신)은 main 이 안다.
   설정 모달에서 main 을 직접 부르면 모듈 고리가 지저분해져 창구만 둔다. */
let exitFn = null;

function setExitHandler(fn) { exitFn = fn; }

function canExit() { return !!exitFn && !$('title-layer').classList.contains('on'); }

function exitToTitle() { if (exitFn) exitFn(); }

export { TITLE_CITY, canExit, drawTitleArt, exitToTitle, hideTitle, setExitHandler, shadeHex, showTitle };
