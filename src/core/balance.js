/* ── 밸런스 상수 (튜닝은 전부 여기서) ─────────────────────── */
const BAL = {
  startCash: 5_000_000,
  /* 도시 블록 격자. 타일 수 = cityBlocks × blockPitch.
     블록은 2×2 타일이고 나머지가 도로다. pitch 를 3 → 4 로 넓혀 블록 사이 도로가
     한 줄에서 두 줄이 됐다 — 건물이 다닥다닥 붙어 보이던 문제를 여기서 푼다.
     블록 수는 8×8. 회사는 44 라 빈 블록이 20칸(31%) 남아 도시가 숨을 쉰다.
     맵을 키우거나 줄일 땐 GRAPHICS.md 의 세로 예산을 먼저 볼 것. */
  cityBlocks: 8,             // 8×8 = 64칸
  blockPitch: 4,             // 블록 한 칸이 차지하는 타일 수 (블록 2 + 도로 2)
  npcCount: 44,              // 회사 44 + 자사 1 = 45칸. 남는 19칸은 렌더가 지형으로 채운다
  dayMs: 15000,              // 1일 실시간 길이 (배속 1x 기준). 15초 = 하루
  speeds: [0, 1, 2, 4, 8],   // HUD 배속 버튼. 1일 15초라 고배속이 없으면 완주가 너무 길다
  monthDays: 30,
  negMonthsToBust: 4,        // 자본 마이너스가 이만큼 이어지면 파산

  retailBase: 900_000,       // 구멍가게 기본 일매출
  tierRetailMul: [1, 3.2, 6, 14, 40, 120, 300],
  subYield: 0.068,           // 계열사 시총 → 일매출 환산 계수 (회수기간 ≈ 26일)
  marketingDecay: 0.965,     // 마케팅 인지도 일일 감쇠
  marketingCap: 2.6,         // 인지도 매출 배수 상한
  pmiDays: 40,               // 인수 후 통합 기간 — 이 기간 계열사 수익이 서서히 올라온다
  pmiFloor: 0.12,            // 통합 첫날 수익 비율
  synLerp: 0.045,            // 운영 효율이 목표치로 수렴하는 속도
  synMin: 0.55, synMax: 1.6, // 운영 효율 하한/상한
  subsPerManager: 3,         // 관리 인력 1명이 감당하는 계열사 수
  auditGain: 0.08,           // 사업부 점검 1회 효과
  auditCap: 0.24,            // 점검 버프 상한
  auditDecay: 0.985,         // 점검 버프 일일 감쇠

   /* ── 계열사 개별 운영 ──────────────────────────────────
      매각가에 15% 손실을 둔 이유는 사고팔기 반복이 이득이 되면 안 되기 때문이다.
      부실 매물을 투자로 정상화해 되팔 때만 흑자가 나야 한다 — sim 으로 검증할 것. */
  subSellRate: 0.85,         // 매각가 = 시총 × 이 값
  subSellPmiCut: 0.60,       // 통합 전 매각 시 추가 할인
  subInvestRate: 0.25,       // 투자 비용 = 시총 × 이 값
  subInvestGain: 0.12,       // 투자 1회당 시총 상승
  subRestructRate: 0.40,     // 재편 비용 = 시총 × 이 값
  subRestructDays: 45,       // 재편 기간. pmiDays(40)보다 길게 — 업종 집중을 즉시 사지 못하게
  hiddenDebtRate: 0.18,      // 우발채무 = 시총 × 이 값 (보유 자금 45% 상한)

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

  negoProgressPerDay: 6.8,   // 협상 진행도 /일 (약 24일 소요)
  negoSuccessBase: 1.1,      // 성공도 기본 증가량
  premiumBase: 0.35,         // 인수가 프리미엄 기본값

  /* ── 협상 중 능동 개입 ────────────────────────────────────
     협상 1건당 3회. **이 제한이 시스템의 전부다** — 무제한이면 접대비를 자금
     한도까지 붓는 게 항상 정답이 되고, 제한이 있으면 "지금 쓸까 아낄까"가
     매번 판단이 된다. 늘리기 전에 반드시 sim --acts 로 완주일을 볼 것. */
  negoActs: 3,
  negoWineCost: 0.008,       // 접대비 = 자사 시총 × 이 값 (보유 자금 20% 상한)
  negoWineSuccess: 12,
  negoWineProbe: 3,          // 수사 압박을 **일당이 아니라 행위당** 올리는 첫 축
  negoPushProgress: 30,      // 시한 제시 — 진행도 즉시 상승
  negoPushSuccess: -8,
  negoAuditCost: 0.004,      // 실사
  negoAuditBack: 10,         // 실사에 드는 진행도
  negoQuitFee: 0.03,         // 협상 중단 위약금 = 예상 인수가 × 이 값

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
