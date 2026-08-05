import { SECTORS, SECTOR_KEYS } from './data.js';
import { chance, rint } from './util.js';

/* ══════════════════════════════════════════════════════════════
   계열사 특성 — 업종 퍼크(층 1) + 개별 태그(층 2) + 사업부(층 3)

   왜 필요한가: 계열사가 `sector` + `cap` 두 값뿐이라 인수 후에 판단거리가
   없었다. 그룹 효율 배수 하나로 전부 뭉개져서 "어느 업종을 모으든 결과가 같다".
   여기서 업종에 개성을 주고, 회사마다 태그를 붙여 매각·투자·재편에
   고민을 만든다.

   **이 파일은 순수하다.** 상태를 읽기만 하고 바꾸지 않는다. UI·렌더를 모른다.
   sim 봇이 그대로 호출할 수 있어야 하므로 이 원칙을 깨지 말 것.
   ══════════════════════════════════════════════════════════════ */

/* ── 층 1: 업종 퍼크 ──────────────────────────────────────
   계열사 1개당 아래 값이 누적된다. 업종당 PERK_CAP 스택이 상한이고,
   같은 업종 3개로 사업부가 결성되면 그 업종만 2배가 된다.

   초반 유효 업종(daily·retail·food)과 후반 유효 업종(fin·it·pharma)을
   갈라 놨다. 등급이 오르면 모아야 할 업종이 바뀐다.
   fin·it 은 레버리지 전략을 강화한다 — 빠른 대신 업종이 묶여
   다양성을 포기하게 만드는 대가 구조. */
const PERK_CAP = 5;

const SECTOR_PERK = {
  daily:  { retailMul:  0.04 },   // 매장 매출
  food:   { invLife:    0.05 },   // 재고 소모 완화
  fashion:{ mktKeep:    0.20 },   // 인지도 감쇠 완화
  retail: { invCost:   -0.06 },   // 발주 단가
  tech:   { facilCost: -0.08 },   // 시설 증설 비용
  it:     { pmiFast:    0.12 },   // 통합 기간 단축
  pharma: { subIncome:  0.03 },   // 계열사 수익 전체
  build:  { managers:   0.5  },   // 관리 인력
  fin:    { rateCut:    0.25, loanLimit: 0.04 },   // 금리 / 한도
  media:  { mktGain:    0.05 },   // 인지도 자동 상승
};

/** UI 표기용 한 줄 설명 (계열사 1개당) */
const PERK_TEXT = {
  daily:'매장 매출 +4%', food:'재고 소모 -5%', fashion:'인지도 감소 완화 20%',
  retail:'발주 단가 -6%', tech:'시설 증설 -8%', it:'통합 기간 -12%',
  pharma:'계열사 수익 +3%', build:'관리 인력 +0.5', fin:'금리 -0.25%p · 한도 +4%',
  media:'인지도 +0.05/일',
};

const PERK_KEYS = ['retailMul','invLife','mktKeep','invCost','facilCost','pmiFast',
                   'subIncome','managers','rateCut','loanLimit','mktGain'];

/* ── 층 2: 개별 태그 ──────────────────────────────────────
   회사 생성 시 0~2개가 붙는다. hidden 인 것은 실사(단계 2) 전까지 안 보인다.
   curable 인 것은 투자로 없앨 수 있다 — 이게 '투자'를 성립시키는 축이다.

   핵심 조합은 rot + patent 다. 헐값에 사서 살리면 업종 전체가 오른다.
   이게 없으면 "인수 = 무조건 이득"이라 되팔 이유가 안 생긴다. */
const SUB_TAGS = {
  gem:    { n:'알짜',        d:'수익 +40% · 인수가 +25%',        yield: 1.40, price: 1.25, w: 10 },
  rot:    { n:'부실',        d:'수익 -50% · 인수가 -40%',        yield: 0.50, price: 0.60, w: 12, curable: true },
  old:    { n:'노후 설비',   d:'투자 전까지 수익 -30%',          yield: 0.70,              w: 12, curable: true },
  union:  { n:'강성 노조',   d:'관리 인력을 2배로 먹는다',        mgr: 2,                   w: 10 },
  patent: { n:'특허 보유',   d:'같은 업종 계열사 전체 +10%',      sectorBonus: 0.10,        w:  8 },
  brand:  { n:'브랜드',      d:'인지도 +0.4 상시',               mkt: 0.4,                 w:  9 },
  owner:  { n:'오너 일가',   d:'시너지 -0.1 · 매각가 +30%',       syn: -0.10, sell: 1.30,  w:  9 },
  child:  { n:'자회사 보유', d:'인수 시 소형 계열사가 딸려 온다',  spawn: 0.15,              w:  7 },
  debt:   { n:'우발채무',    d:'인수 후 숨은 빚이 터질 수 있다',   risk: 0.40, hidden: true, w: 13 },
  global: { n:'해외 법인',   d:'수익 변동폭 2배 · 국가 이벤트 노출', vol: true, evt: 1.5,   w: 10 },
};

