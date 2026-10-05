import { ExprError, collectVars, evalExpr, parseExpr } from "./expr";
import type { Combo, Draw, FilterRule, HistoryContext } from "./types";
import * as m from "./metrics";

export type FilterGroup = "기본 분석" | "번호 특성" | "분포" | "과거 이력" | "내 필터";

export interface FilterDef {
  key: string;
  label: string;
  group: FilterGroup;
  description: string;
  /** 값의 가능한 범위(UI 입력 경계) */
  domain: [number, number];
  needsHistory?: boolean;
  /** 이력 전체를 훑어 느리다 (정확한 열거 시 시간이 더 걸린다) */
  heavy?: boolean;
  compute: (c: Combo, h?: HistoryContext) => number;
}

// ---- 이력 전처리 (HistoryContext 단위로 한 번만 계산) ----
interface Prep {
  last?: Draw;
  lastSet: Set<number>;
  neighborSet: Set<number>;
  /** 최근 n회 본번호 출현 횟수 (1~45 인덱스) */
  freq: (n: number) => number[];
  /** 마지막 출현 이후 지난 회차 수 (직전 회차에 나왔으면 0, 한 번도 없으면 이력 길이) */
  absence: number[];
  pastSets: Set<number>[];
}

const preps = new WeakMap<HistoryContext, Prep>();

function prep(h: HistoryContext): Prep {
  let p = preps.get(h);
  if (p) return p;
  const draws = h.draws;
  const last = draws[draws.length - 1];
  const lastSet = new Set<number>(last?.numbers ?? []);
  const neighborSet = new Set<number>();
  for (const n of last?.numbers ?? []) {
    for (const x of [n - 1, n + 1]) if (x >= 1 && x <= m.MAX_NUM && !lastSet.has(x)) neighborSet.add(x);
  }
  const cache = new Map<number, number[]>();
  const freq = (n: number) => {
    let f = cache.get(n);
    if (!f) {
      f = new Array<number>(m.MAX_NUM + 1).fill(0);
      for (const d of draws.slice(-n)) for (const x of d.numbers) f[x]!++;
      cache.set(n, f);
    }
    return f;
  };
  const absence = new Array<number>(m.MAX_NUM + 1).fill(draws.length);
  draws.forEach((d, i) => d.numbers.forEach((x) => (absence[x] = draws.length - 1 - i)));
  p = { last, lastSet, neighborSet, freq, absence, pastSets: draws.map((d) => new Set(d.numbers)) };
  preps.set(h, p);
  return p;
}

const withHist = (fn: (c: Combo, p: Prep) => number) => (c: Combo, h?: HistoryContext) => (h && h.draws.length ? fn(c, prep(h)) : 0);

const carryover = withHist((c, p) => c.filter((n) => p.lastSet.has(n)).length);
const neighbor = withHist((c, p) => c.filter((n) => p.neighborSet.has(n)).length);
const bonusCarry = withHist((c, p) => (p.last && c.includes(p.last.bonus) ? 1 : 0));
const appearedIn = (n: number) => withHist((c, p) => c.filter((x) => p.freq(n)[x]! > 0).length);
const coldIn = (n: number) => withHist((c, p) => c.filter((x) => p.freq(n)[x]! === 0).length);
const maxAbsence = withHist((c, p) => Math.max(...c.map((x) => p.absence[x]!)));
const sumAbsence = withHist((c, p) => c.reduce((a, x) => a + p.absence[x]!, 0));
/** 역대 본번호 조합과 가장 많이 겹친 개수 (6이면 과거 1등 조합과 동일) */
const pastMaxMatch = withHist((c, p) => {
  let best = 0;
  for (const s of p.pastSets) {
    let k = 0;
    for (const x of c) if (s.has(x)) k++;
    if (k > best) best = k;
  }
  return best;
});

const def = (key: string, label: string, group: FilterGroup, description: string, domain: [number, number], compute: FilterDef["compute"], extra: Partial<FilterDef> = {}): FilterDef => ({ key, label, group, description, domain, compute, ...extra });

const BAND_LABEL = ["", "1~10", "11~20", "21~30", "31~40", "41~45"];

