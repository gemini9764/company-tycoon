import { BAL } from './balance.js';
import { FIRST, GIVEN, NAME_A, SECTORS, SECTOR_KEYS, SHAMAN_TIERS, TRAITS } from './data.js';
import { chance, clamp, pick, rint, rnd } from './util.js';
import { recalcCap } from '../systems/company.js';

/* ── 상태 ────────────────────────────────────────────────── */
let S = null;

/** S 는 게임 전체가 공유하는 단일 상태. 교체는 반드시 이 함수로 한다. */
function setS(next) { S = next; return S; }

function newState(companyName) {
  const s = {
    v: 3,
    day: 1, speed: 1, mode: 'city',
    co: {
      name: companyName || '한별상사',
      tier: 0, cash: BAL.startCash,
      subs: [],            // 인수한 계열사 {id,name,sector,cap,diff}
      hardAcq: 0,          // 난이도 '상' 이상 인수 횟수
      marketing: 1.0,      // 인지도 배수
      cap: 0, rank: 5000,
      donate: 0,           // 기부 누적 보너스
      probe: 0,            // 검찰/국세청 수사 게이지
      mistrust: 0,         // 무속 신뢰도(미신지수)
      revToday: 0, costToday: 0, rev30: [], negMonths: 0,
      synergy: 1.0, auditBuff: 0,
    },
    staff: [], recruits: [],
    market: [],            // NPC 회사
    nego: null,            // 진행 중 협상
    bank: { rateDelta_: 0, loans: [], insured: false, overdue: 0 },
    stock: { holds: {}, watch: [] },
    shaman: { hired: null, pool: [], unlocked: false },
    rumors: [],
    inbox: [], log: [],
    flags: { tutorialSeen: false, ending: null },
    lastEventDay: 0,
  };
  seedMarket(s);
  s.staff = [ makeStaff(1), makeStaff(1) ];
  s.recruits = [ makeStaff(1), makeStaff(2), makeStaff(2) ];
  s.shaman.pool = [ makeShaman(0) ];
  recalcCap(s);
  return s;
}

/* NPC 회사 23개 — 도시 맵 격자에 배치. 규모는 셔플해 위치와 무관하게 흩뿌린다. */
function seedMarket(s) {
  const lots = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) lots.push({ tx: 1 + i * 3, ty: 1 + j * 3 });
  for (let i = lots.length - 1; i > 0; i--) { const j = rint(0, i); [lots[i], lots[j]] = [lots[j], lots[i]]; }
  s.co.lot = lots.pop();   // 기획서: 초기 설립 위치 랜덤

  const used = new Set();
  s.market = lots.map((lot, i) => {
    const sector = pick(SECTOR_KEYS);
    let nm;
    do { nm = pick(NAME_A) + pick(SECTORS[sector].suf); } while (used.has(nm));
    used.add(nm);
    // 6천만 ~ 15조. 등급 상한과 맞물려 초반엔 소형사만 손댈 수 있다.
    const t = i / (lots.length - 1);
    const cap = Math.round(6e7 * Math.pow(250000, t) * rnd(0.7, 1.45));
    const diff = cap > 2e12 ? 3 : cap > 1e11 ? 2 : cap > 3e9 ? 1 : 0;
    const listed = cap > 2e9 && chance(0.78);
    return {
      id: 'c' + i, name: nm, sector,
      cap, diff, diff0: diff, lot, listed,   // diff0 = 원래 난이도 (등급 조건 판정 기준)
      price: listed ? Math.max(500, Math.round(cap / rint(3000, 90000) / 10) * 10) : 0,
      hist: [], owned: false, curse: 0,
    };
  });
  s.market.forEach(c => { if (c.listed) c.hist = Array(24).fill(c.price); });
}

function makeStaff(grade) {
  const g = clamp(grade, 1, 5);
  const roll = () => rint(6, 12) + g * rint(3, 8);
  const t = chance(0.55) ? pick(TRAITS.filter(x => x.id !== 'none')) : TRAITS[5];
  const st = { nego: roll(), intel: roll(), sales: roll(), fin: roll() };
  const sum = st.nego + st.intel + st.sales + st.fin;
  return {
    id: 'e' + Math.random().toString(36).slice(2, 8),
    name: pick(FIRST) + pick(GIVEN),
    ...st, trait: t, grade: g,
    salary: Math.round(sum * 15000 * Math.pow(1.28, g) / 10000) * 10000, // 월급
    exp: 0, lv: 1, onTeam: false,
  };
}

function makeShaman(tier) {
  const t = SHAMAN_TIERS[clamp(tier, 0, 2)];
  return {
    id: 's' + Math.random().toString(36).slice(2, 7),
    name: pick(['월하','청산','백호','천수','북두','삼신','용궁','만신','설악','금강']) + pick(['보살','도사','법사','만신']),
    tier: clamp(tier, 0, 2), ...t,
  };
}

export { setS, S, makeShaman, makeStaff, newState, seedMarket };
