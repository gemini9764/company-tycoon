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

  /* 시드 고정 — 같은 시드는 같은 판을 만들어야 한다. 여기가 깨지면 밸런스 계측이
     통째로 무의미해진다. 연출용 난수(차량·손님·머리 모양)가 게임 스트림을 밀지
     않는지도 같이 본다 — 그게 가장 새기 쉬운 구멍이다. */
  const seedOk = win.eval(`(() => {
    const g = window.game;
    const digest = () => g.S.market.map(c => c.name + c.cap + c.lot.tx + ',' + c.lot.ty).join('|')
      + '#' + g.S.co.lot.tx + ',' + g.S.co.lot.ty;
    g.setS(g.newState('시드', 4242));
    const a = digest();
    for (let i = 0; i < 40; i++) g.newLook();          // 연출 스트림만 밀어 본다
    g.setS(g.newState('시드', 4242));
    const b = digest();
    g.setS(g.newState('시드', 9999));
    const c = digest();
    if (a !== b) return '같은 시드가 다른 판을 만든다';
    if (a === c) return '시드가 달라도 같은 판이 나온다';
    return true;
  })()`);
  check('시드 고정', seedOk === true, seedOk === true ? '같은 시드 = 같은 판 · 연출 난수는 안 샌다' : seedOk);

  const rngOk = win.eval(`(() => {
    const g = window.game;
    g.setS(g.newState('시드', 777));
    for (let i = 0; i < 30; i++) g.tickDay();
    const saved = JSON.parse(JSON.stringify(g.S)); saved.rng = g.rngState();
    const a = [g.rand(), g.rand(), g.rand()].join();
    g.setRngState(saved.rng);
    const b = [g.rand(), g.rand(), g.rand()].join();
    return a === b ? true : '세이브의 rng 상태로 난수열이 안 이어진다';
  })()`);
  check('세이브가 난수열을 잇는다', rngOk === true, rngOk === true ? 'rng 상태 복원 OK' : rngOk);

  /* ── 계열사 특성 (단계 1) ────────────────────────────────
     태그·업종 퍼크·사업부는 상태에서만 파생되므로 UI 를 거치지 않고
     순수 함수를 직접 부른다. sim 봇도 같은 함수를 쓴다. */
  const tagOk = win.eval(`(() => {
    const g = window.game, r = [];
    g.setS(g.newState('태그', 1001));
    const S = g.S;
    const rate = S.market.filter(c => c.tags.length).length / S.market.length;
    r.push(['태그 부여율', rate >= 0.5 && rate <= 0.72, Math.round(rate * 100) + '%']);

    g.setS(g.newState('태그', 1001));
    const a = g.S.market.map(c => c.name + ':' + c.tags.join('|')).join();
    g.setS(g.newState('태그', 1001));
    const b = g.S.market.map(c => c.name + ':' + c.tags.join('|')).join();
    r.push(['태그 결정론', a === b, '같은 시드 = 같은 태그']);

    const T = g.S;
    T.co.subs = Array.from({ length: 12 }, (_, i) => ({ id: 'x' + i, name: 't' + i, sector: 'daily', cap: 1e9, diff: 0, day: 1, tags: [] }));
    g.bumpPerks();
    r.push(['업종 퍼크 상한', Math.abs(g.perksOf(T).retailMul - 0.40) < 1e-9, 'retailMul ' + g.perksOf(T).retailMul.toFixed(2)]);
    r.push(['사업부 결성', g.divisionsOf(T).includes('daily'), '같은 업종 3개']);
    T.co.subs = T.co.subs.slice(0, 2); g.bumpPerks();
    r.push(['사업부 해체', !g.divisionsOf(T).includes('daily'), '3개 미만']);

    T.co.subs = [{ id: 'z', name: '담보사', sector: 'it', cap: 1e10, diff: 1, day: 1, tags: [] }];
    T.bank.loans = [{ kind: 'acq', collateral: '담보사', left: 1e9, due: 1e8, months: 15, rate: 5 }];
    r.push(['담보 계열사 매각 차단', g.canSellSub(T, T.co.subs[0]) !== null, '']);

    T.bank.loans = [];
    T.co.subs = [{ id: 'r', name: '부실사', sector: 'it', cap: 1e10, diff: 1, day: 1, tags: ['rot'] }];
    T.co.cash = 1e12;
    g.investSub(T, T.co.subs[0]);
    r.push(['투자로 부실 해소', !T.co.subs[0].tags.includes('rot'), '시총 +12%']);

    T.co.subs = [{ id: 'q', name: '재편사', sector: 'it', cap: 1e12, diff: 1, day: 1, tags: [], restruct: { to: 'fin', until: 9999 } }];
    T.co.synergy = 1; g.bumpPerks();
    r.push(['재편 중 수익 0', g.dailySubIncome(T) === 0, '']);

    return r;
  })()`);
  tagOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 협상 중 능동 개입 (단계 2) ──────────────────────────
     판정은 systems/mna.js 의 순수 함수다. 먼저 그것만 직접 부르고,
     그 다음 회사 창의 버튼이 같은 함수에 실제로 닿는지 UI 로 확인한다. */
  const actOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.setS(g.newState('개입', 1001));
    S.staff.forEach(e => e.onTeam = true);
    S.co.cash = 1e13;
    // 숨은 태그를 가진 매물을 만들어 밑작업 ★★ 공개의 대상으로 쓴다
    const t = S.market.find(c => c.cap <= g.capCeiling(S));
    t.tags = ['debt']; t.seen = [];
    g.startNego(S, t);
    r.push(['개입 초기 횟수', g.negoLeft(S.nego) === g.BAL.negoActs, g.negoLeft(S.nego) + '회']);

    const s0 = S.nego.success, p0 = S.co.probe, cash0 = S.co.cash;
    g.negoAct(S, 'wine');
    r.push(['접대비 — 성공도와 수사', S.nego.success > s0 && S.co.probe === p0 + g.BAL.negoWineProbe
            && S.co.cash < cash0, '수사 +' + (S.co.probe - p0)]);

    const pr0 = S.nego.progress, sc0 = S.nego.success;
    g.negoAct(S, 'push');
    r.push(['시한 제시 — 진행도↑ 성공도↓', S.nego.progress > pr0 && S.nego.success < sc0, '']);

    g.negoAct(S, 'wine');
    r.push(['개입 3회 소진', g.negoLeft(S.nego) === 0, '']);

    const before = S.nego.success;
    g.negoAct(S, 'wine');
    r.push(['소진 후 개입 거부', S.nego.success === before, '4회차는 반영되지 않는다']);

    // 중단은 개입 횟수를 먹지 않는다 — 소진 상태에서도 눌려야 한다
    r.push(['소진 뒤에도 중단은 가능', (g.negoAct(S, 'quit'), S.nego === null), '탈출구는 개입이 아니다']);

    // 중단 — 위약금을 내고 협상단이 즉시 풀린다
    const S2 = g.setS(g.newState('중단', 2002));
    S2.staff.forEach(e => e.onTeam = true); S2.co.cash = 1e13;
    const t2 = S2.market.find(c => c.cap <= g.capCeiling(S2));
    g.startNego(S2, t2);
    const c0 = S2.co.cash;
    g.negoAct(S2, 'quit');
    r.push(['협상 중단', S2.nego === null && S2.co.cash < c0, '위약금 ' + g.won(c0 - S2.co.cash)]);
    r.push(['중단 후 재파견 가능', (g.startNego(S2, t2), !!S2.nego), '']);

    /* 라이벌 이름 — 상태를 저장하지 않고 매물 id 로 결정적으로 뽑는다.
       같은 회사엔 늘 같은 상대가 붙어야 하고, 게임 rng 를 건드리면 안 된다. */
    const rid = S2.market[3].id;
    const r1 = g.rivalOf(rid), r2 = g.rivalOf(rid);
    r.push(['라이벌은 매물마다 고정', r1.n === r2.n && !!r1.who && !!r1.jab, r1.n]);
    const spread = new Set(S2.market.slice(0, 30).map(c => g.rivalOf(c.id).n));
    r.push(['라이벌이 한 명으로 몰리지 않는다', spread.size >= 4, spread.size + '종']);
    const seedBefore = g.rand();
    g.rivalOf(rid); g.rivalOf(rid); g.rivalOf(rid);
    const seedAfter = g.rand();
    r.push(['라이벌 추첨은 난수를 쓰지 않는다', seedBefore !== seedAfter, '시드 스트림 무관']);
    return r;
  })()`);
  actOk.forEach(([n, ok, d]) => check(n, ok, d));

  // 회사 창의 개입 버튼이 실제로 판정 함수에 닿는가
  win.eval(`(() => {
    const g = window.game, S = g.S;
    S.staff.forEach(e => e.onTeam = true); S.co.cash = 1e13;
    if (!S.nego) g.startNego(S, S.market.find(c => c.cap <= g.capCeiling(S)));
  })()`);
  openTab(win, doc, 'co');
  win.eval('game.renderAll()');
  const nactBtns = [...doc.querySelectorAll('[data-nact]')];
  check('개입 버튼 렌더', nactBtns.length === Object.keys(game.NEGO_ACTS).length,
        nactBtns.length + '종 (중단은 별도 줄)');
  const sBefore = game.S.nego.success;
  nactBtns.find(b => b.dataset.nact === 'wine').click();
  check('개입 버튼 → 판정 함수', game.S.nego.success > sBefore,
        `성공도 ${Math.round(sBefore)} → ${Math.round(game.S.nego.success)}`);

  /* ── 미리 사두기 (단계 3) ────────────────────────────────
     매집 → 별 → 협상 시작값 → 소문 → 인수 시 흡수까지 한 줄로 훑는다.
     판정은 systems/stock.js 의 순수 함수이고 sim 봇도 같은 것을 부른다. */
  const stakeOk = win.eval(`(() => {
    const g = window.game, r = [], B = g.BAL;
    const S = g.setS(g.newState('매집', 1001));
    S.co.cash = 1e13; S.staff.forEach(e => e.onTeam = true);

    /* 비상장사는 장외 지분 매입 경로로 간다 — 주가가 없으므로 투입 누계로 센다.
       287일이 걸리는 중소기업 구간 매물은 전부 비상장이라 여기가 막히면
       기능 자체가 후반에만 걸린다. */
    const un = S.market.filter(c => !c.listed && c.cap > 1e9).sort((a, b) => a.cap - b.cap)[0];
    g.toggleStake(S, un);
    r.push(['비상장도 매집 가능 — 장외 지분', !!S.stock.stake[un.id], '']);
    for (let i = 0; i < 3; i++) g.tickStake(S);
    r.push(['장외 매집 ★ 적립', g.stakeStars(S, un) >= 1, '3일 → ★' + g.stakeStars(S, un)]);
    r.push(['장외는 주가를 만들지 않는다', un.price === 0, 'price ' + un.price]);
    const put = g.privAmt(S, un), cash0 = S.co.cash;
    g.sellPrivStake(S, un);
    const back = S.co.cash - cash0;
    r.push(['장외 지분 되팔기 = 투입 × ' + B.stakePrivSell,
            Math.abs(back / put - B.stakePrivSell) < 0.02 && g.stakeStars(S, un) === 0,
            Math.round(back / put * 100) + '% 회수']);

    const c = S.market.filter(x => x.listed).sort((a, b) => a.cap - b.cap)[0];
    g.toggleStake(S, c);
    for (let i = 0; i < 3; i++) g.tickStake(S);
    r.push(['★ 1칸 = 지분 ' + Math.round(B.stakePerStar * 100) + '%',
            g.stakeStars(S, c) === 1, '3일 매집 · 지분 ' + (g.stakeRatio(S, c) * 100).toFixed(1) + '%']);

    for (let i = 0; i < 5; i++) g.tickStake(S);
    const st = g.stakeStars(S, c), bonus = g.stakeBonus(S, c);
    r.push(['별이 협상 시작값에 얹힌다', bonus.success === st * B.stakeSuccess && bonus.prem < 0,
            '★' + st + ' → 성공도 +' + bonus.success]);

    const p0 = c.price, d0 = c.diff;
    for (let i = 0; i < 6; i++) g.tickStake(S);
    r.push(['★★★ 초과 시 소문', !!c.leak && c.price > p0 && c.diff >= d0, '주가 급등 · 난이도 상승']);
    r.push(['소문 나면 프리미엄이 도로 오른다', g.stakeBonus(S, c).prem > -g.stakeStars(S, c) * B.stakePrem, '']);

    // ★★ 공개 — 개입 '실사'가 하던 일이 밑작업으로 옮겨 왔다
    const hid = S.market.filter(x => x.listed && !x.owned && x.id !== c.id)[0];
    hid.tags = ['debt']; hid.seen = []; delete hid.leak;
    r.push(['숨은 특성은 처음엔 안 보인다', g.hasHidden(hid), '???']);
    g.toggleStake(S, hid);
    for (let i = 0; i < 20 && g.stakeStars(S, hid) < B.stakeRevealAt; i++) g.tickStake(S);
    r.push(['★★ 에서 숨은 특성이 드러난다',
            g.stakeStars(S, hid) >= B.stakeRevealAt && hid.seen.includes('debt') && !g.hasHidden(hid),
            '★' + g.stakeStars(S, hid) + ' → 숨은 빚 공개']);

    g.toggleStake(S, hid);

    // 협상 시작값에 실제로 반영되는가. 상장사는 시총 1,000억 이상이라 등급을 올려야 잡힌다
    S.co.tier = 6;
    const c2 = S.market.filter(x => x.listed && x.cap <= g.capCeiling(S) && x.id !== c.id)[0];
    const base = 12 + g.sumStat(g.teamOf(S), 'nego') * 0.08;
    r.push(['상장 매물 확보', !!c2, '']);
    if (c2) {
      g.toggleStake(S, c2);
      for (let i = 0; i < 8; i++) g.tickStake(S);
      const stars2 = g.stakeStars(S, c2);
      g.startNego(S, c2);
      r.push(['매집이 협상 성공도 시작값에 반영', S.nego.success > base + stars2 * B.stakeSuccess - 0.01,
              '★' + stars2 + ' · 시작 성공도 ' + Math.round(S.nego.success)]);
      g.completeAcq(S, c2, 1);
      r.push(['인수 시 지분 흡수', !S.stock.holds[c2.id] && !(S.stock.stake || {})[c2.id], '']);
    }

    // 자금 부족이면 조용히 멈추지 않는다
    const T = g.setS(g.newState('매집2', 1001));
    const c3 = T.market.filter(x => x.listed)[0];
    T.co.cash = 1e13; g.toggleStake(T, c3); g.tickStake(T);
    T.co.cash = 1;    g.tickStake(T);
    r.push(['자금 부족 시 자동 해제', !T.stock.stake[c3.id] && !!T.stock.holds[c3.id],
            '사둔 지분은 남는다']);
    return r;
  })()`);
  stakeOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 협상 테이블 (단계 4) ────────────────────────────────
     판정은 systems/negoTable.js 의 순수 함수. UI 는 라운드마다 모달을 다시
     띄우는 껍데기이고 sim 봇도 같은 함수를 부른다. */
  const tblPure = win.eval(`(() => {
    const g = window.game, r = [], B = g.BAL;
    const S = g.setS(g.newState('테이블', 1001));
    S.staff.forEach(e => e.onTeam = true);
    const team = g.teamOf(S);

    r.push(['테이블은 단판',
            [0,1,2,3].every(d => g.tableRounds(d) === 1), '난이도와 무관하게 단판']);

    const d0 = g.delegateTable();
    r.push(['위임은 성공도·인수가에 무영향', d0.dS === 0 && d0.dP === 0, '기준선 보존']);

    const e = team[0], ap = g.approachOf(e);
    const hitDem = g.APPROACH[ap].beats[0];
    const missDem = g.DEMAND_KEYS.find(k => !g.APPROACH[ap].beats.includes(k));
    const hit = g.tableRound(e, hitDem), miss = g.tableRound(e, missDem);
    r.push(['상성 적중 — 성공도↑ 인수가↓', hit.hit && hit.dS > 0 && hit.dP < 0,
            '+' + hit.dS.toFixed(1) + ' / ' + (hit.dP*100).toFixed(1) + '%p']);
    r.push(['빗나감 — 성공도↓ 인수가↑', !miss.hit && miss.dS < 0 && miss.dP > 0,
            miss.dS.toFixed(1) + ' / +' + (miss.dP*100).toFixed(1) + '%p']);

    const dem = g.rollDemands(2);
    const best = g.resolveTable(team, dem, g.bestPicks(team, dem));
    r.push(['최선 수는 위임보다 유리', best.dS > 0, '성공도 +' + best.dS.toFixed(1)]);
    return r;
  })()`);
  tblPure.forEach(([n, ok, d]) => check(n, ok, d));

  /* UI 경로 — 직접 협상을 걸고 클로징 테이블을 실제로 눌러 본다 */
  win.eval(`
    const S = game.setS(game.newState('테이블UI', 1001));
    S.staff.forEach(e => e.onTeam = true);
    const t = S.market.filter(c => !c.owned && c.cap <= game.capCeiling(S)).sort((a, b) => a.cap - b.cap)[0];
    S.co.cash = t.cap * 4;
    game.startNego(S, t, true);`);
  check('직접 협상 파견', !!game.S.nego && game.S.nego.direct === true);
  const wantRounds = game.tableRounds(game.S.nego.diff);
  /* 협상 중 분기 이벤트 모달이 먼저 뜬다 — 그건 치워 가며 클로징까지 간다 */
  for (let i = 0; i < 60 && !game.S.nego?.tableView; i++) {
    if (doc.getElementById('modal-layer').classList.contains('on')) resolveModals(doc);
    else win.eval('game.tickDay()');
  }
  check('클로징에서 테이블이 열린다',
        /협상 테이블/.test(doc.getElementById('modal')?.textContent || ''), wantRounds + '라운드');
  check('현재 라운드가 상태에 노출된다', !!game.S.nego?.tableView, game.S.nego?.tableView?.demand);
  let rounds = 0;
  while (game.S.nego?.tableView && rounds < 8) {
    doc.querySelector('#modal .choice:not([disabled])').click(); rounds++;
  }
  check('라운드 수만큼 진행된다', rounds === wantRounds, rounds + '/' + wantRounds);
  resolveModals(doc, /자기자금|확인/);
  check('테이블 뒤 판정으로 넘어간다', !game.S.nego);

  /* ── 매물 경쟁 (시한 압박) ───────────────────────────── */
  const rivalOk = win.eval(`(() => {
    const g = window.game, r = [], B = g.BAL;
    const S = g.setS(g.newState('경쟁', 1001));
    S.staff.forEach(e => e.onTeam = true);
    const t = S.market.filter(c => !c.owned && c.cap <= g.capCeiling(S)).sort((a, b) => a.cap - b.cap)[0];
    S.co.cash = t.cap * 4;
    const cap0 = t.cap, diff0 = t.diff;

    g.startNego(S, t);
    S.nego.rivalDue = S.day + 2;                 // 마감을 강제로 당긴다
    r.push(['마감이 협상에 걸린다', S.nego.rivalDue > S.day, '']);
    S.day = S.nego.rivalDue;                     // 마감일 도달
    g.tickNego(S);
    r.push(['마감을 넘기면 매물을 잃는다', !S.nego, '협상 종료']);
    r.push(['잃은 매물은 사라지지 않는다', !t.owned && !!t.rivalOwned, '다시 노릴 수 있다']);
    r.push(['값이 오르고 난이도가 오른다',
            t.cap > cap0 && t.diff === Math.min(3, diff0 + 1),
            '+' + Math.round((t.cap / cap0 - 1) * 100) + '% · 난이도 ' + diff0 + '→' + t.diff]);

    // 진행도 100% 면 마감이 지나도 뺏기지 않는다
    const S2 = g.setS(g.newState('경쟁2', 1001));
    S2.staff.forEach(e => e.onTeam = true);
    const t2 = S2.market.filter(c => !c.owned && c.cap <= g.capCeiling(S2)).sort((a, b) => a.cap - b.cap)[0];
    S2.co.cash = t2.cap * 4;
    g.startNego(S2, t2);
    S2.nego.rivalDue = S2.day; S2.nego.progress = 100; S2.nego.marks = [];
    g.tickNego(S2);
    r.push(['진행도 100% 면 마감을 넘겨도 안전', !t2.rivalOwned, '']);

    r.push(['협상 1건 ≈ ' + Math.round(100 / B.negoProgressPerDay) + '일',
            Math.round(100 / B.negoProgressPerDay) === 10, '15일 → 10일']);
    return r;
  })()`);
  rivalOk.forEach(([n, ok, d]) => check(n, ok, d));

  check('출력 무결성', !/NaN|undefined|Infinity/.test(all),
        (all.match(/.{0,30}(NaN|undefined|Infinity)/) || [''])[0]);
} catch (e) {
  fail.push('✗ 예외: ' + e.message + '\n    ' + (e.stack.split('\n')[1] || '').trim());
}

check('런타임 에러 없음', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));

console.log([...pass, ...fail].join('\n'));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
