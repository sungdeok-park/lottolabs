import type { Combo, FilterRule, HistoryContext } from "./types";
import * as m from "./metrics";

export type FilterGroup = "기본 분석" | "번호 특성" | "분포" | "과거 이력";

export interface FilterDef {
  key: string;
  label: string;
  group: FilterGroup;
  description: string;
  /** 값의 가능한 범위(UI 입력 경계) */
  domain: [number, number];
  needsHistory?: boolean;
  compute: (c: Combo, h?: HistoryContext) => number;
}

const lastDraw = (h?: HistoryContext) => h?.draws[h.draws.length - 1];

/** 이월수: 직전 회차 본번호와 겹치는 번호 수 */
const carryover = (c: Combo, h?: HistoryContext) => {
  const d = lastDraw(h);
  return d ? c.filter((n) => d.numbers.includes(n)).length : 0;
};

/** 이웃수: 직전 회차 본번호의 ±1 번호(직전 번호 자신 제외) 중 포함된 개수 */
const neighbor = (c: Combo, h?: HistoryContext) => {
  const d = lastDraw(h);
  if (!d) return 0;
  const set = new Set<number>();
  for (const n of d.numbers) {
    for (const x of [n - 1, n + 1]) if (x >= 1 && x <= m.MAX_NUM && !d.numbers.includes(x)) set.add(x);
  }
  return c.filter((n) => set.has(n)).length;
};

/** 최근 N회(본번호) 중 한 번이라도 나온 번호의 개수 */
const appearedIn = (n: number) => (c: Combo, h?: HistoryContext) => {
  if (!h) return 0;
  const seen = new Set<number>();
  for (const d of h.draws.slice(-n)) for (const x of d.numbers) seen.add(x);
  return c.filter((x) => seen.has(x)).length;
};

export const FILTERS: FilterDef[] = [
  { key: "sum", label: "총합", group: "기본 분석", description: "여섯 수의 합 (21~255)", domain: [21, 255], compute: m.sum },
  { key: "endSum", label: "끝수합", group: "기본 분석", description: "각 수의 일의 자리 합", domain: [0, 54], compute: m.endDigitSum },
  { key: "ac", label: "AC", group: "기본 분석", description: "두 수 차이의 서로 다른 값 수 − 5 (0~10)", domain: [0, 10], compute: m.acValue },
  { key: "odd", label: "홀수 개수", group: "기본 분석", description: "홀수의 개수 (짝수는 6−홀수)", domain: [0, 6], compute: m.oddCount },
  { key: "high", label: "고번호 개수", group: "기본 분석", description: "23 이상 번호의 개수 (1~22는 저번호)", domain: [0, 6], compute: m.highCount },
  { key: "consecPairs", label: "연속쌍", group: "기본 분석", description: "차가 1인 이웃 쌍의 개수 (7,8,9 → 2쌍)", domain: [0, 5], compute: m.consecutivePairs },
  { key: "longestRun", label: "연번 길이", group: "기본 분석", description: "가장 긴 연속 묶음 길이 (없으면 1)", domain: [1, 6], compute: m.longestRun },
  { key: "prime", label: "소수 개수", group: "번호 특성", description: "소수의 개수", domain: [0, 6], compute: m.primeCount },
  { key: "composite", label: "합성수 개수", group: "번호 특성", description: "합성수의 개수 (1은 제외)", domain: [0, 6], compute: m.compositeCount },
  { key: "square", label: "제곱수 개수", group: "번호 특성", description: "1,4,9,16,25,36", domain: [0, 6], compute: m.squareCount },
  { key: "triangular", label: "삼각수 개수", group: "번호 특성", description: "1,3,6,10,15,21,28,36,45", domain: [0, 6], compute: m.triangularCount },
  { key: "mul3", label: "3의 배수 개수", group: "번호 특성", description: "3의 배수의 개수", domain: [0, 6], compute: m.multipleOf3Count },
  { key: "mul5", label: "5의 배수 개수", group: "번호 특성", description: "5의 배수의 개수", domain: [0, 6], compute: m.multipleOf5Count },
  { key: "endDigits", label: "끝수 종류", group: "분포", description: "서로 다른 일의 자리 숫자의 개수", domain: [1, 6], compute: m.distinctEndDigits },
  { key: "bands", label: "사용 번호대", group: "분포", description: "1~10,11~20,21~30,31~40,41~45 중 번호가 있는 구간 수", domain: [2, 5], compute: m.bandsUsed },
  { key: "carry", label: "이월수", group: "과거 이력", description: "직전 회차 본번호와 겹치는 개수", domain: [0, 6], needsHistory: true, compute: carryover },
  { key: "neighbor", label: "이웃수", group: "과거 이력", description: "직전 회차 번호의 ±1 번호 포함 개수", domain: [0, 6], needsHistory: true, compute: neighbor },
  ...[5, 10, 15, 20].map<FilterDef>((n) => ({
    key: `recent${n}`,
    label: `최근 ${n}회 출현수`,
    group: "과거 이력",
    description: `최근 ${n}회 본번호에 한 번이라도 나온 번호의 개수`,
    domain: [0, 6],
    needsHistory: true,
    compute: appearedIn(n),
  })),
];

export const FILTER_BY_KEY = new Map(FILTERS.map((f) => [f.key, f]));

export function ruleAccepts(rule: FilterRule, value: number): boolean {
  if (rule.values && rule.values.length > 0 && !rule.values.includes(value)) return false;
  if (rule.min !== undefined && value < rule.min) return false;
  if (rule.max !== undefined && value > rule.max) return false;
  return true;
}

export function evaluateRules(c: Combo, rules: readonly FilterRule[], h?: HistoryContext): FilterRule | null {
  for (const rule of rules) {
    const def = FILTER_BY_KEY.get(rule.key);
    if (!def) continue;
    if (!ruleAccepts(rule, def.compute(c, h))) return rule;
  }
  return null;
}

export function describeRule(rule: FilterRule): string {
  const def = FILTER_BY_KEY.get(rule.key);
  const name = def?.label ?? rule.key;
  const parts: string[] = [];
  if (rule.values && rule.values.length > 0) parts.push(rule.values.join(", "));
  if (rule.min !== undefined || rule.max !== undefined) parts.push(`${rule.min ?? "~"}–${rule.max ?? "~"}`);
  return `${name} ${parts.join(" / ")}`;
}
