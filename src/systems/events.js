import { BAL } from '../core/balance.js';
import { pause, resume } from '../core/clock.js';
import { SECTORS, SECTOR_KEYS, SHAMAN_TIERS } from '../core/data.js';
import { makeShaman } from '../core/state.js';
import { $, chance, clamp, pick, rint, won } from '../core/util.js';
import { creditIdx } from './company.js';
import { dailyRetail, retailPotential } from './economy.js';
import { checkEnding } from './ending.js';
import { openModal } from '../ui/modal.js';
import { news, toast } from '../ui/toast.js';

/* ── 이벤트 ──────────────────────────────────────────────── */
/* 벌금·정치자금은 시총에 비례하되 보유 자금을 넘겨 즉사시키지 않도록 상한을 둔다.
   eventCostScale 은 이벤트 빈도와 맞물린 계수다 — 빈도를 바꾸면 여기도 같이 봐야
   시간당 지출이 유지된다. */
const bill = (s, capRatio, cashRatio) => Math.round(
  BAL.eventCostScale * Math.min(s.co.cap * capRatio, Math.max(1e6, s.co.cash * cashRatio)));

function tickEvent(s) {
  if (s.day - s.lastEventDay < BAL.eventCooldown) return;
  if (!chance(BAL.eventChancePerDay)) return;
  s.lastEventDay = s.day;
  const pool = [];
  pool.push(...EV_CORP, ...EV_MARKET, ...EV_SHOP);
  if (s.co.tier >= 3) pool.push(...EV_TAX);
  if (s.co.tier >= 4) pool.push(...EV_NATION);
  if (s.shaman.unlocked) pool.push(EV_SHAMAN[0], EV_SHAMAN[2]);
  if (s.co.mistrust >= 10) pool.push(EV_SHAMAN[1]);
  /* 같은 이벤트가 연달아 뜨면 빈도를 올린 의미가 없다. 직전 것만 한 번 피한다. */
  let ev = pick(pool);
  if (pool.length > 1 && ev === s.lastEvent_) ev = pick(pool.filter(e => e !== ev));
  s.lastEvent_ = ev;
  pause();
  const built = ev(s);
  openModal({
    title: built.title, body: built.body,
    choices: built.choices.map(c => ({ ...c, run: () => { c.run(); resume(); checkEnding(s); } })),
  });
  news(built.news || built.title);
}

/* ── 매장 이벤트 ─────────────────────────────────────────────
   사옥에 들를 이유를 만드는 축. 도시에 있을 때 터지면 '보고만 받는' 선택지가
   되어 결과가 나빠진다 — 자리를 지킨 보상이 있어야 모드를 오가는 의미가 생긴다.
   비용은 시총이 아니라 **매장 규모(잠재 매출)** 에 비례한다. 매장 사건이므로.
   ─────────────────────────────────────────────────────────── */
const atShop = s => s.mode === 'store';

const shopBill = (s, mul) => Math.round(Math.max(5e5, retailPotential(s) * mul * BAL.eventCostScale * 3));

