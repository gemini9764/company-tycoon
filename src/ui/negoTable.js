import { BAL } from '../core/balance.js';
import { esc, pct, won } from '../core/util.js';
import { applyTable, judgeNego } from '../systems/mna.js';
import { APPROACH, DEMANDS, approachOf, delegateTable, tableRound } from '../systems/negoTable.js';
import { openModal } from './modal.js';

/* ══════════════════════════════════════════════════════════════
   협상 테이블 UI

   **새 창을 만들지 않는다.** 라운드마다 모달을 다시 띄우는 것으로 끝낸다 —
   모달은 이미 게임을 멈추므로 일시정지 처리도 공짜다. 캔버스도, 새 DOM 도
   필요 없다.

   판정은 전부 `systems/negoTable.js` 에 있다. 여기서는 부르고 그릴 뿐이다.
   ══════════════════════════════════════════════════════════════ */

/** 게이지 한 줄. 숫자를 두 개만 노출한다 (기획서 §2 원칙 3) */
function gauge(label, val, max, cls) {
  const n = Math.max(0, Math.min(10, Math.round(val / max * 10)));
  return `<div class="kv"><span>${label}</span><b class="${cls}">${'▓'.repeat(n)}${'░'.repeat(10 - n)}</b></div>`;
}

/**
 * 테이블을 연다. mna.js:finishNego 가 클로징에서 부른다.
 * 라운드가 끝나면 applyTable → judgeNego 로 돌려준다.
 */
function openTable(s, n, tgt, team, demands, i = 0, acc = { dS: 0, dP: 0, log: [] }) {
  /* mna → ui/negoTable → mna 순환이지만 번들러가 한 스코프로 합치고
     함수 선언이 호이스팅되므로 런타임 문제가 없다 (economy ↔ bank 와 같은 형태).
     동적 import 는 번들에서 돌지 않으므로 쓰지 않는다. */
  if (i >= demands.length) { n.tableView = null; applyTable(n, acc); return judgeNego(s); }

  const dem = demands[i];
  /* 지금 라운드의 요구와 팀 순서를 상태에 노출한다. sim 봇과 스모크가
     선택지 라벨을 파싱하지 않고 최선 수를 계산할 수 있어야 한다. */
  n.tableView = { demand: dem, round: i, total: demands.length, team: team.map(e => e.id) };
  const nowS = Math.max(0, Math.min(100, n.success + acc.dS));
  const nowP = Math.max(0.02, n.prem + acc.dP);

  openModal({
    title: `${tgt.name} — 협상 테이블 ${i + 1}/${demands.length}`,
    body: `
      <p>상대 대표단이 말한다.<br><b class="c-blood">"${DEMANDS[dem].n}"</b></p>
      <div style="margin-top:10px">
        ${gauge('성공도', nowS, 100, nowS >= 60 ? 'c-jade' : 'c-blood')}
        ${gauge('인수가', nowP, 0.6, 'c-gold')}
      </div>
      <div class="kv"><span>현재 성공도</span><b>${pct(nowS)}</b></div>
      <div class="kv"><span>예상 인수가</span><b class="c-gold">${won(Math.round(tgt.cap * (1 + nowP) * (n.tagMul ?? 1)))}</b></div>
      <p style="margin-top:8px;font-size:12px" class="c-dim">누구를 내보낼지 고르세요. 상대의 요구에 맞는 접근이면 성공도가 크게 오르고 인수가도 내려갑니다. 빗나가면 값을 양보하게 됩니다.</p>`,
    choices: [
      ...team.map((e, idx) => {
        const ap = APPROACH[approachOf(e)];
        const r = tableRound(e, dem);
        return {
          label: `${esc(e.name)} — ${ap.n}`,
          sub: `협상 ${e.nego} · 정보 ${e.intel}${e.trait?.id !== 'none' ? ' · ' + e.trait.name : ''}`,
          run: () => {
            acc.dS += r.dS; acc.dP += r.dP;
            acc.log.push({ round: i + 1, demand: dem, emp: e.name, ...r });
            openTable(s, n, tgt, team, demands, i + 1, acc);
          },
        };
      }),
      { label: '나머지는 협상단에 맡긴다', sub: '남은 라운드를 자동으로 처리합니다',
        run: () => {
          const rest = delegateTable(team, demands.slice(i));
          acc.dS += rest.dS; acc.dP += rest.dP; acc.log.push(...rest.log);
          n.tableView = null; applyTable(n, acc); judgeNego(s);
        } },
    ],
  });
}

export { openTable };
