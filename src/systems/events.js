import { BAL } from '../core/balance.js';
import { pause, resume } from '../core/clock.js';
import { SECTORS, SECTOR_KEYS, SHAMAN_TIERS } from '../core/data.js';
import { makeShaman } from '../core/state.js';
import { $, chance, clamp, pick, rint, won } from '../core/util.js';
import { creditIdx } from './company.js';
import { dailyRetail } from './economy.js';
import { checkEnding } from './ending.js';
import { openModal } from '../ui/modal.js';
import { news, toast } from '../ui/toast.js';

/* ── 이벤트 ──────────────────────────────────────────────── */
/* 벌금·정치자금은 시총에 비례하되 보유 자금을 넘겨 즉사시키지 않도록 상한을 둔다 */
const bill = (s, capRatio, cashRatio) => Math.round(Math.min(s.co.cap * capRatio, Math.max(1e6, s.co.cash * cashRatio)));

function tickEvent(s) {
  if (s.day - s.lastEventDay < 12) return;
  if (!chance(BAL.eventChancePerDay)) return;
  s.lastEventDay = s.day;
  const pool = [];
  pool.push(...EV_CORP);
  if (s.co.tier >= 3) pool.push(...EV_TAX);
  if (s.co.tier >= 4) pool.push(...EV_NATION);
  if (s.shaman.unlocked) pool.push(EV_SHAMAN[0]);
  if (s.co.mistrust >= 10) pool.push(EV_SHAMAN[1]);
  const ev = pick(pool);
  pause();
  const built = ev(s);
  openModal({
    title: built.title, body: built.body,
    choices: built.choices.map(c => ({ ...c, run: () => { c.run(); resume(); checkEnding(s); } })),
  });
  news(built.news || built.title);
}

const EV_CORP = [
  s => ({ title:'경쟁사 이벤트 — 출혈 경쟁', news:'유통업계 가격 경쟁 격화',
    body:'경쟁 그룹이 동일 상품군에 대규모 할인을 걸었습니다.',
    choices:[
      { label:'맞불 할인', sub:'인지도 +0.35 · 이번 달 매출 마진 감소',
        run:()=>{ s.co.marketing=Math.min(BAL.marketingCap,s.co.marketing+0.35); s.co.cash-=dailyRetail(s)*6; } },
      { label:'프리미엄 노선 유지', sub:'인지도 -0.2 · 자금 소모 없음',
        run:()=>{ s.co.marketing=Math.max(1,s.co.marketing-0.2); } },
    ] }),
  s => ({ title:'경쟁사 이벤트 — 인재 유출', news:'그룹 간 인력 쟁탈전',
    body:'경쟁사가 우리 직원에게 스카웃 제안을 넣었습니다.',
    choices:[
      { label:'연봉 인상으로 방어', sub:'해당 직원 급여 +25%',
        run:()=>{ const e=pick(s.staff); if(e){e.salary=Math.round(e.salary*1.25); toast(`${e.name} 잔류`,'good');} } },
      { label:'보낸다', sub:'직원 1명 이탈 · 급여 부담 감소',
        run:()=>{ const i=rint(0,s.staff.length-1); const e=s.staff[i]; if(e){ s.staff.splice(i,1); if(s.nego) s.nego.team=s.nego.team.filter(x=>x!==e.id); toast(`${e.name} 이직`,'bad'); } } },
    ] }),
];

