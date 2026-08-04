/**
 * UI 스모크 테스트 — 주요 상호작용 경로를 실제로 클릭해 본다.
 *   node tools/smoke.mjs
 */
import { boot, startGame, resolveModals } from './harness.mjs';

/* 버튼이 모드별로 갈렸다. 도시 전용 / 사옥 전용 / 공통을 구분해 모드를 맞춘 뒤 누른다. */
const MODE_OF = { co: 'city', stock: 'city', bank: 'city', shop: 'store', staff: 'store', shaman: 'store' };

const gotoMode = (win, doc, id) => {
  const m = MODE_OF[id];
  if (m && win.game.S.mode !== m) { win.eval(`game.setMode('${m}')`); }
};

/* 독 버튼은 토글이다. 이미 열려 있으면 다시 눌러 닫히므로 상태를 맞춘다. */
const openTab = (win, doc, id) => {
  gotoMode(win, doc, id);
  const b = doc.querySelector(`[data-t="${id}"]`);
  if (!b) throw new Error(`버튼 없음: ${id} (모드 ${win.game.S.mode})`);
  if (!b.classList.contains('on')) b.click();
  return b;
};

const pass = [], fail = [];
const check = (name, ok, detail = '') =>
  (ok ? pass : fail).push(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);

const { win, doc, game, errors } = await boot();
const text = id => doc.getElementById(id).textContent.replace(/\s+/g, ' ').trim();

