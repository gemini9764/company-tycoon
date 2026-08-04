/* ── 밸런스 상수 (튜닝은 전부 여기서) ─────────────────────── */
const BAL = {
  startCash: 5_000_000,
  /* 도시 블록 격자. 타일 수 = cityBlocks × 3.
     타일을 48×24 로 키우고 배율을 PX=1 로 내리면서(GRAPHICS.md 2단계) 같은 캔버스에
     담기는 월드 픽셀이 4배가 됐다. 그 예산으로 블록을 7×7 → 10×10 으로 넓혔다.
     여기를 더 키우려면 월드 높이부터 다시 계산할 것 — 1080p 캔버스가 약 865px 이다. */
  cityBlocks: 10,            // 10×10 = 100칸
  npcCount: 80,              // 회사 80 + 자사 1 = 81칸. 남는 19칸은 렌더가 지형으로 채운다
  dayMs: 15000,              // 1일 실시간 길이 (배속 1x 기준). 15초 = 하루
  speeds: [0, 1, 2, 4, 8],   // HUD 배속 버튼. 1일 15초라 고배속이 없으면 완주가 너무 길다
  monthDays: 30,
  negMonthsToBust: 4,        // 자본 마이너스가 이만큼 이어지면 파산

  retailBase: 900_000,       // 구멍가게 기본 일매출
  tierRetailMul: [1, 3.2, 6, 14, 40, 120, 300],
  subYield: 0.046,           // 계열사 시총 → 일매출 환산 계수 (회수기간 ≈ 26일)
  marketingDecay: 0.965,     // 마케팅 인지도 일일 감쇠
  marketingCap: 2.6,         // 인지도 매출 배수 상한
  pmiDays: 55,               // 인수 후 통합 기간 — 이 기간 계열사 수익이 서서히 올라온다
  pmiFloor: 0.12,            // 통합 첫날 수익 비율
  synLerp: 0.045,            // 운영 효율이 목표치로 수렴하는 속도
  synMin: 0.55, synMax: 1.6, // 운영 효율 하한/상한
  subsPerManager: 3,         // 관리 인력 1명이 감당하는 계열사 수
  auditGain: 0.08,           // 사업부 점검 1회 효과
  auditCap: 0.24,            // 점검 버프 상한
  auditDecay: 0.985,         // 점검 버프 일일 감쇠

  /* 재고 — 매장에 들를 이유를 만드는 장치.
     retailUpkeep 을 0.42 → 0.20 으로 낮추고 그만큼을 발주 비용으로 옮겼다.
     제때 발주하면 마진은 이전과 거의 같고, 방치하면 매출이 invFloor 까지 떨어진다. */
  retailUpkeep: 0.20,        // 매장 운영비 = 일매출 × 이 값 (나머지는 발주로 나감)
  invDays: 14,             // 만재에서 바닥까지 걸리는 일수 (냉장 설비로 늘어남)
  invFloor: 0.35,          // 재고 0일 때 남는 매출 비율
  invUnit: 0.031,          // 재고 1%당 발주 단가 = 잠재매출 × 이 값
  invBulkOff: 0.08,        // 절반 이상 한 번에 채울 때 할인
  invAutoUp: 0.12,         // 자동 발주 단가 할증
  invWarnAt: 25,           // 이 아래로 떨어지면 알림

  negoProgressPerDay: 4.2,   // 협상 진행도 /일 (약 24일 소요)
  negoSuccessBase: 1.1,      // 성공도 기본 증가량
  premiumBase: 0.35,         // 인수가 프리미엄 기본값

  baseRate: 3.5,             // 기준금리 %
  rankTop: 4.5e13,           // 시총 1위 기업 규모 (순위 곡선 기준점)
  rankFloor: 1e8,            // 5,000위 기업 규모
  rankCurve: 2.4,            // 순위 곡선 볼록도 — 100위 ≈ 3.5조, 1위 ≈ rankTop
  loanTermMonths: 15,
  opLoanRatio: 0.14,         // 운영자금 한도 = 시총 × 이 값
  acqLoanRatio: 0.80,        // 인수금융 한도 = 인수가 × 이 값
  insuranceRate: 0.0022,     // 월 보험료 = 시총 × 이 값

  gutMistrust: 8,            // 굿 1회당 미신지수 상승
  mistrustPenaltyAt: 30,     // 이 값 넘으면 협상 성공도 증가율 감소
  probeDeath: 100,           // 수사 게이지 상한 → 그룹 해체
  mistrustDeath: 100,        // 미신지수 상한 → 무속 스캔들

  /* 1일 15초로 늦추면서 이벤트가 체감상 사라졌다. 쿨다운을 줄이고 확률을 올린다.
     기대 간격 ≈ eventCooldown + 1/eventChancePerDay 일 → 4 + 4.5 ≈ 8.5일 (약 2분) */
  eventCooldown: 4,
  eventChancePerDay: 0.22,
  /* 빈도를 3.5배 올렸으므로 건당 비용을 그만큼 낮춰야 시간당 지출이 유지된다.
     이 값을 안 넣었을 때 무차입 전략이 동네슈퍼에서 파산했다(sim 계측). */
  eventCostScale: 0.30,
  rumorChanceBase: 0.0018,   // 정보력 1당 일일 찌라시 획득 확률
};

export { BAL };