const EV_TAX = [
  s => ({ title:'국세청 이벤트 — 정기 세무조사', news:'국세청, 그룹 정기 세무조사 착수',
    body:'국세청이 그룹 전반에 대한 세무조사에 착수했습니다.',
    choices:[
      { label:'성실 자료 제출', sub:`추징금 ${won(bill(s,0.02,0.35))} · 신용 등급 +`,
        run:()=>{ s.co.cash-=bill(s,0.02,0.35); s.co.donate+=3; } },
      { label:'로비로 무마 시도', sub:`정치자금 ${won(bill(s,0.012,0.25))} · 성공률 ${Math.round(clamp(45+creditIdx(s)*4,20,85))}% · 발각 시 수사 게이지 급증`,
        run:()=>{ s.co.cash-=bill(s,0.012,0.25);
          if(chance(clamp(45+creditIdx(s)*4,20,85)/100)){ s.co.probe+=6; toast('조사 무마 성공','good'); }
          else { s.co.probe+=28; s.co.donate-=8; news('정경유착 의혹 제기'); toast('로비 발각 — 정경유착 스캔들','bad'); } } },
      { label:'무대응', sub:`벌금 ${won(bill(s,0.045,0.6))} · 신용 등급 대폭 하락`,
        run:()=>{ s.co.cash-=bill(s,0.045,0.6); s.co.donate-=6; s.co.probe+=10; } },
    ] }),
];

const EV_NATION = [
  s => { const up = chance(0.5); return { title:`국가 이벤트 — 기준금리 ${up?'인상':'인하'}`, news:`중앙은행, 기준금리 ${up?'인상':'인하'} 결정`,
    body:`중앙은행이 기준금리를 ${up?'0.75%p 인상':'0.5%p 인하'}했습니다. 기존 대출 이자에도 즉시 반영됩니다.`,
    choices:[{ label:'확인', sub:up?'대출 이자 부담 증가':'대출 이자 부담 완화',
      run:()=>{ s.bank.rateDelta_=(s.bank.rateDelta_||0)+(up?0.75:-0.5); s.bank.loans.forEach(l=>l.rate+=up?0.75:-0.5); } }] }; },
  s => ({ title:'국가 이벤트 — 산업 육성 정책', news:'정부, 신산업 육성책 발표',
    body:'정부가 특정 업종에 대한 규제를 완화했습니다.',
    choices:[
      { label:'수혜 업종 확인', sub:'해당 업종 기업 인수 난이도 1단계 하락',
        run:()=>{ const sec=pick(SECTOR_KEYS);
          s.market.forEach(c=>{ if(c.sector===sec && !c.owned && c.diff > Math.max(0, (c.diff0 ?? c.diff) - 1)) c.diff--; });
          toast(`${SECTORS[sec].name} 업종 규제 완화 — 인수 난이도 하락`,'good'); } },
    ] }),
];

const EV_SHAMAN = [
  s => ({ title:'무속 이벤트 — 용한 무당이 나타났다', news:'재계에 도는 그 무당 이야기',
    body:'업계에 소문난 무당이 접촉해 왔습니다.',
    choices:[
      { label:'명함을 받아둔다', sub:'무당 목록에 신규 무당 추가',
        run:()=>{ const t=chance(0.25)?2:chance(0.5)?1:0; s.shaman.pool.push(makeShaman(t)); toast(`${SHAMAN_TIERS[t].name} 영입 가능`,'good'); } },
      { label:'거절한다', sub:'미신지수 -6', run:()=>{ s.co.mistrust=Math.max(0,s.co.mistrust-6); } },
    ] }),
  s => ({ title:'무속 이벤트 — 굿판 사고', news:'모 그룹 굿판 사고 소문',
    body:'그룹이 후원한 굿판에서 사고가 났다는 이야기가 돕니다.',
    choices:[
      { label:'입막음한다', sub:`${won(bill(s,0.012,0.3))} 지출 · 수사 게이지 +10`,
        run:()=>{ s.co.cash-=bill(s,0.012,0.3); s.co.probe+=6; } },
      { label:'방치한다', sub:'미신지수 +12 · 신용 등급 하락',
        run:()=>{ s.co.mistrust=clamp(s.co.mistrust+12,0,100); s.co.donate-=4; } },
    ] }),
];

export { EV_CORP, EV_NATION, EV_SHAMAN, EV_TAX, bill, tickEvent };