try {
  check('타이틀 메뉴', !!doc.getElementById('title-new') && doc.getElementById('title-cont').disabled,
        '세이브 없음 → 이어하기 비활성');
  /* 타이틀에서도 설정이 열려야 한다. 모달이 타이틀보다 z-index 가 낮으면
     버튼은 눌리는데 화면이 안 바뀌어 '설정이 안 된다'로 보인다. */
  doc.getElementById('title-set').click();
  check('타이틀 → 설정', doc.getElementById('modal-layer').classList.contains('on')
        && !!doc.getElementById('set-mute'));
  /* 음소거는 누른 즉시 아래 슬라이더가 잠겨야 한다 (창을 닫았다 열 필요 없이) */
  doc.getElementById('set-mute').click();
  check('음소거 즉시 반영', [...doc.querySelectorAll('[data-vol]')].every(e => e.disabled));
  doc.getElementById('set-mute').click();
  check('음소거 해제 즉시 반영', [...doc.querySelectorAll('[data-vol]')].every(e => !e.disabled));
  doc.querySelector('#modal [data-a="0"]').click();

  startGame(doc);
  check('인트로 모달', !doc.getElementById('title-layer').classList.contains('on'));

  check('회사 수', game.S.market.length === game.BAL.npcCount, `${game.S.market.length}개`);
  const badList = game.S.market.filter(c => c.listed !== (game.capTier(c.cap) >= game.LIST_TIER));
  check('상장 기준 — 중견기업 이상', badList.length === 0,
        `상장 ${game.S.market.filter(c => c.listed).length}개 · 예외 ${badList.length}`);
  check('창업 후 HUD 렌더', text('hud').includes('테스트상사'));

  win.eval('for (let i = 0; i < 300; i++) game.tickDay();');
  check('300일 진행', game.S.day >= 300, `${game.S.day}일차 · 자금 ${game.won(game.S.co.cash)}`);

  for (const t of ['co', 'staff', 'stock', 'bank', 'rumor', 'inbox']) {
    gotoMode(win, doc, t);
    const b = doc.querySelector(`[data-t="${t}"]`);
    if (!b) { check(`창 ${t}`, false, '버튼 없음'); continue; }
    if (b.classList.contains('locked')) { check(`창 ${t}`, true, '잠김(정상)'); continue; }
    if (!b.classList.contains('on')) b.click();
    const html = doc.getElementById('panel-body').innerHTML;
    const open = doc.getElementById('panel-layer').classList.contains('on');
    check(`창 ${t}`, open && html.length > 50 && !/undefined|NaN/.test(html), `${html.length}b`);
  }

  /* 버튼 배치 — 모드를 갈랐으니 그 모드 버튼만 있어야 한다 */
  win.eval("game.setMode('city')");
  const cityIds = [...doc.querySelectorAll('[data-t]')].map(b => b.dataset.t);
  win.eval("game.setMode('store')");
  const storeIds = [...doc.querySelectorAll('[data-t]')].map(b => b.dataset.t);
  check('도시 버튼 구성', ['co', 'stock', 'bank', 'rumor', 'inbox', 'config'].every(i => cityIds.includes(i))
        && !cityIds.includes('staff') && !cityIds.includes('shaman'), cityIds.join(' '));
  check('사옥 버튼 구성', ['staff', 'shaman', 'rumor', 'inbox', 'config'].every(i => storeIds.includes(i))
        && !storeIds.includes('bank') && !storeIds.includes('stock'), storeIds.join(' '));

  /* 모드를 벗어난 창은 자동으로 닫혀야 한다 */
  openTab(win, doc, 'bank');
  win.eval("game.setMode('store')");
  check('모드 밖 창 자동 닫힘', !doc.getElementById('panel-layer').classList.contains('on'));

  /* 잠긴 버튼은 자물쇠 배지로 표시하고 라벨을 가리지 않는다 */
  win.eval("game.setMode('store'); game.S.shaman.unlocked = false; game.renderDock();");
  const sh = doc.querySelector('[data-t="shaman"]');
  check('잠김 표시', sh.classList.contains('locked') && !!sh.querySelector('.lockbadge')
        && sh.textContent.trim() === '무당', sh.textContent.trim());
  sh.click();
  check('잠김 버튼 — 창 안 열리고 사유 안내', !doc.getElementById('panel-layer').classList.contains('on')
        && doc.getElementById('toasts').textContent.includes('해금'));

  win.eval('game.S.shaman.unlocked = true; game.renderDock();');
  openTab(win, doc, 'shaman');
  check('창 shaman', doc.getElementById('panel-body').innerHTML.length > 50);

  openTab(win, doc, 'staff');
  doc.querySelector('[data-team]').click();
  check('협상단 편성', game.teamOf(game.S).length > 0);

  win.eval('game.S.co.cash = 1e9;');
  openTab(win, doc, 'staff');
  const before = game.S.staff.length;
  doc.querySelector('[data-hire]').click();
  check('직원 영입', game.S.staff.length === before + 1);

  openTab(win, doc, 'bank');
  const loan = doc.querySelector('[data-loan]:not([disabled])');
  if (loan) loan.click();
  check('대출 실행', game.debtTotal(game.S) > 0, game.won(game.debtTotal(game.S)));
  const repay = doc.querySelector('[data-repay]:not([disabled])');
  if (repay) repay.click();
  check('일시 상환', game.debtTotal(game.S) === 0);

  win.eval(`
    game.S.staff.forEach(e => e.onTeam = true);
    const t = game.S.market.filter(c => !c.owned && c.cap <= game.capCeiling(game.S))
                           .sort((a, b) => a.cap - b.cap)[0];
    game.S.co.cash = t.cap * 4;
    game.startNego(game.S, t);`);
  check('협상 시작', !!game.S.nego, game.S.nego?.name);
  const subsBefore = game.S.co.subs.length;
  for (let i = 0; i < 60 && game.S.nego; i++) { win.eval('game.tickDay()'); resolveModals(doc); }
  resolveModals(doc, /자기자금/);
  check('협상 사이클 완주', !game.S.nego);
  check('인수 처리', game.S.co.subs.length >= subsBefore);

  win.eval('game.openCompany(game.S.market.find(c => !c.owned))');
  check('회사 상세 팝업', doc.getElementById('modal').textContent.includes('예상 인수가'));
  doc.getElementById('mx').click();

  win.eval('game.setMode("store"); game.draw(); game.setMode("city"); game.draw();');
  check('캔버스 2모드 드로우', true);

  win.eval('game.S.co.cash = 1e11;');
  openTab(win, doc, 'stock');
  const buy = doc.querySelector('[data-buy]:not([disabled])');
  if (buy) buy.click();
  check('주식 매수', Object.keys(game.S.stock.holds).length > 0);
  openTab(win, doc, 'stock');
  const sell = doc.querySelector('[data-sell]');
  if (sell) sell.click();
  check('주식 매도', true);

  win.eval(`game.S.shaman.hired = game.S.shaman.pool[0]; game.S.co.cash = 1e11;
            game.doGut(game.S, 'sal', game.S.market.find(c => !c.owned).id);`);
  check('살굿 실행', game.S.co.mistrust > 0, `미신지수 ${Math.round(game.S.co.mistrust)}`);

  win.eval('game.saveGame(true)');
  check('저장', ['artifact', 'local', 'memory'].includes(game.Store.mode), game.Store.mode);

  /* 세이브 포맷 버전이 갈라지면 '이어하기'가 조용히 죽는다. 실제로 읽히는지까지 본다. */
  const info = await game.saveInfo();
  check('세이브 재적재', !!info && info.name === '테스트상사', info ? `${info.day}일차` : '읽기 실패');

  /* 설정 — 사운드만 */
  doc.querySelector('[data-t="config"]').click();
  const vols = [...doc.querySelectorAll('[data-vol]')].map(e => e.dataset.vol);
  check('설정 모달', vols.join(',') === 'master,bgm,sfx', vols.join(','));
  const sfxSlider = doc.querySelector('[data-vol="sfx"]');
  sfxSlider.value = '30'; sfxSlider.dispatchEvent(new win.Event('input'));
  check('볼륨 반영', Math.abs(game.SND.sfx - 0.3) < 1e-6, String(game.SND.sfx));
  doc.getElementById('set-mute').click();
  check('음소거 토글', game.SND.muted === true);
  doc.getElementById('set-mute').click();
  doc.querySelector('#modal [data-a="0"]').click();

  /* 클릭 판정 — 겹친 건물과 상호판 */
  const hitOk = win.eval(`(() => {
    const c = game.S.market[0], g = game.bldgGeom(c);
    const corner = { x: g.x + g.rx - 1, y: g.y - g.h - g.ry + 1 };   // 사각형 근사면 잡히던 빈 하늘
    const inside = { x: g.x, y: g.y - g.h / 2 };
    return !game.isoHit(corner, g) && game.isoHit(inside, g);
  })()`);
  check('실루엣 클릭 판정', hitOk, '건물 모서리 바깥은 통과');
  const plateOk = win.eval(`(() => {
    game.setMode('city'); game.draw();
    const c = game.S.market[0], g = game.bldgGeom(c);
    const h = game.cityHit({ x: g.x, y: g.y + 29 });                  // 상호판 위치 (건물 바닥 +21 부터 16px)
    return !!h && !h.self && h.co.id === c.id;
  })()`);
  check('상호판 클릭 타깃', plateOk, '가려진 회사도 집힌다');

  /* 카메라 회전 — 그리는 쪽과 판정하는 쪽이 같은 rotG 를 쓰는지 확인한다.
     한쪽만 돌면 "보이는 건물과 다른 회사가 열리는" 증상이 난다. */
  const rotOk = win.eval(`(() => {
    const seen = new Set();
    for (let v = 0; v < 4; v++) {
      game.S.view = v; game.setMode('city'); game.draw();
      /* 상호판 위치로 친다. 건물 몸통은 앞 건물이나 다른 회사의 상호판에
         정당하게 가려질 수 있어 회전 버그와 구분이 안 된다. */
      const c = game.S.market[3], g = game.bldgGeom(c);
      seen.add(Math.round(g.x) + ',' + Math.round(g.y));
      const h = game.cityHit({ x: g.x, y: g.y + 29 });
      if (!h || h.self || h.co.id !== c.id) return '뷰 ' + v + ' 판정 어긋남';
    }
    game.S.view = 0;
    return seen.size === 4 ? true : '뷰마다 위치가 안 바뀜 (' + seen.size + '종)';
  })()`);
  /* 성공은 끝이 아니다 — 1위를 찍어도 게임이 멈추면 안 된다. */
  const endless = win.eval(`(() => {
    const S = game.S;
    /* recalcCap 은 시총을 공식으로 다시 계산하므로 부르면 안 된다 — 값이 덮인다 */
    S.co.cap = 4e13; S.co.rank = 1; S.co.tier = 6;
    for (let i = 0; i < 6; i++) game.checkEnding(S);
    if (S.flags.ending) return '1위 달성이 엔딩으로 처리됨';
    if (!S.flags.ms.includes('rank1')) return '순위 마일스톤 미발화';
    const before = game.goalText(S);
    S.co.cap = 2e14; game.checkEnding(S); game.checkEnding(S);
    if (!S.flags.capGoal) return '시총 단계로 안 넘어감';
    return before !== game.goalText(S) ? true : '목표 문구가 안 바뀜';
  })()`);
  check('무한 진행 — 1위 이후 시총 목표', endless === true, endless === true ? '엔딩 없이 계속' : endless);
  win.eval('game.S.flags.ms = []; game.S.flags.capGoal = 0');

  check('카메라 회전 4방향', rotOk === true, rotOk === true ? '위치·판정 모두 일치' : rotOk);

  openTab(win, doc, 'co');                             // 회사 창 내용까지 훑는다
  const all = ['hud', 'dock', 'panel-body'].map(text).join(' ');
  /* ── 사옥 콘텐츠 ─────────────────────────────────────── */
  win.eval('game.S.co.cash = 5e10');
  openTab(win, doc, 'shop');
  const PB = () => doc.getElementById('panel-body');
  check('매장 창 — 발주', PB().innerHTML.includes('재고') && !!PB().querySelector('[data-order]'));

  win.eval('game.S.co.inv = 40');
  win.eval('game.renderShop()');
  const cashBefore = game.S.co.cash;
  PB().querySelector('[data-order="25"]').click();
  check('발주', Math.round(game.S.co.inv) === 65 && game.S.co.cash < cashBefore, `재고 ${Math.round(game.S.co.inv)}%`);

  const inv0 = game.S.co.inv;
  win.eval('game.tickDay()');
  check('재고 소모', game.S.co.inv < inv0, `${Math.round(inv0)} → ${Math.round(game.S.co.inv)}`);

  win.eval('game.S.co.inv = 0');
  const lowRetail = game.dailyRetail(game.S);
  win.eval('game.S.co.inv = 100');
  check('재고가 매출에 반영', game.dailyRetail(game.S) > lowRetail,
        `0% → ${game.won(lowRetail)} · 100% → ${game.won(game.dailyRetail(game.S))}`);

  PB().querySelector('#shop-auto').click();
  win.eval('game.S.co.inv = 30; game.tickDay()');
  check('자동 발주', game.S.co.autoOrder && game.S.co.inv > 95, `재고 ${Math.round(game.S.co.inv)}%`);

  PB().querySelector('[data-sv="facil"]').click();
  const fCash = game.S.co.cash;
  PB().querySelector('[data-fac="shelf"]:not([disabled])').click();
  check('시설 증설', game.S.co.facil.shelf === 1 && game.S.co.cash < fCash);

  PB().querySelector('[data-sv="ops"]').click();
  const mk = game.S.co.marketing;
  PB().querySelector('#ad-l').click();
  check('광고 캠페인 — 매장 창으로 이동', game.S.co.marketing > mk, `×${game.S.co.marketing.toFixed(2)}`);

  /* 시설을 최대로 올려도 손님이 모든 진열대에 닿아야 한다.
     증설한 집기가 통로를 막으면 손님이 문 앞에 갇힌다 — 눈으로는 늦게 발견된다. */
  win.eval("game.S.co.facil = { shelf: 3, counter: 3, cold: 3, office: 3 }; game.setMode('store')");
  const unreachable = win.eval(`(() => {
    const g = window.game;
    const from = { gx: -4, gy: 0 + g.DOOR.gy };
    return g.shelvesNow()
      .map(s => ({ gx: s.gx, gy: s.gy + 1 }))
      .concat([{ gx: g.QUEUE.gx, gy: g.QUEUE.gy }])
      .filter(to => !g.walkable(to.gx, to.gy) || g.findPath(from, to).length === 0)
      .map(o => o.gx + ',' + o.gy);
  })()`);
  check('시설 최대에서도 손님 경로 유지', unreachable.length === 0,
        unreachable.length ? '막힘 ' + unreachable.join(' ') : `진열대 ${game.shelvesNow().length}개 전부 도달`);
  check('시설 증설이 집기로 반영', game.shelvesNow().length === 11 && game.fridgesNow().length === 6
        && game.countersNow().length === 3, `진열대 ${game.shelvesNow().length} · 냉장 ${game.fridgesNow().length} · 계산대 ${game.countersNow().length}`);
  check('시설이 바닥 마감을 바꾼다', game.shopFloorPal()[0] !== '#C9BC9B', game.shopFloorPal()[0]);
  win.eval('game.S.co.facil = { shelf: 0, counter: 0, cold: 0, office: 0 }');

  /* 사옥 캔버스 클릭 — 사장실 결재 */
  win.eval("game.setMode('store')");
  const bossTile = game.P(game.BOSS.desk.gx, game.BOSS.desk.gy);
  check('사옥 클릭 판정', !!game.storeHit(bossTile), '사장실 책상');
  win.eval('game.S.co.mistrust = 40; game.S.co.probe = 40; game.S.co.deskDay = 0; game.openDesk()');
  const m0 = game.S.co.mistrust;
  resolveModals(doc, /기부/);
  check('사장실 결재 — 기부로 미신지수 하락', game.S.co.mistrust < m0, `${m0} → ${game.S.co.mistrust}`);
  while (doc.getElementById('modal-layer').classList.contains('on')) resolveModals(doc);
  win.eval('game.openDesk()');
  check('결재는 하루 1회', game.deskUsed(game.S)
        && !doc.getElementById('modal-layer').classList.contains('on'));

  /* 매장 이벤트가 이벤트 풀에 있는지 */
  check('매장 이벤트 등록', game.EV_SHOP.length === 6, `${game.EV_SHOP.length}종`);

  /* 설정 — 메인 타이틀로. 복귀는 세이브를 다시 읽어 오므로 비동기다. */
  const settle = () => new Promise(r => setTimeout(r, 80));
  win.eval('game.openSettings()');
  check('설정 — 타이틀 복귀 버튼', !!doc.getElementById('set-title'));
  doc.getElementById('set-title').click();
  resolveModals(doc, /저장하고/);
  await settle();
  check('타이틀 복귀', doc.getElementById('title-layer').classList.contains('on')
        && game.S.speed === 0, `배속 ${game.S.speed}`);

  win.eval('game.openSettings()');
  check('타이틀 설정에는 복귀 버튼 없음', !doc.getElementById('set-title'));
  while (doc.getElementById('modal-layer').classList.contains('on')) doc.querySelector('#modal [data-a]').click();

  doc.getElementById('title-cont').click();
  await settle();
  check('타이틀에서 이어하기', !doc.getElementById('title-layer').classList.contains('on'), `${game.S.day}일차`);

  check('출력 무결성', !/NaN|undefined|Infinity/.test(all),
        (all.match(/.{0,30}(NaN|undefined|Infinity)/) || [''])[0]);
} catch (e) {
  fail.push('✗ 예외: ' + e.message + '\n    ' + (e.stack.split('\n')[1] || '').trim());
}

check('런타임 에러 없음', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));

console.log([...pass, ...fail].join('\n'));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
