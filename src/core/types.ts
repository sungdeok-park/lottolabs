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
}

/** 허용 값 집합(values) 또는 연속 범위(min/max). 둘 다 있으면 둘 다 만족해야 한다. */
export interface FilterRule {
  key: string;
  values?: number[];
  min?: number;
  max?: number;
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
