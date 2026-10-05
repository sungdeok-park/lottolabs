import { forEachCombo, type EnumControl } from "./enumerate";
import { compileRules, evaluateCompiled, resolveDef } from "./filters";
import { MAX_NUM } from "./metrics";
import type { Combo, Draw, FilterRule, HistoryContext } from "./types";

export interface NumberStat {
  number: number;
  /** 구간 내 본번호 출현 횟수 */
  count: number;
  /** 마지막 출현 후 지난 회차 수 (직전 회차에 나왔으면 0, 없으면 구간 길이) */
  absence: number;
}

/** 번호별 출현 횟수와 미출현 기간. window를 주면 최근 N회만, includeBonus면 보너스도 센다. */
export function numberStats(draws: readonly Draw[], opts: { window?: number; includeBonus?: boolean } = {}): NumberStat[] {
  const ds = opts.window ? draws.slice(-opts.window) : draws;
  const stats: NumberStat[] = Array.from({ length: MAX_NUM }, (_, i) => ({ number: i + 1, count: 0, absence: ds.length }));
  ds.forEach((d, i) => {
    const nums = opts.includeBonus ? [...d.numbers, d.bonus] : d.numbers;
    for (const n of nums) {
      const s = stats[n - 1]!;
      s.count++;
      s.absence = ds.length - 1 - i;
    }
  });
  return stats;
}

/** 출현 횟수 내림차순(동률은 번호 오름차순) */
export const rankByFrequency = (s: NumberStat[]) => [...s].sort((a, b) => b.count - a.count || a.number - b.number);

/** 각 회차를 그 회차 이전 이력만으로 평가한 값 목록 (미래 데이터 혼입 없음) */
export function metricSeries(rule: FilterRule, draws: readonly Draw[]): { round: number; value: number }[] {
  const def = resolveDef(rule);
  if (!def) return [];
  return draws.map((d, i) => ({ round: d.round, value: def.compute(d.numbers, { draws: draws.slice(0, i) }) }));
}

export function valueDistribution(series: { value: number }[]): { value: number; count: number; ratio: number }[] {
  const m = new Map<number, number>();
  for (const s of series) m.set(s.value, (m.get(s.value) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count, ratio: count / series.length }));
}

export interface BacktestResult {
  tested: number;
  passed: number;
  passedRounds: number[];
  /** 이력이 필요한 규칙 때문에 첫 회차를 제외한 경우 */
  skipped: number;
  /** 필터별 단독 통과 회차 수 */
  independent: Record<string, number>;
}

/** 현재 필터 묶음이 과거 각 회차의 당첨 번호를 통과시켰을지 확인한다. 구매 조합의 당첨률이 아니다. */
export function backtest(rules: readonly FilterRule[], draws: readonly Draw[]): BacktestResult {
  const compiled = compileRules(rules);
  const needsHist = compiled.some((c) => c.def.needsHistory);
  const res: BacktestResult = { tested: 0, passed: 0, passedRounds: [], skipped: 0, independent: Object.fromEntries(compiled.map((c) => [c.rule.key, 0])) };
  draws.forEach((d, i) => {
    if (needsHist && i === 0) {
      res.skipped++;
      return;
    }
    const h: HistoryContext = { draws: draws.slice(0, i) };
    res.tested++;
    if (evaluateCompiled(d.numbers, compiled, h) === null) {
      res.passed++;
      res.passedRounds.push(d.round);
    }
    for (const c of compiled) if (evaluateCompiled(d.numbers, [c], h) === null) res.independent[c.rule.key]!++;
  });
  return res;
}

export interface SpaceDistribution {
  total: number;
  /** 값별 조합 수 */
  counts: { value: number; count: number; ratio: number }[];
  cancelled: boolean;
}