const TAG_KEYS = Object.keys(SUB_TAGS);
const TAG_W_SUM = TAG_KEYS.reduce((a, k) => a + SUB_TAGS[k].w, 0);

/**
 * 회사 하나에 붙일 태그 배열. seedMarket 에서만 호출한다.
 * 게임 rng 스트림을 쓰는 chance/rint 를 거치므로 시드가 같으면 결과도 같다.
 * 60% 로 1개, 그중 25% 가 2개 → 기대 태그 수 0.75개.
 */
function rollSubTags() {
  if (!chance(0.60)) return [];
  const out = [ TAG_KEYS[weightedIdx()] ];
  if (chance(0.25)) {
    for (let i = 0; i < 6; i++) {          // 중복 회피 재시도
      const k = TAG_KEYS[weightedIdx()];
      if (k !== out[0]) { out.push(k); break; }
    }
  }
  return out;
}

/** 게임 rng 를 쓰는 가중 인덱스 (rint 경유) */
function weightedIdx() {
  let r = rint(1, TAG_W_SUM);
  for (let i = 0; i < TAG_KEYS.length; i++) { r -= SUB_TAGS[TAG_KEYS[i]].w; if (r <= 0) return i; }
  return 0;
}

/* ── 조회 헬퍼 ───────────────────────────────────────────── */
const tagsOf     = c => (c && c.tags) || [];
const hasTag     = (c, k) => tagsOf(c).includes(k);
/** 화면에 보여도 되는 태그만 (실사로 깐 것은 c.seen 에 들어온다) */
const visibleTags = c => tagsOf(c).filter(k => !SUB_TAGS[k].hidden || (c.seen || []).includes(k));
/** 투자로 없앨 수 있는 태그 (있으면 첫 번째) */
const curableTag = c => tagsOf(c).find(k => SUB_TAGS[k].curable) || null;

/* ── 층 3: 사업부 ────────────────────────────────────────
   같은 업종 3개면 결성. 그 업종 퍼크가 2배가 되고 이름이 붙는다.
   중견기업 구간(전체의 31%)에서 "자금이 모일 때까지 기다리기" 말고
   "유통사업부 하나만 더"라는 중간 목표를 만드는 장치. */
const DIV_AT = 3;
const HOLDING_AT = 5;          // 사업부 5개 → 지주회사 체제

function sectorCount(s) {
  const by = {};
  s.co.subs.forEach(c => by[c.sector] = (by[c.sector] || 0) + 1);
  return by;
}

/** 결성된 사업부의 업종 키 배열 */
function divisionsOf(s) {
  const by = sectorCount(s);
  return SECTOR_KEYS.filter(k => (by[k] || 0) >= DIV_AT);
}

const divisionName = k => `${SECTORS[k].name}사업부`;
const isHolding    = s => divisionsOf(s).length >= HOLDING_AT;

/* ── 퍼크 합계 ───────────────────────────────────────────
   매 프레임 여러 곳에서 불리므로 메모이즈한다. 키는 계열사 목록의
   업종 구성 그대로 — 인수·매각·재편 어느 쪽이든 키가 바뀐다. */
let _perkKey = null, _perkVal = null;

function perkSignature(s) {
  return s.co.subs.map(c => c.sector).sort().join(',');
}

/**
 * 업종 퍼크 합계. 사업부가 결성된 업종은 2배.
 * 반환 객체는 PERK_KEYS 전부를 0 기본값으로 갖는다 — 소비처에서 ?? 를 안 써도 된다.
 */
function perksOf(s) {
  const key = perkSignature(s);
  if (key === _perkKey && _perkVal) return _perkVal;

  const out = {};
  PERK_KEYS.forEach(k => out[k] = 0);
  const by = sectorCount(s);
  const divs = divisionsOf(s);

  for (const sec of SECTOR_KEYS) {
    const n = Math.min(by[sec] || 0, PERK_CAP);
    if (!n) continue;
    const mul = divs.includes(sec) ? 2 : 1;
    const perk = SECTOR_PERK[sec] || {};
    for (const k in perk) out[k] += perk[k] * n * mul;
  }
  _perkKey = key; _perkVal = out;
  return out;
}