const EV_SHOP = [
  s => ({
    title: '위생 점검 예고',
    body: '<p>구청에서 위생 점검을 나온다는 연락이 왔습니다.</p>',
    news: '구청 위생 점검 — 매장 대응 주목',
    choices: atShop(s) ? [
      { label: `미리 정비한다 — ${won(shopBill(s, 1))}`, sub: '지적 없이 넘어갑니다',
        run: () => { s.co.cash -= shopBill(s, 1); toast('점검을 무사히 통과했습니다', 'good'); } },
      { label: '그냥 받는다', sub: '적발 시 벌금과 인지도 하락',
        run: () => { if (chance(0.55)) { s.co.cash -= shopBill(s, 2.4); s.co.marketing = Math.max(1, s.co.marketing - 0.15); toast('위생 지적 — 벌금과 평판 하락', 'bad'); } else toast('별 지적 없이 끝났습니다'); } },
    ] : [
      { label: '보고만 받는다', sub: '자리를 비운 사이 처리됩니다',
        run: () => { if (chance(0.75)) { s.co.cash -= shopBill(s, 2.4); s.co.marketing = Math.max(1, s.co.marketing - 0.15); toast('위생 지적 — 벌금과 평판 하락', 'bad'); } else toast('별 지적 없이 끝났습니다'); } },
    ],
  }),
  s => ({
    title: '재고 도난',
    body: '<p>밤사이 진열대 일부가 털렸습니다.</p>',
    news: '매장 절도 발생',
    choices: [
      { label: '보안을 강화한다 — ' + won(shopBill(s, 1.4)), sub: '재고 손실을 줄입니다',
        run: () => { s.co.cash -= shopBill(s, 1.4); s.co.inv = clamp((s.co.inv ?? 100) - 8, 0, 100); toast('재고 -8%', 'bad'); } },
      { label: '넘어간다', sub: '재고가 크게 빕니다',
        run: () => { s.co.inv = clamp((s.co.inv ?? 100) - (atShop(s) ? 18 : 26), 0, 100); toast('재고 도난', 'bad'); } },
    ],
  }),
  s => ({
    title: '인플루언서 방문',
    body: '<p>팔로워가 많은 인플루언서가 매장을 찍고 싶다고 합니다.</p>',
    news: '인플루언서, 매장 방문 요청',
    choices: [
      { label: `제대로 대접한다 — ${won(shopBill(s, 1.6))}`, sub: `인지도 +${atShop(s) ? '0.45' : '0.28'}`,
        run: () => { s.co.cash -= shopBill(s, 1.6); s.co.marketing = clamp(s.co.marketing + (atShop(s) ? 0.45 : 0.28), 0, BAL.marketingCap); toast('영상이 퍼졌습니다', 'good'); } },
      { label: '정중히 사양한다', sub: '아무 일도 없습니다', run: () => {} },
    ],
  }),
  s => ({
    title: '단골 납품 제안',
    body: '<p>인근 사무실에서 정기 납품을 제안했습니다. 목돈을 먼저 받는 대신 재고가 빨리 빠집니다.</p>',
    news: '정기 납품 계약 제안',
    choices: [
      { label: `계약한다 — 선금 ${won(shopBill(s, 5))}`, sub: '재고 -20%',
        run: () => { s.co.cash += shopBill(s, 5); s.co.inv = clamp((s.co.inv ?? 100) - 20, 0, 100); toast('선금을 받았습니다', 'good'); } },
      { label: '거절한다', sub: '재고를 지킵니다', run: () => {} },
    ],
  }),
  s => ({
    title: '진상 손님',
    body: '<p>계산대에서 소란이 벌어져 다른 손님들이 나가고 있습니다.</p>',
    news: '매장 소란 발생',
    choices: atShop(s) ? [
      { label: '사장이 직접 응대한다', sub: '조용히 마무리됩니다',
        run: () => { toast('상황을 정리했습니다', 'good'); } },
      { label: '직원에게 맡긴다', sub: '인지도가 조금 빠집니다',
        run: () => { s.co.marketing = Math.max(1, s.co.marketing - 0.10); toast('인지도 -0.10', 'bad'); } },
    ] : [
      { label: '나중에 보고받는다', sub: '수습이 늦었습니다',
        run: () => { s.co.marketing = Math.max(1, s.co.marketing - 0.22); toast('인지도 -0.22', 'bad'); } },
    ],
  }),
  s => ({
    title: '정전',
    body: '<p>일대가 정전됐습니다. 냉장 상품이 위험합니다.</p>',
    news: '일대 정전 — 냉장 상품 비상',
    choices: [
      { label: `발전기를 돌린다 — ${won(shopBill(s, 1.2))}`, sub: '손실을 막습니다',
        run: () => { s.co.cash -= shopBill(s, 1.2); toast('피해 없이 넘겼습니다', 'good'); } },
      { label: '기다린다', sub: '냉장 설비가 좋을수록 덜 상합니다',
        run: () => { const lv = (s.co.facil && s.co.facil.cold) || 0;
          const lose = Math.max(4, 22 - lv * 5);
          s.co.inv = clamp((s.co.inv ?? 100) - lose, 0, 100); toast(`재고 -${lose}%`, 'bad'); } },
    ],
  }),
];

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

