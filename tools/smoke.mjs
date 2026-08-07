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
  /* 스타터 매물 — M&A 는 등급으로 잠겨 있지 않다(구멍가게도 capCeiling 3억).
     늦는 이유는 최저 매물값이라, 맨 아래 세 칸을 따로 깐다. 이게 없으면
     자기자금으로 최저 인수가에 닿는 데 43~50일, 실제 첫 인수는 117일차였다. */
  {
    const cheap = [...game.S.market].sort((a, b) => a.cap - b.cap);
    const first = cheap[0];
    const price = first.cap * (1 + game.DIFFS[first.diff].prem);
    check('스타터 매물이 깔린다', cheap.slice(0, 3).every(c => c.cap < 4e7),
          cheap.slice(0, 3).map(c => game.won(c.cap)).join(' · '));
    check('첫 매물은 등급 상한 안에 있다', first.cap <= game.capCeiling(game.S),
          `상한 ${game.won(game.capCeiling(game.S))}`);
    check('첫 매물 난이도는 하', first.diff === 0, game.DIFFS[first.diff].name);
    /* 승급 목표가 첫 인수가보다 낮아야 '자금 → 행동' 순서가 유지된다.
       역전되면 순자산 목표를 찍는 순간 동네슈퍼 → 스타트업 이 이틀 사이
       두 번 터진다 (§11-2 가 대기업에서 겪은 증상). */
    check('구멍가게 목표 < 첫 인수가', 1e7 < price,
          `목표 ${game.won(1e7)} < 인수가 ${game.won(price)}`);
  }

  check('창업 후 HUD 렌더', text('hud').includes('테스트상사'));
  check('첫 인수 후보를 짚어 준다',
        game.S.inbox.some(m => m.title === '첫 인수 후보'),
        game.S.inbox.find(m => m.title === '첫 인수 후보') ? '인박스에 등록' : '없음');

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

  /* 고용은 '직원' 이 아니라 '고용' 창으로 옮겼다. 모집 방법 → 지원자 → 고용
     세 단계를 UI 경로로 그대로 밟는다 (ui/hirePanel.js). */
  win.eval('game.S.co.cash = 1e12;');
  openTab(win, doc, 'hire');
  check('모집 방법이 뜬다', doc.querySelectorAll('[data-way]').length === game.HIRE_WAYS.length,
        doc.querySelectorAll('[data-way]').length + '종');
  doc.querySelector('[data-way]:not([disabled])').click();
  const cands = doc.querySelectorAll('[data-hire]');
  check('지원자가 나온다', cands.length > 0, cands.length + '명');
  const before = game.S.staff.length;
  cands[0].click();
  check('직원 영입', game.S.staff.length === before + 1);

  // 정원이 차면 해고 비교 화면으로 넘어간다
  win.eval(`(() => { const g = window.game, S = g.S;
    while (S.staff.length < g.staffCap(S)) S.staff.push(g.makeStaff(1));
  })()`);
  win.eval('game.renderAll()');
  const more = doc.querySelector('[data-hire]');
  if (more) more.click();
  check('정원이 차면 내보낼 사람을 고르게 한다',
        doc.querySelectorAll('[data-swap]').length === game.S.staff.length,
        '비교 대상 ' + doc.querySelectorAll('[data-swap]').length + '명');
  const cash0 = game.S.co.cash, head0 = game.S.staff.length;
  const swap = doc.querySelector('[data-swap]:not([disabled])');
  if (swap) swap.click();
  check('교체해도 정원은 그대로', game.S.staff.length === head0 && game.S.co.cash < cash0, '');

  openTab(win, doc, 'bank');
  const loan = doc.querySelector('[data-loan]:not([disabled])');
  if (loan) loan.click();
  check('대출 실행', game.debtTotal(game.S) > 0, game.won(game.debtTotal(game.S)));
  const repay = doc.querySelector('[data-repay]:not([disabled])');
  if (repay) repay.click();
  check('일시 상환', game.debtTotal(game.S) === 0);

  /* ── 은행 — 연체와 압류 ────────────────────────────────────
     연체는 **연속** 3회에 파산이다. 예전에는 영구 누적이라 초반에 세 번
     미끄러지면 회복이 불가능했고, 압류까지 같은 카운트를 올려 인수 대출
     3건이 압류되면 그 자체로 파산이었다. 반대로 압류가 대출을 통째로
     지우고 있어서, 카운트에서 빼자 '빌려 쓰고 회사만 반납' 이 무료
     탈출구가 됐다 (reckless 0/6 파산 · 무차입보다 20% 빠름). */
  const bankOk = win.eval(`(() => {
    const g = window.game, r = [], B = g.BAL;
    /* 이 블록은 별도 판을 만들어 쓴다. **끝나면 반드시 원래 판으로 되돌린다** —
       아래로 이어지는 검사들이 같은 플레이스루를 계속 쓰기 때문이다. */
    const keep = g.S;

    // 연체 → 정상 상환 → 초기화
    const S = g.setS(g.newState('연체', 1001));
    S.co.cash = 1e9; g.takeLoan(S, 'op', 1e9, null);
    S.co.cash = 0; g.tickMonth(S);
    const after1 = S.bank.overdue;
    S.co.cash = 1e12; g.tickMonth(S);
    r.push(['연체가 쌓인다', after1 === 1, after1 + '회']);
    r.push(['정상 상환하면 연체가 초기화된다', S.bank.overdue === 0, after1 + ' → ' + S.bank.overdue]);

    // 압류 — 담보를 가져가되 부족분은 무담보 채무로 남는다
    const T = g.setS(g.newState('압류', 1001));
    const t = T.market.find(c => c.cap <= g.capCeiling(T));
    T.co.cash = 1e13; g.completeAcq(T, t, t.cap);
    const sub = T.co.subs[T.co.subs.length - 1];
    const loan = t.cap * 3;                       // 처분가(cap × subSellRate)로는 못 갚는 규모
    T.co.cash = 0;
    T.bank.loans.push({ kind: 'acq', principal: loan, left: loan, rate: 8,
                        months: B.loanTermMonths, due: loan, collateral: sub.name });
    const subs0 = T.co.subs.length;
    g.tickMonth(T);
    r.push(['상환 실패 시 담보 계열사를 잃는다', T.co.subs.length === subs0 - 1, subs0 + ' → ' + T.co.subs.length]);
    r.push(['압류도 연체로 센다', T.bank.overdue >= 1, T.bank.overdue + '회']);
    r.push(['처분가로 못 갚은 만큼은 채무로 남는다',
            g.debtTotal(T) > 0 && T.bank.loans.every(l => !l.collateral),
            '잔여 ' + Math.round(g.debtTotal(T) / 1e8) + '억 · 무담보']);

    g.setS(keep);
    return r;
  })()`);
  bankOk.forEach(([n, ok, d]) => check(n, ok, d));

  win.eval(`
    game.S.staff.forEach(e => { e.onTeam = true; e.slot = 0; });
    const t = game.S.market.filter(c => !c.owned && c.cap <= game.capCeiling(game.S))
                           .sort((a, b) => a.cap - b.cap)[0];
    game.S.co.cash = t.cap * 4;
    game.startNego(game.S, t);`);
  check('협상 시작', !!game.negosOf(game.S)[0], game.negosOf(game.S)[0]?.name);
  const subsBefore = game.S.co.subs.length;
  for (let i = 0; i < 60 && game.negosOf(game.S)[0]; i++) { win.eval('game.tickDay()'); resolveModals(doc); }
  resolveModals(doc, /자기자금/);
  check('협상 사이클 완주', !game.negosOf(game.S)[0]);
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
  /* 계산대는 단계마다 한 대씩 늘어난다 — 기본 2 + 증설 3. 예전에는 목록이
     한 칸뿐이라 1단계든 3단계든 3대로 고정이었다. */
  check('시설 증설이 집기로 반영', game.shelvesNow().length >= 11 && game.fridgesNow().length === 6
        && game.countersNow().length === 5 && game.clerksNow().length === 3,
        `진열대 ${game.shelvesNow().length} · 냉장 ${game.fridgesNow().length} · 계산대 ${game.countersNow().length} · 점원 ${game.clerksNow().length}`);
  check('시설이 바닥 마감을 바꾼다', game.shopFloorPal()[0] !== '#C9BC9B', game.shopFloorPal()[0]);
  win.eval('game.S.co.facil = { space: 0, shelf: 0, counter: 0, cold: 0, office: 0 }');

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
    r.push(['개입 초기 횟수 — 위임', g.negoLeft(g.negosOf(S)[0]) === g.BAL.negoActs, g.negoLeft(g.negosOf(S)[0]) + '회']);

    /* 직접 협상은 개입 1회를 먼저 뗀다. 공짜였을 때는 클릭 한 번에 결렬률이
       49% → 21% 로 내려가 위임이 죽은 선택지였다. */
    {
      const U = g.setS(g.newState('개입직접', 1001));
      U.staff.forEach(e => e.onTeam = true); U.co.cash = 1e13;
      const t2 = U.market.find(c => c.cap <= g.capCeiling(U));
      g.startNego(U, t2, true);
      const n2 = g.negosOf(U)[0];
      r.push(['직접 협상은 개입 1회를 쓴다', g.negoLeft(n2) === g.BAL.negoActs - 1 && n2.direct === true,
              g.negoLeft(n2) + '회 남음']);
      g.setS(S);
    }

    const s0 = g.negosOf(S)[0].success, p0 = S.co.probe, cash0 = S.co.cash;
    g.negoAct(S, 'wine');
    r.push(['접대비 — 성공도와 수사', g.negosOf(S)[0].success > s0 && S.co.probe === p0 + g.BAL.negoWineProbe
            && S.co.cash < cash0, '수사 +' + (S.co.probe - p0)]);

    const pr0 = g.negosOf(S)[0].progress, sc0 = g.negosOf(S)[0].success;
    g.negoAct(S, 'push');
    r.push(['시한 제시 — 진행도↑ 성공도↓', g.negosOf(S)[0].progress > pr0 && g.negosOf(S)[0].success < sc0, '']);

    g.negoAct(S, 'wine');
    r.push(['개입 3회 소진', g.negoLeft(g.negosOf(S)[0]) === 0, '']);

    const before = g.negosOf(S)[0].success;
    g.negoAct(S, 'wine');
    r.push(['소진 후 개입 거부', g.negosOf(S)[0].success === before, '4회차는 반영되지 않는다']);

    // 중단은 개입 횟수를 먹지 않는다 — 소진 상태에서도 눌려야 한다
    r.push(['소진 뒤에도 중단은 가능', (g.negoAct(S, 'quit'), g.negosOf(S).length === 0), '탈출구는 개입이 아니다']);

    // 중단 — 위약금을 내고 협상단이 즉시 풀린다
    const S2 = g.setS(g.newState('중단', 2002));
    S2.staff.forEach(e => e.onTeam = true); S2.co.cash = 1e13;
    const t2 = S2.market.find(c => c.cap <= g.capCeiling(S2));
    g.startNego(S2, t2);
    const c0 = S2.co.cash;
    g.negoAct(S2, 'quit');
    r.push(['협상 중단', g.negosOf(S2).length === 0 && S2.co.cash < c0, '위약금 ' + g.won(c0 - S2.co.cash)]);
    r.push(['중단 후 재파견 가능', (g.startNego(S2, t2), !!g.negosOf(S2)[0]), '']);

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
    if (!g.negosOf(S).length) g.startNego(S, S.market.find(c => c.cap <= g.capCeiling(S)));
  })()`);
  openTab(win, doc, 'co');
  win.eval('game.renderAll()');
  const nactBtns = [...doc.querySelectorAll('[data-nact]')];
  check('개입 버튼 렌더', nactBtns.length === Object.keys(game.NEGO_ACTS).length,
        nactBtns.length + '종 (중단은 별도 줄)');
  const sBefore = game.negosOf(game.S)[0].success;
  nactBtns.find(b => b.dataset.nact === 'wine').click();
  check('개입 버튼 → 판정 함수', game.negosOf(game.S)[0].success > sBefore,
        `성공도 ${Math.round(sBefore)} → ${Math.round(game.negosOf(game.S)[0].success)}`);

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
      r.push(['매집이 협상 성공도 시작값에 반영', g.negosOf(S)[0].success > base + stars2 * B.stakeSuccess - 0.01,
              '★' + stars2 + ' · 시작 성공도 ' + Math.round(g.negosOf(S)[0].success)]);
      g.completeAcq(S, c2, 1);
      r.push(['인수 시 지분 흡수', !S.stock.holds[c2.id] && !(S.stock.stake || {})[c2.id], '']);
    }

    /* 자금 부족이면 조용히 멈추지 않되 **끄지도 않는다.**
       예전에는 토글을 지워서, ★ 한 칸이 차기까지 2.5일 걸리는 매집이 하루만
       현금에 스쳐도 투입금만 남고 ★ 는 안 붙었다 (계측 평균 ★0.47). */
    const T = g.setS(g.newState('매집2', 1001));
    const c3 = T.market.filter(x => x.listed)[0];
    T.co.cash = 1e13; g.toggleStake(T, c3); g.tickStake(T);
    const qty0 = T.stock.holds[c3.id].qty;
    T.co.cash = 1;    g.tickStake(T);
    r.push(['자금 부족이면 쉰다 — 끄지 않는다', T.stock.stake[c3.id] === 'paused' && !!T.stock.holds[c3.id],
            '사둔 지분은 남는다']);
    r.push(['쉬는 동안은 안 산다', T.stock.holds[c3.id].qty === qty0, '']);
    T.co.cash = 1e13; g.tickStake(T);
    r.push(['자금이 생기면 이어서 산다', T.stock.stake[c3.id] === true && T.stock.holds[c3.id].qty > qty0,
            qty0 + ' → ' + T.stock.holds[c3.id].qty]);
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

    /* 두 접근으로 요구 4종을 다 덮으면 편성 한 번으로 적중률이 100% 가 되어
       테이블이 판단이 아니게 된다. 예전 표(설득 job·delay / 자료 price·data)가
       정확히 그랬다 — 위임 결렬률 49% vs 직접 21%.
       네 종을 다 덮으려면 세 접근을 전부 갖춰야 한다. */
    const AK = Object.keys(g.APPROACH);
    const cover = ks => g.DEMAND_KEYS.filter(d => ks.some(k => g.APPROACH[k].beats.includes(d))).length;
    const pairs = [];
    for (let i = 0; i < AK.length; i++) for (let j = i + 1; j < AK.length; j++) pairs.push([AK[i], AK[j]]);
    r.push(['두 접근으로는 요구를 다 못 덮는다', pairs.every(p => cover(p) < g.DEMAND_KEYS.length),
            pairs.map(p => cover(p)).join('/') + ' of ' + g.DEMAND_KEYS.length]);
    r.push(['세 접근을 다 갖추면 덮인다', cover(AK) === g.DEMAND_KEYS.length, '']);

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
  check('직접 협상 파견', !!game.negosOf(game.S)[0] && game.negosOf(game.S)[0].direct === true);
  const wantRounds = game.tableRounds(game.negosOf(game.S)[0].diff);
  /* 협상 중 분기 이벤트 모달이 먼저 뜬다 — 그건 치워 가며 클로징까지 간다 */
  for (let i = 0; i < 60 && !game.negosOf(game.S)[0]?.tableView; i++) {
    if (doc.getElementById('modal-layer').classList.contains('on')) resolveModals(doc);
    else win.eval('game.tickDay()');
  }
  check('클로징에서 테이블이 열린다',
        /협상 테이블/.test(doc.getElementById('modal')?.textContent || ''), wantRounds + '라운드');
  check('현재 라운드가 상태에 노출된다', !!game.negosOf(game.S)[0]?.tableView, game.negosOf(game.S)[0]?.tableView?.demand);
  let rounds = 0;
  while (game.negosOf(game.S)[0]?.tableView && rounds < 8) {
    doc.querySelector('#modal .choice:not([disabled])').click(); rounds++;
  }
  check('라운드 수만큼 진행된다', rounds === wantRounds, rounds + '/' + wantRounds);
  resolveModals(doc, /자기자금|확인/);
  check('테이블 뒤 판정으로 넘어간다', !game.negosOf(game.S)[0]);

  /* ── 매물 경쟁 (시한 압박) ───────────────────────────── */
  const rivalOk = win.eval(`(() => {
    const g = window.game, r = [], B = g.BAL;
    const S = g.setS(g.newState('경쟁', 1001));
    S.staff.forEach(e => e.onTeam = true);
    const t = S.market.filter(c => !c.owned && c.cap <= g.capCeiling(S)).sort((a, b) => a.cap - b.cap)[0];
    S.co.cash = t.cap * 4;
    const cap0 = t.cap, diff0 = t.diff;

    g.startNego(S, t);
    g.negosOf(S)[0].rivalDue = S.day + 2;                 // 마감을 강제로 당긴다
    r.push(['마감이 협상에 걸린다', g.negosOf(S)[0].rivalDue > S.day, '']);
    S.day = g.negosOf(S)[0].rivalDue;                     // 마감일 도달
    g.tickNego(S);
    r.push(['마감을 넘기면 매물을 잃는다', !g.negosOf(S).length, '협상 종료']);
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
    g.negosOf(S2)[0].rivalDue = S2.day; g.negosOf(S2)[0].progress = 100; g.negosOf(S2)[0].marks = [];
    g.tickNego(S2);
    r.push(['진행도 100% 면 마감을 넘겨도 안전', !t2.rivalOwned, '']);

    r.push(['협상 1건 ≈ ' + Math.round(100 / B.negoProgressPerDay) + '일',
            Math.round(100 / B.negoProgressPerDay) === 10, '15일 → 10일']);
    return r;
  })()`);
  rivalOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 직원 육성 ───────────────────────────────────────────
     `exp` 는 필드만 있고 읽는 코드가 없었다. 두 경로(일해서 / 교육비로)가
     같은 함수를 타는지, 무료 경로만 상한을 받는지 확인한다. */
  const growOk = win.eval(`(() => {
    const g = window.game, B = g.BAL, r = [];
    const S = g.setS(g.newState('육성', 1001));
    S.co.cash = 1e13;
    const a = S.staff[0], b = S.staff[1];
    a.onTeam = true; b.onTeam = false;

    /* **상태를 손으로 세우지 말 것.** 예전에는 여기서 S.nego 를 직접
       박았는데, 2팀 전환으로 그 필드가 S.negos 로 바뀐 뒤에도 이 케이스만
       계속 통과했다. 실제 게임에서는 협상단 전원이 expNego(4) 대신
       expIdle(1) 을 받고 있었다 — **테스트가 버그를 가린 것이다.**
       실제 진입점(startNego)으로 협상을 만든다. */
    S.co.cash = 1e13;
    g.startNego(S, S.market.find(c => c.cap <= g.capCeiling(S)));
    r.push(['협상이 실제로 걸렸다', g.negosOf(S).length === 1, '']);
    a.slot = g.negosOf(S)[0].slot;
    S.co.subs.push({ id: 'sub1', sector: 'daily', cap: 1e9, pmi: 99 });
    const e0 = a.exp || 0, e1 = b.exp || 0;
    g.tickStaff(S);
    r.push(['협상단은 협상에서 경험치', a.exp - e0 === B.expNego, '+' + (a.exp - e0)]);
    r.push(['관리 인력은 계열사에서 경험치', b.exp - e1 === B.expManage, '+' + (b.exp - e1)]);

    /* 2팀 — **자기 슬롯이 협상 중일 때만** 협상 경험치다.
       빈 팀에 편성만 해 두고 노는 것이 이득이 되면 안 된다. */
    const idle = g.makeStaff(1); S.staff.push(idle);
    idle.onTeam = true; idle.slot = 1 - (g.negosOf(S)[0].slot || 0);
    const i0 = idle.exp || 0;
    g.tickStaff(S);
    r.push(['협상 안 하는 팀은 협상 경험치가 아니다', idle.exp - i0 !== B.expNego, '+' + (idle.exp - i0)]);

    // 편성만 해 두고 협상이 아예 없으면 대기 취급
    g.negosOf(S).slice().forEach(n => g.dropNego(S, n));
    const e2 = a.exp;
    g.tickStaff(S);
    r.push(['협상 없으면 협상단도 대기', a.exp - e2 !== B.expNego, '+' + (a.exp - e2)]);

    // 경험치가 차면 레벨과 월급이 오른다
    const c = g.makeStaff(1); S.staff.push(c); c.lv = 1; c.exp = 0;
    const sal = c.salary;
    g.gainExp(S, c, g.expNeed(c));
    r.push(['경험치가 차면 승급', c.lv === 2 && c.salary > sal, 'Lv.' + c.lv]);

    // 무료 경로는 상한에서 멈춘다
    const d = g.makeStaff(1); S.staff.push(d); d.lv = 1; d.exp = 0;
    g.gainExp(S, d, 1e9);
    r.push(['무료 경로는 상한에서 멈춘다', d.lv === B.expFreeCap, 'Lv.' + d.lv]);
    const stuck = d.exp;
    g.gainExp(S, d, 1e6);
    r.push(['상한에서 경험치가 고인다', d.exp === stuck, '']);

    // 교육비 경로는 상한을 받지 않는다
    g.gainExp(S, d, g.expNeed(d), true);
    r.push(['교육비 경로는 상한 없음', d.lv === B.expFreeCap + 1, 'Lv.' + d.lv]);
    return r;
  })()`);
  growOk.forEach(([n, ok, d]) => check(n, ok, d));

  // 사장실 '사내 복지' 가 약속한 대로 실제 경험치를 주는가
  const careOk = win.eval(`(() => {
    const g = window.game, S = g.setS(g.newState('복지', 2002));
    S.co.cash = 1e13;
    const before = S.staff.map(e => e.exp || 0);
    const care = (g.ITEMS || []).find(a => a.id === 'care');
    if (!care) return [['사내 복지 결재 존재', false, 'ITEMS 에서 못 찾음']];
    care.run(S);
    return [['사내 복지가 경험치를 준다',
             S.staff.every((e, i) => (e.exp || 0) > before[i] || e.lv > 1), '']];
  })()`);
  careOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 상품 라인업 ─────────────────────────────────────────
     인수 토스트가 "OO 상품군 추가" 라고 말해 놓고 실제로는 계열사 개수만
     세고 있었다. 업종이 실제로 매출·진열·대사에 닿는지 확인한다. */
  const lineOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.setS(g.newState('상품군', 1001));
    const add = k => S.co.subs.push({ id: 'x' + S.co.subs.length, name: 'n', sector: k,
                                      cap: 1e9, pmi: 99, tags: [], seen: [] });

    add('food'); add('food'); add('food');
    r.push(['같은 업종은 상품군을 늘리지 않는다', g.productLines(S).length === 1,
            '식품 3개 → ' + g.productLines(S).length + '종']);
    const v1 = g.retailPotential(S);
    add('pharma');
    r.push(['다른 업종은 상품군을 늘린다', g.productLines(S).length === 2, '']);
    r.push(['상품군이 늘면 매출 잠재력이 오른다', g.retailPotential(S) > v1 * 1.02,
            '+' + Math.round((g.retailPotential(S) / v1 - 1) * 100) + '%']);

    // 같은 업종 하나 더 vs 새 업종 하나 — 새 업종이 더 커야 한다
    const A = g.setS(g.newState('a', 1001)), keepA = [];
    for (const k of ['food', 'food']) A.co.subs.push({ id: 'a' + A.co.subs.length, sector: k, cap: 1e9, pmi: 99 });
    A.co.subs.push({ id: 'a9', sector: 'food', cap: 1e9, pmi: 99 });
    const deep = g.retailPotential(A);
    const B = g.setS(g.newState('b', 1001));
    for (const k of ['food', 'food']) B.co.subs.push({ id: 'b' + B.co.subs.length, sector: k, cap: 1e9, pmi: 99 });
    B.co.subs.push({ id: 'b9', sector: 'tech', cap: 1e9, pmi: 99 });
    const wide = g.retailPotential(B);
    r.push(['다각화가 몰빵보다 매출에 낫다', wide > deep,
            '넓히기 ' + Math.round(wide / deep * 100) + '% 대비']);

    // 진열 색과 손님 대사가 상품군을 탄다
    g.setS(S); g.setMode('store');
    const pal = g.palette();
    r.push(['진열 색이 상품군에서 나온다',
            pal.includes(g.SECTORS.pharma.color) && pal.filter(c => c === g.SECTORS.food.color).length === 1,
            '식품 3개여도 색은 하나']);
    return r;
  })()`);
  lineOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 매대 배정 ───────────────────────────────────────────
     자리는 고정이고 무엇을 놓을지만 고른다. 제약은 하나 — 같은 상품군은
     한 매대에만. 그게 없으면 마진 최고 업종을 전 구역에 깔면 그만이다. */
  const zoneOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.setS(g.newState('매대', 1001));
    const add = k => S.co.subs.push({ id: 'z' + S.co.subs.length, sector: k, cap: 1e9, pmi: 99 });
    add('it'); add('build');           // 마진 0.58 / 0.16

    r.push(['배정 전에는 배수가 1', Math.abs(g.zoneBonus(S) - 1) < 1e-9, '']);

    g.assignZone(S, 'front', 'it');    // 통행 1.00 에 고마진
    const good = g.zoneBonus(S);
    g.assignZone(S, 'front', null);
    g.assignZone(S, 'cold', 'it');     // 통행 0.45 에 같은 상품
    const bad = g.zoneBonus(S);
    r.push(['목 좋은 자리가 더 값어치 있다', good > bad, good.toFixed(3) + ' > ' + bad.toFixed(3)]);

    // 같은 상품군은 한 매대에만
    g.assignZone(S, 'front', 'it');
    r.push(['중복 배정은 앞의 것을 내린다',
            g.shopZones(S).front === 'it' && !g.shopZones(S).cold, '']);

    // 보유하지 않은 상품군은 효과가 없다
    g.assignZone(S, 'aisle', 'pharma');
    r.push(['없는 상품군은 매출에 안 붙는다',
            Math.abs(g.zoneBonus(S) - good) < 1e-9, '제약 계열사 없음']);

    // 매출에 실제로 곱해지는가
    const v0 = g.retailPotential(S);
    g.assignZone(S, 'aisle', 'build');
    r.push(['배정이 매출 잠재력에 곱해진다', g.retailPotential(S) > v0, '']);
    return r;
  })()`);
  zoneOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 직원 배치 3분할 ─────────────────────────────────────
     협상단 / 매장 근무 / 계열사 관리. 한 사람은 한 곳에만 선다. */
  const roleOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.setS(g.newState('배치', 1001));
    S.co.subs.push({ id: 'r1', sector: 'daily', cap: 1e9, pmi: 99 });
    S.staff.forEach(e => { e.onTeam = false; e.atShop = false; });

    const mgr0 = g.managersHave(S), ret0 = g.retailPotential(S);
    r.push(['기본값은 예전과 같다', Math.abs(g.retailPotential(S) / ret0 - 1) < 1e-9, '매장 0명 → 배수 1']);

    S.staff[0].atShop = true;
    r.push(['매장에 세우면 매출이 오른다', g.retailPotential(S) > ret0,
            '+' + Math.round((g.retailPotential(S) / ret0 - 1) * 100) + '%']);
    r.push(['그만큼 관리 인력이 준다', g.managersHave(S) === mgr0 - 1, '']);

    // 협상단과 매장은 겸할 수 없다
    S.staff[0].onTeam = true;
    r.push(['협상단은 매장 인원에서 빠진다', g.shopOf(S).length === 0, '']);
    r.push(['협상단도 관리 인력이 아니다', g.mgrOf(S).length === S.staff.length - 1, '']);

    // 매장 근무도 경험치가 오른다
    S.staff[0].onTeam = false;
    const e1 = S.staff[0].exp || 0;
    g.tickStaff(S);
    r.push(['매장 근무도 경험치를 받는다', S.staff[0].exp - e1 === g.BAL.expManage,
            '+' + (S.staff[0].exp - e1)]);
    return r;
  })()`);
  roleOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 경제 위기 ────────────────────────────────────────────
     후반 전용. 반드시 예고가 먼저 가고, 매물이 싸지므로 기회이기도 하다. */
  const crisisOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.setS(g.newState('위기', 5005));
    S.co.cash = 1e9;
    g.tickCrisis(S);
    r.push(['자본이 작으면 위기가 안 걸린다', !g.crisisOf(S).due && !g.inCrisis(S), '']);

    S.co.cash = g.BAL.crisisFrom * 2;
    let guard = 0;
    while (!g.crisisOf(S).due && guard++ < 3000) { S.day++; g.tickCrisis(S); }
    const c = g.crisisOf(S);
    r.push(['자격을 갖추면 예약된다', !!c.due && !!c.name, c.name + ' D-' + (c.due - S.day)]);
    r.push(['예약만으로는 아직 효과가 없다', g.crisisMul(S, 'daily') === 1 && g.crisisPriceMul(S) === 1, '']);

    // 대비 안내가 발동 전에 반드시 한 번 나간다
    const inbox0 = S.inbox.length;
    while (S.day < c.due - 1) { S.day++; g.tickCrisis(S); }
    r.push(['발동 전에 경보가 먼저 온다', S.inbox.length > inbox0 && !!c.warned, '']);

    // 발동 — 계열사 하나를 쥐여 주고 집중 업종이 잡히는지 본다
    ['daily','daily','food'].forEach((k, i) =>
      S.co.subs.push({ id:'z'+i, name:'즈'+i, sector:k, cap:1e10, tags:[], seen:[], day:0 }));
    S.day = c.due; g.tickCrisis(S);
    r.push(['발동하면 진행 중이 된다', g.inCrisis(S), c.name]);
    r.push(['가장 많은 업종이 더 크게 맞는다',
            g.crisisMul(S, 'daily') < g.crisisMul(S, 'food'),
            'daily ' + g.crisisMul(S, 'daily') + ' vs food ' + g.crisisMul(S, 'food')]);
    r.push(['위기 중에는 매물이 싸다', g.crisisPriceMul(S) < 1, '×' + g.crisisPriceMul(S)]);

    /* 긴축 선택지. 예전에는 c.eased 를 세우기만 하고 **읽는 곳이 없어**
       인지도만 깎이는 순손실 버튼이었다. 모달을 실제로 눌러 확인한다. */
    const mul0 = g.crisisMul(S, 'daily'), mkt0 = S.co.marketing;
    const opts = [...document.querySelectorAll('#modal .choice:not([disabled])')];
    opts[1].click();
    r.push(['긴축이 실제로 손실을 줄인다', g.crisisMul(S, 'daily') > mul0,
            mul0.toFixed(2) + ' → ' + g.crisisMul(S, 'daily').toFixed(2)]);
    r.push(['긴축은 인지도를 대가로 받는다', S.co.marketing < mkt0,
            mkt0 + ' → ' + S.co.marketing]);

    S.day = c.until; g.tickCrisis(S);
    r.push(['기간이 지나면 회복한다', !g.inCrisis(S) && g.crisisMul(S, 'daily') === 1, '']);
    r.push(['위기가 끝나면 긴축도 함께 지워진다', !c.eased, '']);
    return r;
  })()`);
  crisisOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 협상단 2팀 ───────────────────────────────────────────
     중견기업(등급 4)부터 열린다. 초반에 열면 조작이 두 배가 되므로 후반 전용이다. */
  const slotOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.setS(g.newState('2팀', 4004));
    S.staff.forEach(e => { e.onTeam = true; e.slot = 0; });
    S.co.cash = 1e13;
    S.co.tier = 3;
    r.push(['중견기업 전에는 1팀', g.negoSlots(S) === 1, g.negoSlots(S) + '팀']);
    const picks = S.market.filter(c => !c.owned && c.cap <= g.capCeiling(S)).sort((a, b) => a.cap - b.cap);
    g.startNego(S, picks[0]);
    g.startNego(S, picks[1]);
    r.push(['1팀일 때 두 번째 파견은 막힌다', g.negosOf(S).length === 1, g.negosOf(S).length + '건']);

    S.co.tier = 4;
    r.push(['중견기업부터 2팀', g.negoSlots(S) === 2, g.negoSlots(S) + '팀']);
    // 2팀에 사람이 없으면 파견되지 않는다
    g.startNego(S, picks[1]);
    r.push(['빈 팀으로는 파견 불가', g.negosOf(S).length === 1, '']);

    const spare = S.staff.find(e => !e.onTeam) || (S.staff.push(g.makeStaff(2)), S.staff[S.staff.length - 1]);
    spare.onTeam = true; spare.slot = 1;
    g.startNego(S, picks[1]);
    r.push(['2팀이 동시에 협상한다', g.negosOf(S).length === 2,
            g.negosOf(S).map(n => (n.slot + 1) + '팀').join(' · ')]);
    r.push(['슬롯이 서로 다르다', g.negosOf(S)[0].slot !== g.negosOf(S)[1].slot, '']);
    r.push(['같은 매물에 두 번 못 건다',
            (g.startNego(S, picks[0]), g.negosOf(S).length === 2), '']);

    // 한 건만 끝나도 다른 건은 남는다
    const first = g.negosOf(S)[0];
    g.negoAct(S, 'quit', first);
    r.push(['한 건을 중단해도 나머지는 진행', g.negosOf(S).length === 1
            && g.negosOf(S)[0].id !== first.id, '']);
    r.push(['빈 슬롯이 다시 열린다', g.freeSlot(S) === first.slot, '슬롯 ' + g.freeSlot(S)]);
    return r;
  })()`);
  slotOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 순자산 · 순위 (구조 수정) ────────────────────────────
     예전에는 netWorth = 현금 − 부채라 계열사를 아무리 사도 순자산이 늘지
     않았다. 승급 조건 4개가 순자산을 보고 있었으므로 인수가 승급을 역행시켰다. */
  const worthOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.setS(g.newState('순자산', 7007));
    S.co.cash = 1e11;
    const nw0 = g.netWorth(S), rank0 = (g.recalcCap(S), S.co.rank);
    r.push(['계열사 없으면 순자산 = 보유 자금', nw0 === S.co.cash, g.won(nw0)]);

    // 인수를 흉내낸다 — 현금이 나가고 같은 값의 계열사가 들어온다
    const price = 3e10;
    S.co.cash -= price;
    S.co.subs.push({ id:'x1', name:'테스트', sector:'daily', cap: price, tags:[], seen:[], paid: price });
    const nw1 = g.netWorth(S);
    r.push(['인수해도 순자산이 줄지 않는다', Math.abs(nw1 - nw0) < 1,
            g.won(nw0) + ' → ' + g.won(nw1)]);
    r.push(['순자산 = 자금 + 계열사 − 부채',
            nw1 === S.co.cash + g.subsValue(S) - g.debtTotal(S), '']);

    // 계열사가 커지면 순위가 오른다 — 순위 입력이 순자산이다
    S.co.subs[0].cap *= 40;
    g.recalcCap(S);
    r.push(['순위는 순자산을 본다', S.co.rank < rank0, rank0 + '위 → ' + S.co.rank + '위']);
    r.push(['시가총액 ≥ 순자산 (본업이 얹힌다)', S.co.cap >= g.netWorth(S), '']);

    // 승급 조건이 쓰는 사업부 캐시가 매일 갱신되는가
    const S2 = g.setS(g.newState('사업부', 7008));
    ['daily','daily','daily'].forEach((k, i) =>
      S2.co.subs.push({ id:'d'+i, name:'디'+i, sector:k, cap:1e9, tags:[], seen:[], pmi:1 }));
    g.tickEconomy(S2);
    r.push(['사업부 수가 상태에 갱신된다', S2.co.divs === g.divisionsOf(S2).length,
            S2.co.divs + '개']);
    return r;
  })()`);
  worthOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 사업부 캐시 · 인수 완료 경로 ─────────────────────────
     `co.divs`(숫자, economy 소유)와 사업부 키 목록(배열, mna 소유)이 한 필드를
     공유하던 시절, 사업부가 하나라도 있으면 **인수 완료가 예외로 죽고 시계가
     멈춘 채 돌아오지 않았다.** 위 두 케이스는 각각 따로만 봐서 이 조합을
     놓쳤다 — 여기서는 모달을 실제로 눌러 결제 경로 전체를 지난다. */
  const divOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.setS(g.newState('사업부회귀', 9009));
    S.co.cash = 1e12; S.speed = 2;
    ['daily','daily','daily'].forEach((k, i) =>
      S.co.subs.push({ id:'q'+i, name:'큐'+i, sector:k, cap:1e9, tags:[], seen:[], day:1 }));
    g.tickEconomy(S);
    r.push(['divs 는 숫자로만 쓰인다', typeof S.co.divs === 'number', String(S.co.divs)]);
    r.push(['사업부 키는 별도 필드(divKeys)', Array.isArray(S.co.divKeys), '']);

    const tgt = S.market.find(c => !c.owned && c.cap < 1e9);
    g.negosOf(S).push({ slot:0, id:tgt.id, name:tgt.name, diff:0, progress:100,
      success:100, prem:0.1, tagMul:1, team:[], marks:[], acts:3, done:[], direct:false });
    g.judgeNego(S, g.negosOf(S)[0]);
    const speedPaused = S.speed;
    document.querySelector('#modal .choice:not([disabled])').click();
    r.push(['사업부가 있어도 인수 완료가 안 터진다', S.co.subs.some(c => c.id === tgt.id), tgt.name]);
    r.push(['인수 결제 뒤 배속이 복원된다', speedPaused === 0 && S.speed === 2, '0 → ' + S.speed]);

    // 두 번째 사업부 출범 연출도 살아 있는가 (예전엔 여기서 죽었다)
    ['food','food','food'].forEach((k, i) =>
      S.co.subs.push({ id:'f'+i, name:'푸'+i, sector:k, cap:1e9, tags:[], seen:[], day:1 }));
    g.tickEconomy(S);
    const inbox0 = S.inbox.length;
    g.checkDivisions(S);
    r.push(['두 번째 사업부도 출범 알림이 나간다', S.inbox.length > inbox0,
            g.divisionsOf(S).join(', ')]);
    r.push(['같은 사업부를 두 번 출범시키지 않는다',
            (() => { const n = S.inbox.length; g.checkDivisions(S); return S.inbox.length === n; })(), '']);
    return r;
  })()`);
  divOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* ── 모달 — 닫기로 시계를 죽일 수 없다 ─────────────────────
     `pause()` 뒤 열린 모달을 ✕/Esc 로 닫으면 `resume()` 이 선택지 핸들러
     안에만 있어서 시계가 0 에 멈춘 채 안 돌아왔다. 배속 버튼으로 억지로 풀면
     `pausedSpeed` 가 오염돼 그 뒤로는 모달이 떠도 게임이 안 멈춘다 —
     §13-1 이 예외로 겪은 증상을 **Esc 한 번으로** 재현할 수 있었다. */
  const dismissOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.setS(g.newState('닫기', 1001));
    while (g.modalStack.length) g.closeModal();   // 앞 케이스가 남긴 모달 정리
    g.clearPause();
    S.speed = 2;

    // 1) 안전망 — 닫을 수 있는 모달을 닫으면 배속이 복원된다
    g.pause();
    g.openModal({ title: '테스트', body: '', actions: [{ label: '확인' }] });
    const paused = S.speed;
    g.dismissModal(g.modalStack[g.modalStack.length - 1]);
    r.push(['닫아도 배속이 복원된다', paused === 0 && S.speed === 2, paused + ' → ' + S.speed]);

    // 2) 결정 모달은 애초에 닫히지 않는다
    S.staff.forEach(e => e.onTeam = true);
    S.co.cash = 1e13;
    const t = S.market.find(c => c.cap <= g.capCeiling(S));
    g.startNego(S, t);
    for (let i = 0; i < 30 && g.negosOf(S).length; i++) {
      g.tickDay();
      const c = document.querySelector('#modal .choice:not([disabled])');
      if (c && !/지불|대출|포기/.test(c.textContent)) c.click();
    }
    const head = document.querySelector('#modal .modal-head span')?.textContent || '';
    r.push(['인수가 확정 모달이 떴다', head.includes('인수가 확정'), head]);
    r.push(['결정 모달에는 닫기 버튼이 없다', !document.getElementById('mx'), '']);
    const top = g.modalStack[g.modalStack.length - 1];
    r.push(['결정 모달은 dismissable:false', !!top && top.dismissable === false, '']);
    while (g.modalStack.length) g.closeModal();
    return r;
  })()`);
  dismissOk.forEach(([n, ok, d]) => check(n, ok, d));

  /* 모달 핸들러가 던져도 시계는 살아 있어야 한다 — 단일 실패점 방어 */
  const guardOk = win.eval(`(() => {
    const g = window.game, r = [];
    const S = g.S; S.speed = 2;
    g.pause();
    g.openModal({ title:'예외 테스트', actions:[{ label:'확인', run: () => { throw new Error('의도된 예외'); } }] });
    document.querySelector('#modal [data-a]').click();
    r.push(['핸들러가 던져도 배속이 복원된다', S.speed === 2, 'speed ' + S.speed]);
    return r;
  })()`);
  guardOk.forEach(([n, ok, d]) => check(n, ok, d));
  // 위 케이스가 던진 것은 의도된 예외다. '런타임 에러 없음' 집계에서 뺀다
  for (let i = errors.length - 1; i >= 0; i--) if (errors[i].includes('의도된 예외')) errors.splice(i, 1);

  check('출력 무결성', !/NaN|undefined|Infinity/.test(all),
        (all.match(/.{0,30}(NaN|undefined|Infinity)/) || [''])[0]);
} catch (e) {
  fail.push('✗ 예외: ' + e.message + '\n    ' + (e.stack.split('\n')[1] || '').trim());
}

check('런타임 에러 없음', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));

console.log([...pass, ...fail].join('\n'));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
