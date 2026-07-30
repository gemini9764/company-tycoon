# 컴퍼니 타이쿤 (프로토타입)

구멍가게에서 시작해 M&A로 계열사를 늘려 글로벌 그룹까지 올라가는 경영 시뮬레이션.
서버 없이 브라우저에서만 돌아가고, 저장 데이터는 로컬에 둔다.

## 실행

**터미널 없이 쓰는 법 — 파일을 더블클릭한다.** Node.js만 설치돼 있으면 되고,
`npm install` 은 필요 없다.

| 파일 | 하는 일 |
|---|---|
| `개발서버-실행` | 개발 서버를 띄우고 브라우저를 연다. 코드를 고치고 새로고침하면 바로 반영 |
| `배포본-만들기` | `src/` 를 묶어 `dist/company-tycoon.html` 생성 후 폴더를 연다 |

macOS·리눅스는 `.command`, 윈도우는 `.bat` 을 쓴다.
macOS에서 "확인되지 않은 개발자" 경고가 뜨면 파일을 우클릭 → 열기로 한 번만 허용하면 된다.

> **`.bat` 을 수정할 때 주의.** 배치 파일 본문에는 한글을 넣지 말 것.
> cmd.exe 는 배치 파일을 실행하면서 다시 읽는데, 중간에 코드페이지가 바뀌면
> 남은 줄의 파싱이 어긋난다(`echo` 가 `cho` 로 잘리는 식). 그래서 `.bat` 은
> ASCII 로만 두고 한글 출력은 전부 `tools/launch.mjs` 가 맡는다.

`dist/company-tycoon.html` 이 배포물이다. 의존성이 없어 그대로 더블클릭해 실행되고,
메신저로 던져줘도 상대가 바로 연다.

터미널을 쓴다면:

```bash
npm run dev        # http://localhost:5173
npm run build      # dist/company-tycoon.html
npm run smoke      # UI 상호작용 자동 검증 (jsdom 필요 → npm install)
npm run sim        # 밸런스 시뮬레이션 (jsdom 필요)
```

`npm install` 은 **테스트 도구(jsdom)에만** 필요하다. 개발과 빌드는 node 만으로 돈다.

개발 중에는 반드시 개발 서버를 쓴다. ES 모듈은 `file://` 에서 CORS로 차단되므로
`index.html` 을 브라우저로 직접 열면 동작하지 않는다.

## 구조