/* 1일 15초로 늦추면서 이벤트 하나하나의 비중이 커졌다. 종류가 적으면 금방
   외워지므로 업종·경기·사고 계열을 늘렸다. 전부 '선택지 2~3개 + 즉시 효과'
   구조를 지킨다 — 여기서 벗어나면 모달이 길어져 흐름이 끊긴다. */
const EV_MARKET = [
  s => ({ title:'시장 이벤트 — 원자재 가격 급등', news:'국제 원자재 가격 급등',
    body:'주요 원자재 가격이 단기간에 뛰었습니다. 원가 압박이 들어옵니다.',
    choices:[
      { label:'판매가 인상', sub:'인지도 -0.25 · 손실 없음',
        run:()=>{ s.co.marketing=Math.max(1,s.co.marketing-0.25); } },
      { label:'원가 흡수', sub:`${won(bill(s,0.010,0.22))} 지출 · 인지도 +0.15`,
        run:()=>{ s.co.cash-=bill(s,0.010,0.22); s.co.marketing=Math.min(BAL.marketingCap,s.co.marketing+0.15); } },
    ] }),
  s => ({ title:'시장 이벤트 — 물류 파업', news:'화물 운송 파업 돌입',
    body:'운송 파업으로 배송이 밀리고 있습니다.',
    choices:[
      { label:'대체 운송 수배', sub:`${won(bill(s,0.008,0.2))} 지출 · 피해 없음`,
        run:()=>{ s.co.cash-=bill(s,0.008,0.2); } },
      { label:'재고로 버틴다', sub:'이번 달 운영 효율 감소',
        run:()=>{ s.co.synergy=Math.max(BAL.synMin,s.co.synergy-0.12); } },
    ] }),
  s => ({ title:'시장 이벤트 — 입소문', news:'우리 매장이 화제',
    body:'우리 매장이 온라인에서 화제가 됐습니다.',
    choices:[
      { label:'광고를 붙인다', sub:`${won(bill(s,0.006,0.15))} 지출 · 인지도 +0.6`,
        run:()=>{ s.co.cash-=bill(s,0.006,0.15); s.co.marketing=Math.min(BAL.marketingCap,s.co.marketing+0.6); } },
      { label:'흐름에 맡긴다', sub:'인지도 +0.25',
        run:()=>{ s.co.marketing=Math.min(BAL.marketingCap,s.co.marketing+0.25); } },
    ] }),
  s => ({ title:'시장 이벤트 — 품질 문제', news:'일부 상품 회수 조치',
    body:'납품받은 상품에서 하자가 발견됐습니다.',
    choices:[
      { label:'전량 자진 회수', sub:`${won(bill(s,0.014,0.28))} 지출 · 신용 등급 +`,
        run:()=>{ s.co.cash-=bill(s,0.014,0.28); s.co.donate+=4; } },
      { label:'해당 지점만 교환', sub:'인지도 -0.4 · 신용 등급 -',
        run:()=>{ s.co.marketing=Math.max(1,s.co.marketing-0.4); s.co.donate-=3; } },
    ] }),
  s => ({ title:'시장 이벤트 — 업종 호황', news:'특정 업종 실적 개선 기대',
    body:'한 업종에 자금이 몰리며 몸값이 오르고 있습니다.',
    choices:[
      { label:'확인', sub:'해당 업종 기업 시총 상승 — 인수가도 같이 오른다',
        run:()=>{ const sec=pick(SECTOR_KEYS);
          s.market.forEach(c=>{ if(c.sector===sec && !c.owned){ c.cap=Math.round(c.cap*1.18); if(c.listed) c.price=Math.round(c.price*1.18); } });
          toast(`${SECTORS[sec].name} 업종 강세`,'good'); } },
    ] }),
];

