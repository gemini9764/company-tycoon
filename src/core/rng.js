/* ══════════════════════════════════════════════════════════════
   RNG — 결정론적 난수 (mulberry32)

   `Math.random()` 은 재현이 안 된다. 밸런스를 잴 때마다 ±8% 가 흔들려서
   "이 수치를 바꿨더니 며칠 빨라졌다"를 말할 수 없었다. 같은 시드에서 같은
   판이 나와야 계측이 계측이 된다.

   **스트림을 둘로 나눈다.**

   | 스트림 | 쓰는 곳 | 저장 |
   |---|---|---|
   | game | 매물 배치·인수 판정·이벤트·찌라시 등 결과에 영향을 주는 전부 | 한다 |
   | view | 차량 위치·손님 색·머리 모양처럼 연출에만 쓰는 것 | 안 한다 |

   섞으면 안 된다. 사옥 창을 한 번 더 열어 손님이 몇 명 더 태어났다는 이유로
   그날의 인수 판정이 달라지면, 같은 시드에서 같은 판이 안 나온다.

   상태는 uint32 하나다. 세이브에 그 값을 그대로 넣으면 불러오기 뒤에도
   난수열이 이어진다 — 호출 횟수를 세어 되감을 필요가 없다.
   ══════════════════════════════════════════════════════════════ */

/** mulberry32 한 걸음. [0,1) 값과 다음 상태를 돌려준다. */
function step(s) {
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

let gState = 1, vState = 0x9E3779B9;

/** 게임 결과에 영향을 주는 난수 */
function rand() { const [v, s] = step(gState); gState = s; return v; }

/** 연출용 난수. 세이브와 무관하므로 게임 판정에 쓰면 안 된다. */
function viewRand() { const [v, s] = step(vState); vState = s; return v; }

/** 새 게임을 시작할 때 한 번 부른다. */
function setSeed(n) { gState = (n >>> 0) || 1; }

function rngState() { return gState; }

/** 세이브를 불러올 때 난수열을 이어 붙인다. */
function setRngState(n) { gState = (n >>> 0) || 1; }

/* 시드를 안 주면 여기서 뽑는다. 뽑은 값은 세이브에 남아 나중에 재현할 수 있다.
   재현이 목적이면 `game.setSeed(n)` 뒤에 새 게임을 시작하면 된다. */
function randomSeed() {
  const t = typeof performance === 'object' && performance.now ? performance.now() : 0;
  return ((Date.now() ^ Math.floor(t * 1000) ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0) || 1;
}

export { rand, randomSeed, rngState, setRngState, setSeed, viewRand };
