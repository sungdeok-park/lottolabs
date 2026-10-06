export type Combo = readonly number[]; // 오름차순 6개, 1~45

export interface Draw {
  round: number;
  date: string; // YYYY-MM-DD
  numbers: Combo;
  bonus: number;
}

export interface HistoryContext {
  /** 목표 회차 이전 회차만 포함 (미래 데이터 혼입 방지) */
  draws: readonly Draw[];
  /** 조합이 노리는 회차. 없으면 마지막 이력 회차 + 1 로 본다. (회귀 필터가 사용) */
  targetRound?: number;
}

/** 허용 값 집합(values) 또는 연속 범위(min/max). 둘 다 있으면 둘 다 만족해야 한다. */
export interface FilterRule {
  key: string;
  values?: number[];
  min?: number;
  max?: number;
  /** 내 번호 집합 필터: 이 집합에 속한 번호가 조합에 몇 개 있는지를 값으로 사용한다. */
  set?: number[];
  /** 표현식 필터: 참/거짓. values가 없으면 참(1)만 허용한다. */
  expr?: string;
  label?: string;
  /** false면 설정은 남기되 계산에서 제외한다 (기본 true) */
  enabled?: boolean;
  /** 이 규칙을 만든 목표 회차. preserve가 아니면 더 나중 회차에서는 적용하지 않는다. */
  round?: number;
  preserve?: boolean;
  /** 운영자 추천 필터에서 적용한 규칙이면 그 필터의 id */
  source?: string;
}

export interface GenerateOptions {
  count: number;
  fixed: number[];
  exclude: number[];
  /** 비어 있으면 1~45 전체 */
  candidates: number[];
  rules: FilterRule[];
  history?: HistoryContext;
  maxAttempts: number;
  rng?: () => number;
}

export type StopReason = "done" | "attempt-limit" | "cancelled";

export interface GenerateResult {
  combos: Combo[];
  attempts: number;
  reason: StopReason;
  /** 필터별로 해당 규칙 때문에 처음 탈락한 시도 수 (적용 순서 기준) */
  rejectedByRule: Record<string, number>;
}
