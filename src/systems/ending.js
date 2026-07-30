import { clearPause } from '../core/clock.js';
import { BAL } from '../core/balance.js';
import { TIERS } from '../core/data.js';
import { SAVE_KEY, Store } from '../core/storage.js';
import { $, won } from '../core/util.js';
import { openModal } from '../ui/modal.js';

/* ── 엔딩 ────────────────────────────────────────────────── */
function checkEnding(s) {
  if (s.flags.ending) return;
  if (s.co.probe >= BAL.probeDeath) return endGame(s, 'probe');
  if (s.co.mistrust >= BAL.mistrustDeath) return endGame(s, 'occult');
  if (s.co.tier === TIERS.length - 1 && s.co.rank <= 1) return endGame(s, 'global');
}

const ENDINGS = {
  global: { t:'업계 1위 글로벌 그룹', c:'c-gold', d:'시가총액 1위. 구멍가게에서 시작한 그룹이 업계를 재편했습니다. 정상 엔딩입니다.' },
  bankrupt:{ t:'파산', c:'c-blood', d:'연체가 누적되어 자산이 압류됐습니다. 무리한 확장이 그룹을 무너뜨렸습니다.' },
  probe:  { t:'그룹 해체', c:'c-blood', d:'검찰이 정경유착 수사에 착수했고 그룹은 해체 수순을 밟습니다. 로비에 기댄 대가입니다.' },
  occult: { t:'무속 스캔들', c:'c-mauve', d:'미신 경영이 전면 폭로됐습니다. 시장의 신뢰를 잃은 그룹은 사라졌습니다.' },
};

function endGame(s, key) {
  s.flags.ending = key; s.speed = 0; clearPause();
  const e = ENDINGS[key];
  openModal({
    title: '게임 종료', dismissable: false,
    body: `<div style="text-align:center;padding:10px 0">
      <div style="font-size:22px" class="${e.c}">${e.t}</div>
      <p style="margin:14px 0;font-size:11px;line-height:1.9">${e.d}</p>
      <div style="border-top:2px solid var(--paper-3);padding-top:10px;text-align:left">
        <div class="kv"><span>경과</span><b>${s.day}일</b></div>
        <div class="kv"><span>최종 등급</span><b>${TIERS[s.co.tier].name}</b></div>
        <div class="kv"><span>시가총액</span><b>${won(s.co.cap)} · ${s.co.rank}위</b></div>
        <div class="kv"><span>계열사</span><b>${s.co.subs.length}개</b></div>
        <div class="kv"><span>미신지수 / 수사</span><b>${Math.round(s.co.mistrust)} / ${Math.round(s.co.probe)}</b></div>
      </div></div>`,
    actions: [{ label: '새 게임', cls: 'gold', run: () => { Store.del(SAVE_KEY); location.reload(); } }],
  });
}

export { ENDINGS, checkEnding, endGame };
