/* ── 밸런스 상수 (튜닝은 전부 여기서) ─────────────────────── */
const BAL = {
  startCash: 5_000_000,
  dayMs: 1000,               // 1일 실시간 길이 (배속 1x 기준)
  monthDays: 30,
  negMonthsToBust: 4,        // 자본 마이너스가 이만큼 이어지면 파산

  retailBase: 900_000,       // 구멍가게 기본 일매출
  tierRetailMul: [1, 3.2, 6, 14, 40, 120, 300],
  subYield: 0.029,           // 계열사 시총 → 일매출 환산 계수 (회수기간 ≈ 40일)
  marketingDecay: 0.965,     // 마케팅 인지도 일일 감쇠
  marketingCap: 2.6,         // 인지도 매출 배수 상한
  pmiDays: 75,               // 인수 후 통합 기간 — 이 기간 계열사 수익이 서서히 올라온다
  pmiFloor: 0.12,            // 통합 첫날 수익 비율
  synLerp: 0.045,            // 운영 효율이 목표치로 수렴하는 속도
  synMin: 0.55, synMax: 1.6, // 운영 효율 하한/상한
  subsPerManager: 3,         // 관리 인력 1명이 감당하는 계열사 수
  auditGain: 0.08,           // 사업부 점검 1회 효과
  auditCap: 0.24,            // 점검 버프 상한
  auditDecay: 0.985,         // 점검 버프 일일 감쇠

  negoProgressPerDay: 3.2,   // 협상 진행도 /일 (약 31일 소요)
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

  eventChancePerDay: 0.055,
  rumorChanceBase: 0.0018,   // 정보력 1당 일일 찌라시 획득 확률
};

export { BAL };