/** 계열사 목록을 코드로 직접 건드렸을 때 캐시를 버린다 (재편 완료 등) */
function bumpPerks() { _perkKey = null; }

/* ── 태그가 만드는 배수 ──────────────────────────────────── */

/** 업종별 특허 보너스 배수 { it: 1.10, ... } */
function sectorBonusOf(s) {
  const out = {};
  s.co.subs.forEach(c => {
    if (!hasTag(c, 'patent')) return;
    out[c.sector] = (out[c.sector] || 1) + SUB_TAGS.patent.sectorBonus;
  });
  return out;
}

/**
 * 계열사 하나의 수익 배수. gem/rot/old + 같은 업종 특허 + 해외 변동.
 * secBonus 는 sectorBonusOf 결과를 넘겨 재계산을 피한다.
 */
function subYieldMul(c, secBonus) {
  let m = 1;
  for (const k of tagsOf(c)) { const t = SUB_TAGS[k]; if (t.yield) m *= t.yield; }
  if (secBonus && secBonus[c.sector]) m *= secBonus[c.sector];
  if (hasTag(c, 'global')) m *= (c.vol ?? 1);   // 월 정산에서 갱신되는 0.7~1.4
  return m;
}

/** 인수가 배수 (매물 시점) */
function subPriceMul(c) {
  let m = 1;
  for (const k of tagsOf(c)) { const t = SUB_TAGS[k]; if (t.price) m *= t.price; }
  return m;
}

/** 이 계열사가 먹는 관리 인력 몫 (기본 1) */
function subMgrLoad(c) { return hasTag(c, 'union') ? SUB_TAGS.union.mgr : 1; }

/** 태그가 그룹 시너지에 직접 더하는 값의 합 (owner 등) */
function tagSynergy(s) {
  return s.co.subs.reduce((a, c) => {
    let v = 0;
    for (const k of tagsOf(c)) { const t = SUB_TAGS[k]; if (t.syn) v += t.syn; }
    return a + v;
  }, 0);
}

/** 태그가 주는 인지도 상시 보너스 합 (brand) */
function tagMarketing(s) {
  return s.co.subs.reduce((a, c) => a + (hasTag(c, 'brand') ? SUB_TAGS.brand.mkt : 0), 0);
}

/** 국가·국세청 이벤트 노출 배수 (global 보유 시 상승) */
function eventExposure(s) {
  const n = s.co.subs.filter(c => hasTag(c, 'global')).length;
  return 1 + n * (SUB_TAGS.global.evt - 1) * 0.2;   // 5개면 ×1.5
}

/* ── UI 조각 ─────────────────────────────────────────────
   ui 를 import 하지 않는다. 문자열만 돌려주고 붙이는 건 호출부 몫. */
const TAG_CLS = {
  gem:'c-gold', rot:'c-blood', old:'c-dim', union:'c-blood', patent:'c-jade',
  brand:'c-sky', owner:'c-mauve', child:'c-jade', debt:'c-blood', global:'c-sky',
};

/** `<b class="c-gold">알짜</b>` 형태의 칩 HTML */
function tagChip(k) {
  const t = SUB_TAGS[k]; if (!t) return '';
  return `<b class="${TAG_CLS[k] || ''}" title="${t.d}">${t.n}</b>`;
}

/** 보이는 태그 전부를 가운뎃점으로 이어 붙인다. 없으면 빈 문자열 */
function tagChips(c) {
  const ks = visibleTags(c);
  return ks.length ? ks.map(tagChip).join(' · ') : '';
}

/** 숨은 태그가 남아 있는지 — 회사 팝업에서 '???' 표기 여부 */
function hasHidden(c) {
  return tagsOf(c).some(k => SUB_TAGS[k].hidden && !(c.seen || []).includes(k));
}

export { PERK_CAP, PERK_KEYS, PERK_TEXT, SECTOR_PERK, SUB_TAGS, TAG_KEYS };
export { DIV_AT, HOLDING_AT, divisionName, divisionsOf, isHolding, sectorCount };
export { bumpPerks, perksOf, rollSubTags, sectorBonusOf };
export { curableTag, hasHidden, hasTag, tagsOf, visibleTags };
export { eventExposure, subMgrLoad, subPriceMul, subYieldMul, tagMarketing, tagSynergy };
export { tagChip, tagChips };
