import { netWorth } from './derive.js';
import { S } from './state.js';

/* 승급 목표.
 *
 * **등급마다 병목이 되는 축이 달라야 한다.** 예전에는 4개 등급이 순자산 하나를
 * 봤고, 순위마저 같은 값에서 나와 대기업 구간이 시드에 따라 1~7일로 스쳐
 * 지나갔다(승급 연출이 이틀 사이 두 번). 지금은 자금 → 행동 → 수집 → 자금 →
 * 도전 → 조합 → 순위 로 번갈아 간다.
 *
 * `divisionsOf` 를 여기서 쓰지 않고 `s.co.divs` 를 보는 이유는 core/tags.js 가
 * core/data.js 를 import 하고 있어 서로 물리기 때문이다. 값은 매일 갱신된다
 * (systems/economy.js:tickEconomy).
 */
const TIERS = [
  { name:'구멍가게',   goal:'순자산 2,000만 확보',              bldg:0, ok:s=>netWorth(s)>=2e7, at:s=>[netWorth(s), 2e7, 'won'] },
  { name:'동네슈퍼',   goal:'첫 M&A 성사',                     bldg:1, ok:s=>s.co.subs.length>=1 },
  { name:'스타트업',   goal:'계열사 3개 확보',                 bldg:2, ok:s=>s.co.subs.length>=3, unlock:'무당 시스템', at:s=>[s.co.subs.length, 3, 'n'] },
  { name:'중소기업',   goal:'순자산 300억 + 계열사 8개',          bldg:3, ok:s=>netWorth(s)>=3e10 && s.co.subs.length>=8, unlock:'국세청 이벤트', at:s=>[netWorth(s), 3e10, 'won', s.co.subs.length, 8, '계열사'] },
  { name:'중견기업',   goal:"난이도 '상' 이상 기업 인수",       bldg:4, ok:s=>s.co.hardAcq>=1, unlock:'국가 이벤트' },
  { name:'대기업',     goal:'사업부 5개 — 그룹 본사 출범',        bldg:5, ok:s=>(s.co.divs || 0) >= 5, at:s=>[s.co.divs || 0, 5, 'n'] },
  { name:'글로벌그룹', goal:'자산 순위 1위',                    bldg:6, ok:s=>s.co.rank<=1 },
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
/* `goods` 는 그 업종을 인수하면 매장 매대에 오르는 물건이다.
   게임이 인수 때마다 "OO 상품군 추가" 라고 말해 놓고 실제로는 계열사 **개수**만
   세고 있었다 — 제약을 사든 식품을 사든 결과가 같았다. 이 배열이 그 말을
   지키게 하는 실체다. 손님 대사와 진열 색이 여기서 나온다. */
const SECTORS = {
  daily:  { name:'생필품', color:'#A8CE93', margin:0.26, suf:['상사','물산','유통'],
            goods:['휴지','세제','칫솔'] },
  food:   { name:'식품',   color:'#F0C48A', margin:0.30, suf:['식품','에프앤비','농산'],
            goods:['라면','우유','과자'] },
  fashion:{ name:'의류',   color:'#E4A9C4', margin:0.44, suf:['패션','어패럴','섬유'],
            goods:['양말','티셔츠','장갑'] },
  retail: { name:'유통',   color:'#9BC7E4', margin:0.18, suf:['유통','리테일','마트'],
            goods:['생수','종이컵','봉투'] },
  tech:   { name:'전자',   color:'#A3AEE4', margin:0.34, suf:['전자','정밀','텍'],
            goods:['건전지','충전기','이어폰'] },
  it:     { name:'IT',     color:'#8FDCD4', margin:0.58, suf:['소프트','네트웍스','시스템즈'],
            goods:['기프트카드','공유기','USB'] },
  pharma: { name:'제약',   color:'#C7ADE4', margin:0.52, suf:['제약','바이오','파마'],
            goods:['비타민','밴드','마스크'] },
  build:  { name:'건설',   color:'#CFB79A', margin:0.16, suf:['건설','중공업','산업'],
            goods:['공구','테이프','목장갑'] },
  fin:    { name:'금융',   color:'#E6D392', margin:0.40, suf:['캐피탈','금융','홀딩스'],
            goods:['상품권','교통카드','복권'] },
  media:  { name:'미디어', color:'#F0A894', margin:0.46, suf:['미디어','엔터','방송'],
            goods:['잡지','굿즈','앨범'] },
};

const SECTOR_KEYS = Object.keys(SECTORS);

/* ══════════════════════════════════════════════════════════════
   매대 구역

   진열대 좌표는 전부 하드코딩 상수라 **자리는 플레이어가 못 옮긴다.**
   그래서 자유 배치 대신 "자리는 고정, 무엇을 놓을지를 고른다" 로 갔다.
   드래그 UI 도, 손님 경로가 막힐 위험도 없이 배치의 본질만 남는다.

   `traffic` 은 문(gx 0, gy 7)과 계산대(gx 6, gy 3)를 잇는 주 동선에서 얼마나
   가까운지다. 입구 매대가 가장 목이 좋고 냉장 매대가 가장 안쪽이다.
   **좌표와 통행량이 한 표에 있어야** 화면(render/store.js)이 칠하는 자리와
   계산(systems/economy.js)이 세는 자리가 어긋나지 않는다.

   상품군 하나는 한 구역에만 배정된다 — 그 제약이 이 시스템의 전부다.
   중복이 되면 마진 제일 높은 업종을 전 구역에 깔면 그만이라 선택이 사라진다.
   ══════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════
   등급별 매장

   가게 크기를 시설 업그레이드에 두면 "돈만 있으면 언제든 커지는 것"이 되어,
   도시 탭에서 등급마다 건물이 바뀌는 것과 결이 어긋난다. 매장이 커지는 건
   **회사가 커졌기 때문**이어야 한다.

   변화는 두 갈래로 나눴다.
   · 기능(진열대·계산대·냉장 대수)은 **자리와 상한만 열어 주고** 사는 건 플레이어다.
     등급이 자동으로 다 채워 주면 시설 탭이 할 일이 없어진다.
   · 겉모습(바닥·벽·조명·장식·창·러그)은 **자동으로** 좋아진다. 여기까지 돈을
     받으면 등급이 오른 보람이 안 난다.

   `depth` 는 남쪽으로 늘어나는 줄 수다. 9~17 줄 사이를 7등급이 계단으로 오른다 —
   구멍가게에서 스타트업으로 뛰었다고 갑자기 두 배가 되면 안 되므로 같은 깊이가
   두 등급씩 이어지는 구간을 뒀다.
   예전 상한 13 줄은 미관이 아니라 한계였다 — 월드 높이가 캔버스 절반을 넘으면
   정수 배율이 2에서 1로 떨어져 화면이 반쪽이 됐다. 지금은 배율을 고정하고
   카메라가 잡으므로(render/canvas.js applyCamera) 그 제약이 없다.
   후반 등급에서 폭을 키운 이유는 **커진 티가 나야 하기 때문**이다 — 한 줄씩만
   늘리면 대기업과 글로벌그룹이 눈으로 구분되지 않는다.
   ══════════════════════════════════════════════════════════════ */
const STORE_GRADE = [
  //                깊이 진열대 계산대 냉장 조명 장식 창 러그 바닥 손님 부속실 벽
  { depth: 0, shelf: 1, counter: 0, cold: 1, light: 0, deco: 0, win: 0, rug: 0, floor: 0, crowd:  4, rooms: 0 },  // 구멍가게
  { depth: 1, shelf: 2, counter: 1, cold: 2, light: 1, deco: 1, win: 0, rug: 0, floor: 0, crowd:  6, rooms: 0 },  // 동네슈퍼
  { depth: 3, shelf: 3, counter: 1, cold: 3, light: 1, deco: 1, win: 1, rug: 0, floor: 1, crowd:  9, rooms: 0 },  // 스타트업
  { depth: 3, shelf: 3, counter: 2, cold: 4, light: 2, deco: 2, win: 2, rug: 0, floor: 1, crowd: 12, rooms: 0 },  // 중소기업
  { depth: 4, shelf: 4, counter: 2, cold: 5, light: 2, deco: 2, win: 3, rug: 1, floor: 2, crowd: 15, rooms: 1 },  // 중견기업
  { depth: 6, shelf: 5, counter: 3, cold: 5, light: 3, deco: 3, win: 4, rug: 1, floor: 2, crowd: 18, rooms: 1 },  // 대기업
  { depth: 8, shelf: 5, counter: 3, cold: 5, light: 3, deco: 3, win: 4, rug: 1, floor: 3, crowd: 22, rooms: 2 },  // 글로벌그룹
];

const gradeOf = s => STORE_GRADE[Math.min(STORE_GRADE.length - 1, s.co.tier)];

/* ══════════════════════════════════════════════════════════════
   모집 방법

   레퍼런스는 게임 개발 스토리의 '어떻게 찾으시겠습니까'다. **비쌀수록 좋은
   사람이 온다**는 한 줄이 전부이고, 그래서 돈을 얼마나 쓸지가 판단이 된다.

   `bump` 는 등급 가산, `pick` 은 보여 줄 후보 수다. 싼 쪽은 후보가 적어
   운에 걸리고, 비싼 쪽은 많이 보여 주므로 **돈이 확률까지 산다.**
   `cost` 는 자사 시총 비례라 후반에도 값이 남는다 (고정값이면 금세 공짜가 된다).
   ══════════════════════════════════════════════════════════════ */
const HIRE_WAYS = [
  { id: 'intro',  n: '지인 소개',     bump: 0, pick: 2, cost: 0.0006, d: '아는 사람에게 물어본다' },
  { id: 'flyer',  n: '전단지 모집',   bump: 0, pick: 3, cost: 0.0018, d: '동네에 붙인다. 사람은 많이 온다' },
  { id: 'online', n: '구인 사이트',   bump: 1, pick: 3, cost: 0.0055, d: '경력직이 눈에 띈다' },
  { id: 'school', n: '대학 채용설명회', bump: 1, pick: 4, cost: 0.014, d: '갓 졸업한 인재를 먼저 본다' },
  { id: 'agency', n: '헤드헌터 의뢰', bump: 2, pick: 4, cost: 0.034, d: '업계에서 이름난 사람을 데려온다' },
  { id: 'global', n: '해외 스카웃',   bump: 3, pick: 4, cost: 0.085, d: '돈으로 살 수 있는 최고를 부른다' },
];

const SHOP_ZONES = [
  { id: 'front', n: '입구 매대', traffic: 1.00, tiles: [[1, 6], [2, 6], [3, 6]] },
  { id: 'aisle', n: '중앙 통로', traffic: 0.82, tiles: [[5, 6], [6, 6]] },
  { id: 'back',  n: '안쪽 매대', traffic: 0.60, tiles: [[1, 3], [2, 3], [3, 3]] },
  { id: 'cold',  n: '냉장 매대', traffic: 0.45, tiles: [[1, 1], [2, 1], [3, 1]] },
];

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

export { LIST_TIER, TIER_CAP, capTier, CREDITS, DIFFS, FIRST, GIVEN, NAME_A, RUMOR_GRADES, SECTORS, HIRE_WAYS, STORE_GRADE, gradeOf, SHOP_ZONES, SECTOR_KEYS, SHAMAN_TIERS, TIERS, TRAITS };