export const FILTERS: FilterDef[] = [
  def("sum", "총합", "기본 분석", "여섯 수의 합 (21~255)", [21, 255], m.sum),
  def("endSum", "끝수합", "기본 분석", "각 수의 일의 자리 합", [2, 52], m.endDigitSum),
  def("ac", "AC", "기본 분석", "두 수 차이의 서로 다른 값 수 − 5 (0~10)", [0, 10], m.acValue),
  def("odd", "홀수 개수", "기본 분석", "홀수의 개수 (짝수는 6−홀수)", [0, 6], m.oddCount),
  def("high", "고번호 개수", "기본 분석", "23 이상 번호의 개수 (1~22는 저번호)", [0, 6], m.highCount),
  def("consecPairs", "연속쌍", "기본 분석", "차가 1인 이웃 쌍의 개수 (7,8,9 → 2쌍)", [0, 5], m.consecutivePairs),
  def("longestRun", "연번 길이", "기본 분석", "가장 긴 연속 묶음 길이 (없으면 1)", [1, 6], m.longestRun),
  def("first", "첫 수", "기본 분석", "가장 작은 번호", [1, 40], m.first),
  def("last", "끝 수", "기본 분석", "가장 큰 번호", [6, 45], m.last),
  def("span", "첫수~끝수 폭", "기본 분석", "가장 큰 수 − 가장 작은 수", [5, 44], m.span),
  def("minGap", "최소 간격", "기본 분석", "이웃한 두 수 사이 간격의 최솟값", [1, 8], m.minGap),
  def("maxGap", "최대 간격", "기본 분석", "이웃한 두 수 사이 간격의 최댓값", [1, 40], m.maxGap),

  def("prime", "소수 개수", "번호 특성", "소수의 개수", [0, 6], m.primeCount),
  def("composite", "합성수 개수", "번호 특성", "합성수의 개수 (1은 제외)", [0, 6], m.compositeCount),
  def("square", "제곱수 개수", "번호 특성", "1,4,9,16,25,36", [0, 6], m.squareCount),
  def("triangular", "삼각수 개수", "번호 특성", "1,3,6,10,15,21,28,36,45", [0, 6], m.triangularCount),
  def("twin", "쌍둥이수 개수", "번호 특성", "11,22,33,44의 개수", [0, 4], m.twinCount),
  ...[3, 4, 5, 6, 7, 8, 9].map((k) => def(`mul${k}`, `${k}의 배수 개수`, "번호 특성", `${k}의 배수(${k}, ${2 * k}, … ${m.multiplesInRange(k) * k})의 개수`, [0, Math.min(6, m.multiplesInRange(k))], m.multipleCount(k))),

  def("endDigits", "끝수 종류", "분포", "서로 다른 일의 자리 숫자의 개수", [2, 6], m.distinctEndDigits),
  def("sameEndPairs", "같은 끝수 쌍", "분포", "일의 자리가 같은 쌍의 개수 (같은 끝수 3개면 3쌍)", [0, 10], m.sameEndPairs),
  ...Array.from({ length: 10 }, (_, d) => def(`end${d}`, `끝수 ${d} 개수`, "분포", `일의 자리가 ${d}인 번호의 개수`, [0, d >= 1 && d <= 5 ? 5 : 4], m.endDigitCount(d))),
  def("bands", "사용 번호대", "분포", "1~10,11~20,21~30,31~40,41~45 중 번호가 있는 구간 수", [1, 5], m.bandsUsed),
  ...[1, 2, 3, 4, 5].map((b) => def(`band${b}`, `${BAND_LABEL[b]}번대 개수`, "분포", `${BAND_LABEL[b]} 구간 번호의 개수`, [0, b === 5 ? 5 : 6], m.bandCount(b))),
  def("ticketRows", "용지 사용 줄 수", "분포", "용지(7칸×7줄: 1~7, 8~14, …, 43~45)에서 번호가 놓인 줄 수", [1, 6], m.ticketRows),
  def("ticketCols", "용지 사용 칸 수", "분포", "용지(7칸×7줄)에서 번호가 놓인 세로 칸(1~7열) 수", [1, 6], m.ticketCols),

  def("carry", "이월수", "과거 이력", "직전 회차 본번호와 겹치는 개수", [0, 6], carryover, { needsHistory: true }),
  def("bonusCarry", "보너스 이월", "과거 이력", "직전 회차 보너스 번호 포함 여부 (0/1)", [0, 1], bonusCarry, { needsHistory: true }),
  def("neighbor", "이웃수", "과거 이력", "직전 회차 번호의 ±1 번호 포함 개수", [0, 6], neighbor, { needsHistory: true }),
  ...[5, 10, 15, 20].map((n) => def(`recent${n}`, `핫 ${n}회 (최근 출현수)`, "과거 이력", `뜨거운수: 최근 ${n}회 본번호에 한 번이라도 나온 번호의 개수`, [0, 6], appearedIn(n), { needsHistory: true })),
  ...[5, 10, 15, 20].map((n) => def(`cold${n}`, `콜드 ${n}회 (최근 미출현수)`, "과거 이력", `차가운수: 최근 ${n}회 동안 한 번도 안 나온 번호의 개수`, [0, 6], coldIn(n), { needsHistory: true })),
  def("maxAbsence", "최장 미출현 회차", "과거 이력", "조합 번호 중 마지막 출현 후 가장 오래 지난 회차 수", [0, 3000], maxAbsence, { needsHistory: true }),
  def("sumAbsence", "미출현 회차 합", "과거 이력", "조합 번호들의 미출현 회차 수의 합", [0, 18000], sumAbsence, { needsHistory: true }),
  def("pastMatch", "역대 최대 일치", "과거 이력", "역대 본번호 조합과 가장 많이 겹친 개수 (6이면 과거 1등 조합과 동일)", [0, 6], pastMaxMatch, { needsHistory: true, heavy: true }),
];

