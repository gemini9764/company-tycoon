import { netWorth } from './derive.js';
import { S } from './state.js';

const TIERS = [
  { name:'구멍가게',   goal:'순자산 3,000만 확보',              bldg:0, ok:s=>netWorth(s)>=3e7 },
  { name:'동네슈퍼',   goal:'순자산 1억 + 첫 M&A 성사',          bldg:1, ok:s=>netWorth(s)>=1e8 && s.co.subs.length>=1 },
  { name:'스타트업',   goal:'계열사 3개 확보',                 bldg:2, ok:s=>s.co.subs.length>=3, unlock:'무당 시스템' },
  { name:'중소기업',   goal:'순자산 500억 + 계열사 5개',          bldg:3, ok:s=>netWorth(s)>=5e10 && s.co.subs.length>=5, unlock:'국세청 이벤트' },
  { name:'중견기업',   goal:"난이도 '상' 이상 기업 인수",       bldg:4, ok:s=>s.co.hardAcq>=1, unlock:'국가 이벤트' },
  { name:'대기업',     goal:'순자산 7,000억 + 시총 순위 120위 입성',  bldg:5, ok:s=>netWorth(s)>=7e11 && s.co.rank<=120 },
  { name:'글로벌그룹', goal:'시가총액 순위 1위',                bldg:6, ok:s=>s.co.rank<=1 },
];

/* NPC 회사의 규모 등급. 플레이어 등급(TIERS)은 목표 달성으로 오르지만 NPC 는
   시총밖에 없으므로 구간으로 환산한다. 값은 각 등급의 상한 시총이다. */
const TIER_CAP = [1e8, 1e9, 1e10, 1e11, 1.5e12, 1.5e13, Infinity];

/** 시총 → 등급 인덱스 (0 구멍가게 ~ 6 글로벌그룹) */
function capTier(cap) {
  const i = TIER_CAP.findIndex(v => cap < v);
  return i < 0 ? TIER_CAP.length - 1 : i;
}

/** 상장 기준 — 중견기업(4) 이상은 무조건 상장. 플레이어 회사는 상장하지 않는다. */
const LIST_TIER = 4;

/* ── 업종 ────────────────────────────────────────────────── */
const SECTORS = {
  daily:  { name:'생필품', color:'#A8CE93', margin:0.26, suf:['상사','물산','유통'] },
  food:   { name:'식품',   color:'#F0C48A', margin:0.30, suf:['식품','에프앤비','농산'] },
  fashion:{ name:'의류',   color:'#E4A9C4', margin:0.44, suf:['패션','어패럴','섬유'] },
  retail: { name:'유통',   color:'#9BC7E4', margin:0.18, suf:['유통','리테일','마트'] },
  tech:   { name:'전자',   color:'#A3AEE4', margin:0.34, suf:['전자','정밀','텍'] },
  it:     { name:'IT',     color:'#8FDCD4', margin:0.58, suf:['소프트','네트웍스','시스템즈'] },
  pharma: { name:'제약',   color:'#C7ADE4', margin:0.52, suf:['제약','바이오','파마'] },
  build:  { name:'건설',   color:'#CFB79A', margin:0.16, suf:['건설','중공업','산업'] },
  fin:    { name:'금융',   color:'#E6D392', margin:0.40, suf:['캐피탈','금융','홀딩스'] },
  media:  { name:'미디어', color:'#F0A894', margin:0.46, suf:['미디어','엔터','방송'] },
};

const SECTOR_KEYS = Object.keys(SECTORS);

/* 인수 난이도 */
const DIFFS = [
  { name:'하',   mul:2.0, prem:0.20 },
  { name:'중',   mul:1.0, prem:0.35 },
  { name:'상',   mul:0.52, prem:0.52 },
  { name:'최상', mul:0.28, prem:0.72 },
];

/* 신용 등급 */
const CREDITS = ['D','C','CC','CCC','B','BB','BBB','A','AA','AAA'];

/* 무당 등급 */
const SHAMAN_TIERS = [
  { name:'무명 무당', rate:0.45, power:1.0, expose:0.08, feeMul:0.010 },
  { name:'유명 무당', rate:0.66, power:1.6, expose:0.13, feeMul:0.030 },
  { name:'급살 무당', rate:0.86, power:2.4, expose:0.22, feeMul:0.075 },
];

/* 찌라시 등급 */
const RUMOR_GRADES = [
  { g:'F', w:34, val:0.04 }, { g:'E', w:26, val:0.07 }, { g:'D', w:18, val:0.11 },
  { g:'C', w:11, val:0.16 }, { g:'B', w:7,  val:0.22 }, { g:'A', w:3, val:0.30 },
  { g:'S', w:1,  val:0.42 },
];

/* ── 이름 생성기 (실존 기업 연상 회피) ────────────────────── */
const NAME_A = ['한별','대성','유원','청림','태산','금호림','새벽','두손','백양','서진','명진','우강','하람','도원','성일','만세','청암','늘봄','가온','한샘터','벽산로','정도','솔뫼','해원','창평','북극성','미르','신태','다솔','율현'];

const FIRST = ['김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권','황','안','송','류','전'];

const GIVEN = ['도현','서연','민준','지우','예준','하윤','시우','서준','지호','수아','건우','유진','태윤','다은','성민','채원','우진','나연','현우','소율','재원','미르','한결','보람'];

const TRAITS = [
  { id:'shark',  name:'승부사',   desc:'협상력 +15%',            },
  { id:'ear',    name:'마당발',   desc:'찌라시 획득률 +60%',      },
  { id:'calm',   name:'포커페이스', desc:'협상 악재 이벤트 완화',  },
  { id:'cheap',  name:'짠돌이',   desc:'인수가 웃돈 -6%p',    },
  { id:'star',   name:'간판스타', desc:'매장 매출 +12%',          },
  { id:'none',   name:'평범',     desc:'특이사항 없음',           },
];

export { LIST_TIER, TIER_CAP, capTier, CREDITS, DIFFS, FIRST, GIVEN, NAME_A, RUMOR_GRADES, SECTORS, SECTOR_KEYS, SHAMAN_TIERS, TIERS, TRAITS };
