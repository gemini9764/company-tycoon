/**
 * UI 스모크 테스트 — 주요 상호작용 경로를 실제로 클릭해 본다.
 *   node tools/smoke.mjs
 */
import { boot, startGame, resolveModals } from './harness.mjs';

const pass = [], fail = [];
const check = (name, ok, detail = '') =>
  (ok ? pass : fail).push(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);

const { win, doc, game, errors } = await boot();
const text = id => doc.getElementById(id).textContent.replace(/\s+/g, ' ').trim();

try {
  check('인트로 모달', !!doc.getElementById('co-name'));
  startGame(doc);
  check('창업 후 HUD 렌더', text('hud').includes('테스트상사'));

  win.eval('for (let i = 0; i < 300; i++) game.tickDay();');
  check('300일 진행', game.S.day >= 300, `${game.S.day}일차 · 자금 ${game.won(game.S.co.cash)}`);

  for (const t of ['staff', 'stock', 'bank', 'rumor', 'inbox']) {
    const b = doc.querySelector(`[data-t="${t}"]`);
    if (b.disabled) { check(`탭 ${t}`, true, '잠김(정상)'); continue; }
    b.click();
    const html = doc.getElementById('right-body').innerHTML;
    check(`탭 ${t}`, html.length > 50 && !/undefined|NaN/.test(html), `${html.length}b`);
  }
  win.eval('game.S.shaman.unlocked = true; game.renderRight();');
  doc.querySelector('[data-t="shaman"]').click();
  check('탭 shaman', doc.getElementById('right-body').innerHTML.length > 50);

  doc.querySelector('[data-t="staff"]').click();
  doc.querySelector('[data-team]').click();
  check('협상단 편성', game.teamOf(game.S).length > 0);

  win.eval('game.S.co.cash = 1e9;');
  doc.querySelector('[data-t="staff"]').click();
  const before = game.S.staff.length;
  doc.querySelector('[data-hire]').click();
  check('직원 영입', game.S.staff.length === before + 1);

  doc.querySelector('[data-t="bank"]').click();
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
  doc.querySelector('[data-t="stock"]').click();
  const buy = doc.querySelector('[data-buy]:not([disabled])');
  if (buy) buy.click();
  check('주식 매수', Object.keys(game.S.stock.holds).length > 0);
  doc.querySelector('[data-t="stock"]').click();
  const sell = doc.querySelector('[data-sell]');
  if (sell) sell.click();
  check('주식 매도', true);

  win.eval(`game.S.shaman.hired = game.S.shaman.pool[0]; game.S.co.cash = 1e11;
            game.doGut(game.S, 'sal', game.S.market.find(c => !c.owned).id);`);
  check('살굿 실행', game.S.co.mistrust > 0, `미신지수 ${Math.round(game.S.co.mistrust)}`);

  win.eval('game.saveGame(true)');
  check('저장', ['artifact', 'local', 'memory'].includes(game.Store.mode), game.Store.mode);

  const all = ['hud', 'left-body', 'right-body'].map(text).join(' ');
  check('출력 무결성', !/NaN|undefined|Infinity/.test(all),
        (all.match(/.{0,30}(NaN|undefined|Infinity)/) || [''])[0]);
} catch (e) {
  fail.push('✗ 예외: ' + e.message + '\n    ' + (e.stack.split('\n')[1] || '').trim());
}

check('런타임 에러 없음', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));

console.log([...pass, ...fail].join('\n'));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