```
src/
├─ main.js              부팅과 인트로. 엔트리
├─ debug.js             window.game QA 핸들 (게임 로직은 여기 의존하지 않음)
├─ core/                도메인 기반. UI·렌더를 모른다
│  ├─ balance.js        BAL — 밸런스 상수 전부
│  ├─ data.js           등급·업종·난이도·무당·찌라시 테이블
│  ├─ derive.js         상태에서 값을 뽑는 순수 함수 (부채, 순자산, 팀 합계)
│  ├─ state.js          S — 단일 상태. 생성과 교체(setS)
│  ├─ storage.js        저장 어댑터 (window.storage → localStorage → 메모리)
│  ├─ clock.js          배속과 일시정지
│  ├─ loop.js           하루 진행(tickDay)과 렌더 프레임(frameLoop)
│  └─ util.js           포맷·난수·DOM 헬퍼
├─ systems/             상태를 바꾸는 규칙. 렌더를 직접 건드리지 않는다
│  ├─ company.js        시총·순위·신용등급·등급 승급
│  ├─ economy.js        매출/비용, 월 정산, 통합 진척(PMI), 그룹 운영 효율
│  ├─ mna.js            협상 시작·진행·이벤트·성사·인수 완료
│  ├─ bank.js           대출·상환·담보 압류·파산
│  ├─ stock.js          주가와 매매
│  ├─ shaman.js         살굿·축원굿과 발각
│  ├─ rumor.js          찌라시 획득과 사용
│  ├─ events.js         국가·국세청·경쟁사·무속 이벤트
│  └─ ending.js         엔딩 판정
├─ render/              캔버스 픽셀 렌더. 외부 에셋 없음
│  ├─ canvas.js         캔버스 셋업, 화면 맞춤, 입력 판정, 툴팁
│  ├─ city.js           도시 맵 (M&A 모드)
│  └─ store.js          매장 내부 (경영 모드)
├─ ui/                  DOM 패널. 상태를 읽기만 하고 조작은 systems 호출
│  ├─ hud.js            상단 지표와 배속
│  ├─ panelLeft.js      회사 현황·진행 중 M&A·그룹 운영
│  ├─ tabs.js           우측 탭 (직원/주식/무당/찌라시/알림)
│  ├─ bankPanel.js      은행 탭과 인수금융 창
│  ├─ companyPopup.js   맵에서 회사 클릭 시 뜨는 상세
│  ├─ modal.js          모달 스택
│  ├─ toast.js          토스트·뉴스·알림함
│  ├─ help.js           도움말 본문
│  └─ index.js          전체 리렌더
└─ styles/main.css      디자인 토큰과 레이아웃

tools/
├─ bundle.mjs           무의존 ES 모듈 번들러
├─ build.mjs            단일 HTML 빌드 (bundle.mjs + CSS 인라인)
├─ launch.mjs           실행기 본체 — 한글 출력·브라우저 열기 (.bat/.command 가 호출)
├─ serve.mjs            개발용 정적 서버 (무의존)
├─ harness.mjs          jsdom 테스트 공통 셋업
├─ smoke.mjs            UI 상호작용 검증
└─ sim.mjs              밸런스 시뮬레이션
```

의존 방향은 `core → systems → ui/render → main` 한 방향이다.
`systems`가 모달을 띄워야 할 때만 `ui/modal.js`를 부르는데, 함수 선언은 호이스팅되므로
순환이 생겨도 런타임에 문제가 없다.

### 번들러가 요구하는 것

`tools/bundle.mjs` 는 모듈을 **한 스코프로 이어 붙인다**. 그래서 최상위 이름이 전부
고유해야 한다. 원본이 단일 파일이었던 덕에 지금은 고유하고, 겹치면 빌드가 멈추면서
어느 파일끼리 부딪혔는지 알려준다. 새 파일을 추가할 때 이 제약을 기억할 것.

`import * as ns` 로 받는 이름도 같은 규칙을 탄다. `src/debug.js` 가 `toastMod` 처럼
`Mod` 접미사를 쓰는 이유다.

## 밸런스 조정

수치는 전부 `src/core/balance.js`의 `BAL` 한 곳에 있다. 등급 목표는
`src/core/data.js`의 `TIERS`, 인수 규모 상한은 `systems/company.js`의 `capCeiling`.

조정한 뒤에는 `npm run sim`으로 등급 구간 길이와 엔딩 분포를 확인한다.
현재 기준선은 다음과 같다.

| 전략 | 소요 | 결과 |
|---|---|---|
| 무차입 | 1,640~1,700일 | 정상 엔딩 |
| 중간 레버리지 | 1,380~1,400일 | 정상 엔딩 |
| 극단 차입 + 로비 | 1,200~1,340일 | 수사 엔딩 위험 |
| 무속 의존 | 670~720일 | 무속 스캔들 |

## 저장

`core/storage.js`가 `window.storage` → `localStorage` → 메모리 순으로 폴백한다.
60일마다 자동 저장하고, 재접속하면 이어서 하기를 묻는다.
세이브 포맷을 바꾸면 `newState`의 `v`를 올린다 — 구버전 세이브는 폐기된다.

## 조작

- 마우스 — 맵의 건물 클릭, 내 건물(금빛) 클릭 시 경영 모드
- `Space` 일시정지 / `Tab` 모드 전환 / `Esc` 창 닫기
- 브라우저 콘솔에서 `game`으로 내부 상태 접근 (`game.S`, `game.tickDay()`)