/** 후보 공간 전체를 열거해 지표 하나의 값 분포를 구한다. (필터가 걸리지 않은 순수 분포) */
export async function spaceDistribution(
  rule: FilterRule,
  o: { fixed: number[]; exclude: number[]; candidates: number[]; history?: HistoryContext },
  control: EnumControl = {},
): Promise<SpaceDistribution> {
  const def = resolveDef(rule);
  const map = new Map<number, number>();
  let total = 0;
  if (!def) return { total, counts: [], cancelled: false };
  const done = await forEachCombo(o, (c) => {
    total++;
    const v = def.compute(c, o.history);
    map.set(v, (map.get(v) ?? 0) + 1);
  }, control);
  const counts = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count, ratio: total ? count / total : 0 }));
  return { total, counts, cancelled: !done };
}

// ---- 조합 묶음 분석 ----
export interface OverlapReport {
  /** 번호별 사용 횟수 (1~45) */
  usage: number[];
  /** 가장 많이 쓰인 번호 */
  topNumber: { number: number; count: number } | null;
  /** 조합 쌍 사이 겹친 번호 수의 최댓값/평균 */
  maxOverlap: number;
  avgOverlap: number;
  /** 겹친 번호 수별 쌍의 개수 (0~5) */
  pairHistogram: number[];
  /** 서로 다른 번호의 총 개수 */
  distinctNumbers: number;
}

export function overlapReport(combos: readonly Combo[]): OverlapReport {
  const usage = new Array<number>(MAX_NUM + 1).fill(0);
  for (const c of combos) for (const n of c) usage[n]!++;
  const sets = combos.map((c) => new Set(c));
  const hist = new Array<number>(6).fill(0);
  let max = 0, sum = 0, pairs = 0;
  for (let i = 0; i < combos.length; i++) {
    for (let j = i + 1; j < combos.length; j++) {
      let k = 0;
      for (const n of combos[j]!) if (sets[i]!.has(n)) k++;
      hist[Math.min(k, 5)]!++;
      if (k > max) max = k;
      sum += k;
      pairs++;
    }
  }
  let top: OverlapReport["topNumber"] = null;
  for (let n = 1; n <= MAX_NUM; n++) if (usage[n]! > (top?.count ?? 0)) top = { number: n, count: usage[n]! };
  return { usage: usage.slice(1), topNumber: top, maxOverlap: max, avgOverlap: pairs ? sum / pairs : 0, pairHistogram: hist, distinctNumbers: usage.filter((x) => x > 0).length };
}

/** 한 묶음이 특정 회차 결과 하나에 대해 거둔 등수 분포 */
export function rankDistribution(combos: readonly Combo[], draw: Draw, rankOf: (c: Combo, d: Draw) => number | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of combos) {
    const r = rankOf(c, draw);
    const k = r ? `${r}등` : "낙첨";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** 회귀 N에서 회차별 값: 그 회차 본번호 ∩ N회 전 본번호의 개수 */
export function regressionSeries(draws: readonly Draw[], step: number): { round: number; sourceRound: number; hits: number }[] {
  const byRound = new Map(draws.map((d) => [d.round, d]));
  const out: { round: number; sourceRound: number; hits: number }[] = [];
  for (const d of draws) {
    const src = byRound.get(d.round - step);
    if (!src) continue;
    out.push({ round: d.round, sourceRound: src.round, hits: d.numbers.filter((n) => src.numbers.includes(n)).length });
  }
  return out;
}

/**
 * 원본 "최근 10회차 필터 적용": 목표 회차에서 step씩 거슬러 올라가며(T−step, T−2·step, …)
 * 각 회차와 그 step 전 회차의 겹침 개수를 count개 모은 뒤 최솟값·최댓값을 돌려준다.
 */
export function regressionRecentRange(draws: readonly Draw[], targetRound: number, step: number, count = 10): { min: number; max: number; samples: number } | null {
  const byRound = new Map(draws.map((d) => [d.round, d]));
  const values: number[] = [];
  for (let curr = targetRound - step; curr > 0 && values.length < count; curr -= step) {
    const cur = byRound.get(curr);
    const prev = byRound.get(curr - step);
    if (cur && prev) values.push(cur.numbers.filter((n) => prev.numbers.includes(n)).length);
  }
  return values.length ? { min: Math.min(...values), max: Math.max(...values), samples: values.length } : null;
}