export const FILTER_BY_KEY = new Map(FILTERS.map((f) => [f.key, f]));

// ---- 사용자 정의 필터 (번호 집합 / 표현식) ----
const exprCache = new Map<string, ReturnType<typeof parseExpr>>();

export function checkExpr(src: string): { ok: true } | { ok: false; error: string } {
  try {
    const ast = parseExpr(src);
    const unknown = [...collectVars(ast)].filter((v) => !FILTER_BY_KEY.has(v) && !/^n[1-6]$/.test(v));
    if (unknown.length) return { ok: false, error: `알 수 없는 변수: ${unknown.join(", ")}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ExprError ? e.message : "표현식을 해석할 수 없습니다." };
  }
}

function setDef(rule: FilterRule): FilterDef {
  const set = new Set(rule.set);
  return def(rule.key, rule.label ?? "내 번호 집합", "내 필터", `집합 {${[...set].sort((a, b) => a - b).join(",")}}에 속한 번호의 개수`, [0, Math.min(6, set.size)], (c) => c.filter((n) => set.has(n)).length);
}

function exprDef(rule: FilterRule): FilterDef {
  const src = rule.expr ?? "";
  let ast = exprCache.get(src);
  if (!ast) {
    ast = parseExpr(src);
    exprCache.set(src, ast);
    if (exprCache.size > 200) exprCache.delete(exprCache.keys().next().value!);
  }
  const root = ast;
  const needsHistory = [...collectVars(root)].some((v) => FILTER_BY_KEY.get(v)?.needsHistory);
  return def(rule.key, rule.label ?? "내 표현식", "내 필터", src, [0, 1], (c, h) => evalExpr(root, c, (name) => FILTER_BY_KEY.get(name)?.compute(c, h)), { needsHistory });
}

/** 규칙에 대응하는 필터 정의. 알 수 없거나 잘못된 규칙이면 undefined. */
export function resolveDef(rule: FilterRule): FilterDef | undefined {
  if (rule.set) return setDef(rule);
  if (rule.expr !== undefined) {
    if (!checkExpr(rule.expr).ok) return undefined;
    return exprDef(rule);
  }
  return FILTER_BY_KEY.get(rule.key);
}

export function ruleAccepts(rule: FilterRule, value: number): boolean {
  const values = rule.expr !== undefined && !rule.values?.length ? [1] : rule.values;
  if (values && values.length > 0 && !values.includes(value)) return false;
  if (rule.min !== undefined && value < rule.min) return false;
  if (rule.max !== undefined && value > rule.max) return false;
  return true;
}

export interface CompiledRule {
  rule: FilterRule;
  def: FilterDef;
}

export function compileRules(rules: readonly FilterRule[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const rule of rules) {
    const d = resolveDef(rule);
    if (d) out.push({ rule, def: d });
  }
  return out;
}

export function evaluateRules(c: Combo, rules: readonly FilterRule[], h?: HistoryContext): FilterRule | null {
  return evaluateCompiled(c, compileRules(rules), h);
}

export function evaluateCompiled(c: Combo, compiled: readonly CompiledRule[], h?: HistoryContext): FilterRule | null {
  for (const { rule, def: d } of compiled) if (!ruleAccepts(rule, d.compute(c, h))) return rule;
  return null;
}

export function describeRule(rule: FilterRule): string {
  const d = resolveDef(rule);
  const name = rule.label ?? d?.label ?? rule.key;
  if (rule.expr !== undefined) return `${name}: ${rule.expr}`;
  const parts: string[] = [];
  if (rule.values && rule.values.length > 0) parts.push(rule.values.join(", "));
  if (rule.min !== undefined || rule.max !== undefined) parts.push(`${rule.min ?? "~"}–${rule.max ?? "~"}`);
  return `${name} ${parts.join(" / ")}`;
}