const EV_TAX = [
  s => ({ title:'국세청 이벤트 — 공정위 조사', news:'공정거래위원회, 계열사 거래 조사',
    body:'계열사 간 내부거래에 대한 조사가 시작됐습니다.',
    choices:[
      { label:'자료 전면 공개', sub:`과징금 ${won(bill(s,0.016,0.3))} · 신용 등급 +`,
        run:()=>{ s.co.cash-=bill(s,0.016,0.3); s.co.donate+=3; } },
      { label:'법률 대응', sub:`${won(bill(s,0.010,0.22))} 지출 · 50% 확률로 무혐의`,
        run:()=>{ s.co.cash-=bill(s,0.010,0.22);
          if(chance(0.5)) toast('무혐의 종결','good');
          else { s.co.cash-=bill(s,0.020,0.3); s.co.probe+=8; toast('과징금 부과','bad'); } } },
    ] }),
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
  s => ({ title:'국가 이벤트 — 규제 강화', news:'정부, 대기업 규제안 발표',
    body:'정부가 대규모 인수합병에 대한 심사를 강화했습니다.',
    choices:[
      { label:'수용한다', sub:'한 업종의 인수 난이도 1단계 상승',
        run:()=>{ const sec=pick(SECTOR_KEYS);
          s.market.forEach(c=>{ if(c.sector===sec && !c.owned && c.diff<3) c.diff++; });
          toast(`${SECTORS[sec].name} 업종 인수 난이도 상승`,'bad'); } },
      { label:'업계 의견서 제출', sub:`${won(bill(s,0.010,0.24))} 지출 · 규제 회피 · 수사 게이지 +4`,
        run:()=>{ s.co.cash-=bill(s,0.010,0.24); s.co.probe+=4; } },
    ] }),
  s => ({ title:'국가 이벤트 — 소비 진작책', news:'정부, 내수 진작 대책 발표',
    body:'소비 쿠폰이 풀리며 소매 수요가 늘었습니다.',
    choices:[
      { label:'재고를 늘린다', sub:`${won(bill(s,0.008,0.2))} 지출 · 인지도 +0.5`,
        run:()=>{ s.co.cash-=bill(s,0.008,0.2); s.co.marketing=Math.min(BAL.marketingCap,s.co.marketing+0.5); } },
      { label:'평소대로', sub:'인지도 +0.15',
        run:()=>{ s.co.marketing=Math.min(BAL.marketingCap,s.co.marketing+0.15); } },
    ] }),
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
  /* 미신지수를 내릴 수단이 하나도 없어서 무속 루트가 한 방향으로만 쌓였다.
     (HANDOFF §10-4) 비용을 물리는 정화 선택지를 둬서 관리 가능하게 만든다. */
  s => ({ title:'무속 이벤트 — 정화 굿 권유', news:'그룹, 사내 정화 의식 논의',
    body:'그동안의 공작을 씻어내는 정화 굿을 권유받았습니다.',
    choices:[
      { label:'정화 굿을 올린다', sub:`${won(bill(s,0.012,0.25))} 지출 · 미신지수 -18`,
        run:()=>{ s.co.cash-=bill(s,0.012,0.25); s.co.mistrust=Math.max(0,s.co.mistrust-18); toast('미신지수 하락','good'); } },
      { label:'기부로 대신한다', sub:`${won(bill(s,0.008,0.18))} 지출 · 미신지수 -8 · 신용 등급 +`,
        run:()=>{ s.co.cash-=bill(s,0.008,0.18); s.co.mistrust=Math.max(0,s.co.mistrust-8); s.co.donate+=5; } },
      { label:'미신은 미신일 뿐', sub:'변화 없음', run:()=>{} },
    ] }),
];

export { EV_CORP, EV_MARKET, EV_NATION, EV_SHAMAN, EV_SHOP, EV_TAX, bill, tickEvent };
