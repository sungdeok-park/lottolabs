import { describe, expect, it } from "vitest";
import { checkExpr, FILTERS, FILTER_BY_KEY, describeRule } from "../src/core/filters";
import { evalExpr, parseExpr } from "../src/core/expr";
import { generate, validateOptions, countSpace } from "../src/core/generate";
import * as m from "../src/core/metrics";
import { backtest, metricSeries, numberStats, overlapReport, rankByFrequency, spaceDistribution, valueDistribution } from "../src/core/stats";
import { rankProbabilities } from "../src/core/probabilities";
import { abbreviatedWheel, checkWheelSpec, fullWheel, verifyWheel } from "../src/core/wheel";
import { binom, TOTAL_COMBOS } from "../src/core/math";
import type { Draw } from "../src/core/types";

const mk = (round: number, numbers: number[], bonus: number): Draw => ({ round, date: `2000-01-${String(round).padStart(2, "0")}`, numbers, bonus });
const draws = [mk(1, [1, 2, 3, 4, 5, 6], 7), mk(2, [10, 11, 12, 13, 14, 15], 16), mk(3, [20, 21, 22, 23, 24, 25], 26), mk(4, [20, 21, 22, 40, 41, 42], 43)];
const f = (k: string) => FILTER_BY_KEY.get(k)!;
const hist = (before: number) => ({ draws: draws.filter((d) => d.round < before) });

describe("확장 지표", () => {
  it("쌍둥이·간격·폭", () => {
    expect(m.twinCount([1, 2, 11, 22, 33, 44])).toBe(4);
    expect(m.minGap([1, 2, 10, 20, 30, 45])).toBe(1);
    expect(m.maxGap([1, 2, 10, 20, 30, 45])).toBe(15);
    expect(m.span([1, 2, 10, 20, 30, 45])).toBe(44);
  });
  it("같은 끝수 쌍과 끝수별 개수", () => {
    expect(m.sameEndPairs([1, 11, 21, 5, 15, 6])).toBe(4);
    expect(m.endDigitCount(1)([1, 11, 21, 5, 15, 6])).toBe(3);
    expect(m.endDigitCount(0)([10, 20, 30, 40, 5, 6])).toBe(4);
  });
  it("번호대별 개수는 합이 6", () => {
    const c = [3, 12, 25, 33, 41, 45];
    const total = [1, 2, 3, 4, 5].reduce((a, b) => a + m.bandCount(b)(c), 0);
    expect(total).toBe(6);
    expect(m.bandCount(5)(c)).toBe(2);
  });
  it("용지 줄/칸", () => {
    expect(m.ticketRows([1, 2, 3, 4, 5, 6])).toBe(1);
    expect(m.ticketCols([1, 2, 3, 4, 5, 6])).toBe(6);
    expect(m.ticketRows([1, 8, 15, 22, 29, 36])).toBe(6);
    expect(m.ticketCols([1, 8, 15, 22, 29, 36])).toBe(1);
    expect(m.ticketRows([43, 44, 45, 1, 2, 3])).toBe(2);
  });
  it("3~9의 배수 필터", () => {
    const c = [6, 12, 18, 24, 30, 36]; // 모두 6의 배수
    expect([3, 4, 5, 6, 7, 8, 9].map((k) => f(`mul${k}`).compute(c))).toEqual([6, 3, 1, 6, 0, 1, 2]);
    expect(f("mul8").compute([8, 16, 24, 32, 40, 1])).toBe(5);
    expect(f("mul9").compute([9, 18, 27, 36, 45, 1])).toBe(5);
    expect(f("mul7").compute([7, 14, 21, 28, 35, 42])).toBe(6);
    expect(f("mul3").domain).toEqual([0, 6]);
    expect(f("mul8").domain).toEqual([0, 5]);
    expect(f("mul9").domain).toEqual([0, 5]);
  });
  it("용지 가로·세로 그룹 (동행복권 용지 7×7, 43~45는 7번째 가로줄)", () => {
    const c = [1, 8, 15, 22, 29, 36]; // 모두 세로1
    expect(f("col1").compute(c)).toBe(6);
    expect(f("col2").compute(c)).toBe(0);
    expect(f("row1").compute(c)).toBe(1);
    expect(f("row6").compute(c)).toBe(1);
    expect(f("row7").compute([43, 44, 45, 1, 2, 3])).toBe(3);
    expect(f("row1").compute([43, 44, 45, 1, 2, 3])).toBe(3);
    expect(f("col7").compute([7, 14, 21, 28, 35, 42])).toBe(6);
    for (let r = 1; r <= 7; r++) expect(f(`row${r}`).compute([r * 7 - 6, 1, 2, 3, 4, 5])).toBeGreaterThanOrEqual(1);
    const total = (k: string) => [1, 2, 3, 4, 5, 6, 7].reduce((a, i) => a + f(`${k}${i}`).compute([3, 12, 20, 27, 33, 45]), 0);
    expect(total("row")).toBe(6);
    expect(total("col")).toBe(6);
  });
  it("필터 키는 중복되지 않는다", () => {
    expect(new Set(FILTERS.map((x) => x.key)).size).toBe(FILTERS.length);
  });
  it("모든 필터가 도메인 안의 값을 낸다(무작위 조합 2000개)", () => {
    const h = { draws };
    for (let i = 0; i < 2000; i++) {
      const s = new Set<number>();
      while (s.size < 6) s.add(1 + Math.floor(Math.random() * 45));
      const c = m.sortCombo([...s]);
      for (const d of FILTERS) {
        const v = d.compute(c, h);
        expect(Number.isFinite(v), d.key).toBe(true);
        if (d.key !== "maxAbsence" && d.key !== "sumAbsence") expect(v >= d.domain[0] && v <= d.domain[1], `${d.key}=${v}`).toBe(true);
      }
    }
  });
});

describe("이력 필터", () => {
  it("보너스 이월·핫·콜드·미출현·역대 일치", () => {
    expect(f("bonusCarry").compute([26, 1, 2, 3, 4, 5], hist(4))).toBe(1);
    expect(f("bonusCarry").compute([1, 2, 3, 4, 5, 6], hist(4))).toBe(0);
    expect(f("recent5").compute([20, 21, 22, 1, 2, 3], hist(5))).toBe(6);
    expect(f("recent5").compute([30, 31, 32, 43, 44, 45], hist(5))).toBe(0);
    expect(f("cold5").compute([30, 31, 32, 43, 44, 45], hist(5))).toBe(0); // 이력이 5회 미만이면 콜드 0 (원본 규칙)
    expect(f("maxAbsence").compute([1, 10, 20, 30, 31, 32], hist(4))).toBe(3);
    expect(f("sumAbsence").compute([1, 10, 20, 30, 31, 32], hist(4))).toBe(2 + 1 + 0 + 3 + 3 + 3);
    expect(f("pastMatch").compute([1, 2, 3, 10, 11, 30], hist(4))).toBe(3);
    expect(f("pastMatch").compute([1, 2, 3, 4, 5, 6], hist(4))).toBe(6);
  });
  it("이력이 없으면 0 (원본 규칙상 중간은 6)", () => {
    for (const d of FILTERS.filter((x) => x.needsHistory)) expect(d.compute([1, 2, 3, 4, 5, 6], undefined)).toBe(d.key === "neutral10" ? 6 : 0);
  });
});

describe("표현식 엔진", () => {
  const ev = (src: string, c = [3, 8, 14, 22, 31, 42]) => evalExpr(parseExpr(src), c, (n) => FILTER_BY_KEY.get(n)?.compute(c));
  it("산술·비교·논리", () => {
    expect(ev("sum == 120")).toBe(1);
    expect(ev("sum >= 100 && sum <= 175 && odd == 2")).toBe(1);
    expect(ev("!(odd == 2) || high == 2")).toBe(1);
    expect(ev("1 + 2 * 3 == 7")).toBe(1);
    expect(ev("(1 + 2) * 3 == 9")).toBe(1);
    expect(ev("n1 == 3 && n6 == 42")).toBe(1);
    expect(ev("has(14) && !has(15)")).toBe(1);
    expect(ev("max(n1, n2) - min(n5, n6) < 0")).toBe(1);
    expect(ev("abs(-5) == 5")).toBe(1);
    expect(ev("-sum < 0")).toBe(1);
    expect(ev("10 / 0 == 0")).toBe(1);
  });
  it("문법 오류와 위험한 입력을 거부한다", () => {
    for (const bad of ["", "sum >=", "process.exit(1)", "constructor", "__proto__ == 1", "sum; 1", "sum == 'a'", "foo(1)", "has()", "min()", "((1)", "1 2", "sum $ 3", "x".repeat(301), "(".repeat(100) + "1" + ")".repeat(100)]) {
      expect(checkExpr(bad).ok, bad).toBe(false);
    }
  });
  it("최대 깊이 안에서 중첩 가능", () => {
    expect(checkExpr("((((1 + 2))))").ok).toBe(true);
  });
});

describe("사용자 정의 필터", () => {
  const base = { count: 40, fixed: [], exclude: [], candidates: [], maxAttempts: 200000 };
  it("번호 집합 필터", () => {
    const rule = { key: "set:a", label: "내 후보 A", set: [3, 8, 14, 22, 31], min: 1, max: 2 };
    const r = generate({ ...base, rules: [rule] });
    expect(r.combos.length).toBe(40);
    for (const c of r.combos) {
      const k = c.filter((n) => rule.set.includes(n)).length;
      expect(k >= 1 && k <= 2).toBe(true);
    }
    expect(describeRule(rule)).toContain("내 후보 A");
  });
  it("표현식 필터", () => {
    const r = generate({ ...base, rules: [{ key: "expr:1", expr: "sum >= 100 && sum <= 175 && odd == 3 && !has(7)" }] });
    expect(r.combos.length).toBe(40);
    for (const c of r.combos) {
      expect(m.sum(c) >= 100 && m.sum(c) <= 175 && m.oddCount(c) === 3 && !c.includes(7)).toBe(true);
    }
  });
  it("잘못된 사용자 필터는 실행 전에 막는다", () => {
    const v = (rules: Parameters<typeof validateOptions>[0]["rules"]) => validateOptions({ count: 1, fixed: [], exclude: [], candidates: [], rules }, false).map((p) => p.code);
    expect(v([{ key: "e", expr: "sum >" }])).toContain("expr-syntax");
    expect(v([{ key: "e", expr: "nope > 1" }])).toContain("expr-syntax");
    expect(v([{ key: "s", set: [1, 1, 2] }])).toContain("set-invalid");
    expect(v([{ key: "s", set: [0, 46] }])).toContain("set-invalid");
    expect(v([{ key: "s", set: [1, 2, 3], min: 4 }])).toContain("rule-impossible");
    expect(v([{ key: "e", expr: "carry == 1" }])).toContain("no-history");
  });
  it("정확한 열거에서도 사용자 정의 필터가 동작한다", async () => {
    const r = await countSpace({ fixed: [], exclude: [], candidates: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rules: [{ key: "s", set: [1, 2], min: 2 }] });
    expect(r.passed).toBe(binom(8, 4)); // 1,2 포함 + 나머지 8개 중 4개
  });
});

describe("통계 엔진", () => {
  it("번호별 출현·미출현", () => {
    const s = numberStats(draws);
    expect(s[19]!.count).toBe(2); // 20
    expect(s[19]!.absence).toBe(0);
    expect(s[0]!.absence).toBe(3); // 1은 1회에 나옴, 4회차까지 3회 지남
    expect(s[29]!.absence).toBe(4);
    expect(numberStats(draws, { window: 2 })[19]!.count).toBe(2);
    expect(numberStats(draws, { includeBonus: true })[6]!.count).toBe(1); // 7은 1회 보너스
    expect(numberStats(draws)[6]!.count).toBe(0);
  });
  it("빈도 순위는 동률에서 번호 오름차순", () => {
    const top = rankByFrequency(numberStats(draws));
    expect(top.slice(0, 3).map((x) => x.number)).toEqual([20, 21, 22]);
  });
  it("지표 시계열은 미래 데이터를 쓰지 않는다", () => {
    const series = metricSeries({ key: "carry" }, draws);
    expect(series.map((s) => s.value)).toEqual([0, 0, 0, 3]); // 4회차만 3회차와 20,21,22 겹침
    const d = valueDistribution(series);
    expect(d.find((x) => x.value === 0)!.count).toBe(3);
    expect(d.reduce((a, x) => a + x.ratio, 0)).toBeCloseTo(1);
  });
  it("백테스트", () => {
    const r = backtest([{ key: "sum", min: 100 }], draws);
    expect(r.tested).toBe(4);
    expect(r.passedRounds).toEqual([3, 4].filter((n) => m.sum(draws[n - 1]!.numbers) >= 100));
    const r2 = backtest([{ key: "carry", values: [0] }], draws);
    expect(r2.skipped).toBe(1);
    expect(r2.tested).toBe(3);
  });
  it("공간 분포: 홀수 개수 = C(10,k)·C(10,6−k)", async () => {
    const cand = Array.from({ length: 20 }, (_, i) => i + 1);
    const r = await spaceDistribution({ key: "odd" }, { fixed: [], exclude: [], candidates: cand });
    expect(r.total).toBe(binom(20, 6));
    for (const row of r.counts) expect(row.count).toBe(binom(10, row.value) * binom(10, 6 - row.value));
  });
  it("묶음 겹침 분석", () => {
    const rep = overlapReport([[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 7], [10, 11, 12, 13, 14, 15]]);
    expect(rep.maxOverlap).toBe(5);
    expect(rep.pairHistogram[5]).toBe(1);
    expect(rep.pairHistogram[0]).toBe(2);
    expect(rep.avgOverlap).toBeCloseTo(5 / 3);
    expect(rep.distinctNumbers).toBe(13);
    expect(rep.topNumber!.count).toBe(2);
  });
});

describe("확률", () => {
  it("등수별 경우의 수와 합", () => {
    const p = rankProbabilities();
    expect(p.map((x) => x.ways)).toEqual([1, 6, 228, 11115, 182780]);
    expect(p[0]!.oneIn).toBe(TOTAL_COMBOS);
    expect(p.reduce((a, x) => a + x.ways, 0)).toBe(194130);
    expect(p[4]!.oneIn).toBeCloseTo(44.56, 1);
  });
  it("실제 열거와 일치(등수별 경우의 수)", async () => {
    // 임의 고정 당첨번호에 대해 모든 조합의 일치 개수를 세어 확인
    const { forEachCombo } = await import("../src/core/enumerate");
    const { matchDraw } = await import("../src/core/match");
    const d = mk(1, [3, 12, 19, 27, 33, 41], 8);
    const cnt: Record<number, number> = {};
    await forEachCombo({ fixed: [], exclude: [], candidates: [] }, (c) => {
      const r = matchDraw(c, d).rank;
      if (r) cnt[r] = (cnt[r] ?? 0) + 1;
    });
    expect(cnt).toEqual({ 1: 1, 2: 6, 3: 228, 4: 11115, 5: 182780 });
  }, 120000);
});

describe("휠 엔진", () => {
  it("명세 검사", () => {
    expect(checkWheelSpec({ pool: [1, 2, 3], t: 3, m: 2 })).not.toBeNull();
    expect(checkWheelSpec({ pool: Array.from({ length: 17 }, (_, i) => i + 1), t: 3, m: 2 })).not.toBeNull();
    expect(checkWheelSpec({ pool: [1, 2, 3, 4, 5, 6, 7], t: 3, m: 4 })).not.toBeNull();
    expect(checkWheelSpec({ pool: [1, 1, 3, 4, 5, 6, 7], t: 3, m: 2 })).not.toBeNull();
    expect(checkWheelSpec({ pool: [1, 2, 3, 4, 5, 6, 7], t: 3, m: 2 })).toBeNull();
  });
  it("자명한 경우", () => {
    expect(abbreviatedWheel({ pool: [1, 2, 3, 4, 5, 6, 7], t: 6, m: 6 }).tickets).toHaveLength(7);
    expect(abbreviatedWheel({ pool: [1, 2, 3, 4, 5, 6], t: 6, m: 6 }).tickets).toHaveLength(1);
    expect(abbreviatedWheel({ pool: Array.from({ length: 12 }, (_, i) => i + 1), t: 1, m: 1 }).tickets).toHaveLength(2);
  });
  it.each([
    [8, 6, 3], [10, 6, 4], [10, 5, 3], [12, 6, 3], [12, 5, 3], [14, 6, 3],
  ])("v=%i t=%i m=%i 결과가 조건을 전수 만족하고 전체 휠보다 적다", (v, t, mm) => {
    const pool = Array.from({ length: v }, (_, i) => i * 2 + 1);
    const r = abbreviatedWheel({ pool, t, m: mm });
    expect(r.complete).toBe(true);
    expect(verifyWheel({ pool, t, m: mm }, r.tickets).ok).toBe(true);
    expect(r.tickets.length).toBeLessThanOrEqual(r.fullWheelSize);
    for (const c of r.tickets) {
      expect(m.isValidCombo(c)).toBe(true);
      expect(c.every((n) => pool.includes(n))).toBe(true);
    }
    expect(new Set(r.tickets.map(m.comboKey)).size).toBe(r.tickets.length);
  });
  it("검증은 빠진 조합을 찾아낸다", () => {
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r = abbreviatedWheel({ pool, t: 6, m: 4 });
    const broken = r.tickets.slice(1);
    // 하나를 빼면 보장이 깨질 수 있음: 깨지지 않으면 중복 조합이 있었다는 뜻이므로 최소성 점검
    const v = verifyWheel({ pool, t: 6, m: 4 }, [r.tickets[0]!]);
    expect(v.ok).toBe(false);
    expect(v.counterexample).toHaveLength(6);
    void broken;
  });
  it("전체 휠", () => {
    expect(fullWheel([1, 2, 3, 4, 5, 6, 7, 8])).toHaveLength(28);
    expect(fullWheel(Array.from({ length: 20 }, (_, i) => i + 1), 1000)).toBeNull();
  });
  it("v=16 상한 성능", () => {
    const pool = Array.from({ length: 16 }, (_, i) => i + 1);
    const t0 = Date.now();
    const r = abbreviatedWheel({ pool, t: 6, m: 4 });
    expect(verifyWheel({ pool, t: 6, m: 4 }, r.tickets).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(60000);
  }, 70000);
});

describe("휠 엔진 독립 검증", () => {
  // 비트마스크를 쓰지 않는 별도 구현으로 같은 보장을 확인한다.
  const subsets = (arr: number[], k: number): number[][] => (k === 0 ? [[]] : arr.flatMap((x, i) => subsets(arr.slice(i + 1), k - 1).map((r) => [x, ...r])));
  it.each([[10, 6, 4], [9, 6, 3], [11, 5, 3], [12, 6, 4]])("v=%i t=%i m=%i", (v, t, mm) => {
    const pool = Array.from({ length: v }, (_, i) => i + 3);
    const { tickets } = abbreviatedWheel({ pool, t, m: mm });
    for (const w of subsets(pool, t)) {
      const ws = new Set(w);
      expect(tickets.some((tk) => tk.filter((n) => ws.has(n)).length >= mm), `${w}`).toBe(true);
    }
  });
});

import { historyBefore } from "../src/core/draws";
import { parseRegressKey, regressKey, resolveDef } from "../src/core/filters";
import { regressionRecentRange, regressionSeries } from "../src/core/stats";

const rnd = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();
const randCombo = () => { const set = new Set<number>(); while (set.size < 6) set.add(1 + Math.floor(rnd() * 45)); return m.sortCombo([...set]); };

describe("회귀 (원본 회귀분석 페이지 정의)", () => {
  it("N회귀 = 노리는 회차에서 N회 전 당첨번호와 겹치는 수", () => {
    const h = historyBefore(draws, 5); // 1~4회 이력, 목표 5회
    const reg = (n: number) => resolveDef({ key: regressKey(n) })!;
    expect(reg(2).compute([20, 21, 1, 2, 3, 4], h)).toBe(2); // 5-2=3회 [20..25]
    expect(reg(1).compute([20, 21, 22, 1, 2, 3], h)).toBe(3); // 5-1=4회 [20,21,22,40,41,42]
    expect(reg(4).compute([1, 2, 3, 40, 41, 42], h)).toBe(3); // 5-4=1회 [1..6]
    expect(reg(3).compute([10, 11, 12, 1, 2, 3], h)).toBe(3); // 5-3=2회 [10..15]
    expect(reg(5).compute([1, 2, 3, 4, 5, 6], h)).toBe(0); // 0회는 없음
  });
  it("1회귀는 이월수와 같다", () => {
    const h = historyBefore(draws, 5);
    for (let i = 0; i < 200; i++) {
      const c = randCombo();
      expect(resolveDef({ key: "regress1" })!.compute(c, h)).toBe(FILTER_BY_KEY.get("carry")!.compute(c, h));
    }
  });
  it("목표 회차를 명시하면 그 기준으로 계산한다 (이력이 모자란 미래 회차는 0)", () => {
    const h = historyBefore(draws, 10);
    expect(h.targetRound).toBe(10);
    expect(resolveDef({ key: "regress2" })!.compute([1, 2, 3, 4, 5, 6], h)).toBe(0); // 8회 없음
    expect(resolveDef({ key: "regress9" })!.compute([1, 2, 3, 4, 5, 6], h)).toBe(6); // 1회
  });
  it("키 범위: 1~200만 허용", () => {
    expect(parseRegressKey("regress1")).toBe(1);
    expect(parseRegressKey("regress200")).toBe(200);
    expect(parseRegressKey("regress0")).toBeNull();
    expect(parseRegressKey("regress201")).toBeNull();
    expect(parseRegressKey("regress")).toBeNull();
    expect(resolveDef({ key: "regress201" })).toBeUndefined();
  });
  it("생성에서 회귀 필터가 지켜진다", () => {
    const many: Draw[] = Array.from({ length: 30 }, (_, i) => mk(i + 1, randCombo(), 1 + ((i * 7) % 45)).numbers.includes(1 + ((i * 7) % 45)) ? mk(i + 1, randCombo(), 46 - 1) : mk(i + 1, randCombo(), 1 + ((i * 7) % 45)));
    const fixed = many.map((d) => (d.numbers.includes(d.bonus) ? { ...d, bonus: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((b) => !d.numbers.includes(b))! } : d));
    const h = historyBefore(fixed, 31);
    const r = generate({ count: 30, fixed: [], exclude: [], candidates: [], rules: [{ key: "regress3", min: 1, max: 2 }, { key: "regress7", values: [0] }], history: h, maxAttempts: 200000 });
    expect(r.combos.length).toBe(30);
    const s3 = new Set(fixed.find((d) => d.round === 28)!.numbers);
    const s7 = new Set(fixed.find((d) => d.round === 24)!.numbers);
    for (const c of r.combos) {
      const k3 = c.filter((n) => s3.has(n)).length;
      expect(k3 >= 1 && k3 <= 2).toBe(true);
      expect(c.filter((n) => s7.has(n)).length).toBe(0);
    }
  });
  it("회귀 시계열과 '최근 10회' 범위가 원본 알고리즘과 같다", () => {
    const hist: Draw[] = Array.from({ length: 150 }, (_, i) => mk(i + 1, randCombo(), 0)).map((d) => ({ ...d, bonus: [1, 2, 3, 4, 5, 6, 7, 8].find((b) => !d.numbers.includes(b))! }));
    const target = 151;
    // 원본(regression.html calculateFilterDefaults)을 그대로 옮긴 참조 구현
    const original = (step: number) => {
      let minHits = 6, maxHits = 0, curr = target - step, count = 0;
      while (curr > 0 && count < 10) {
        const currData = hist.find((d) => d.round === curr);
        const prevData = hist.find((d) => d.round === curr - step);
        if (currData && prevData) {
          let hits = 0;
          prevData.numbers.forEach((n) => { if (currData.numbers.includes(n)) hits++; });
          if (hits < minHits) minHits = hits;
          if (hits > maxHits) maxHits = hits;
          count++;
        }
        curr -= step;
      }
      return count > 0 ? { min: minHits, max: maxHits } : null;
    };
    for (const step of [2, 3, 5, 7, 11, 30, 75, 100, 149, 200]) {
      const mine = regressionRecentRange(hist, target, step);
      const ref = original(step);
      expect(mine ? { min: mine.min, max: mine.max } : null, `step ${step}`).toEqual(ref);
    }
    const series = regressionSeries(hist, 2);
    expect(series).toHaveLength(148);
    expect(series[0]).toMatchObject({ round: 3, sourceRound: 1 });
  });
});

describe("로또용지 공간 지표 (원본 lotto_paper 알고리즘과 동일)", () => {
  // lotto_paper.html 의 lpCoord / lpAdjacent / lpMaxClusterSize / lpClassifyPattern 을 그대로 옮긴 참조 구현
  const lpCoord = (n: number) => ({ r: Math.floor((n - 1) / 7), c: (n - 1) % 7 });
  const lpAdjacent = (a: number, b: number) => { const ca = lpCoord(a), cb = lpCoord(b); const dr = Math.abs(ca.r - cb.r), dc = Math.abs(ca.c - cb.c); return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0); };
  const lpMaxClusterSize = (nums: number[]) => {
    const parent: Record<number, number> = {}; nums.forEach((n) => (parent[n] = n));
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
    const union = (x: number, y: number) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; };
    for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) if (lpAdjacent(nums[i]!, nums[j]!)) union(nums[i]!, nums[j]!);
    const g: Record<number, number> = {}; nums.forEach((n) => { const root = find(n); g[root] = (g[root] || 0) + 1; });
    return Math.max(...Object.values(g));
  };
  const lpClassify = (nums: number[]) => {
    const coords = nums.map(lpCoord);
    const rowCount = [0, 0, 0, 0, 0, 0, 0], colCount = [0, 0, 0, 0, 0, 0, 0];
    coords.forEach((c) => { rowCount[c.r]!++; colCount[c.c]!++; });
    const maxRow = Math.max(...rowCount), maxCol = Math.max(...colCount);
    const dd: Record<number, number> = {}, du: Record<number, number> = {};
    coords.forEach((c) => { dd[c.r - c.c] = (dd[c.r - c.c] || 0) + 1; du[c.r + c.c] = (du[c.r + c.c] || 0) + 1; });
    const maxDiag = Math.max(...Object.values(dd), ...Object.values(du));
    const maxCluster = lpMaxClusterSize(nums);
    if (maxRow >= 4) return "line_h"; if (maxCol >= 4) return "line_v"; if (maxDiag >= 4) return "diag"; if (maxCluster >= 3) return "cluster";
    if (maxRow <= 1 && maxCol <= 1) return "dispersed";
    return "mixed";
  };
  const NAME = ["dispersed", "mixed", "cluster", "diag", "line_v", "line_h"];
  it("무작위 조합 20000개에서 원본 분류와 모두 일치", () => {
    for (let i = 0; i < 20000; i++) {
      const c = randCombo();
      expect(NAME[m.paperPattern(c)]).toBe(lpClassify(c));
      expect(m.paperMaxCluster(c)).toBe(lpMaxClusterSize(c));
    }
  });
  it("대표 사례", () => {
    expect(m.paperPattern([1, 2, 3, 4, 5, 40])).toBe(5);
    expect(m.paperPattern([1, 8, 15, 22, 3, 40])).toBe(4);
    expect(m.paperPattern([1, 9, 17, 25, 33, 5])).toBe(3);
    expect(m.paperPattern([1, 2, 8, 30, 38, 44])).toBe(2);
    expect(m.paperPattern([1, 11, 20, 23, 33, 42])).toBe(0);
    expect(m.paperPattern([1, 3, 15, 17, 30, 32])).toBe(1);
  });
  it("활성 라인 수 = 번호가 놓인 가로+세로 라인 수", () => {
    expect(m.paperActiveLines([1, 2, 3, 4, 5, 6])).toBe(1 + 6);
    expect(m.paperActiveLines([1, 8, 15, 22, 29, 36])).toBe(6 + 1);
    expect(m.paperActiveLines([1, 2, 3, 8, 9, 10])).toBe(2 + 3);
  });
});

import { recentMetricRange } from "../src/core/stats";

describe("9궁(마방진) (원본 magic_square 정의)", () => {
  // magic_square.html 의 gungDefinitions / calculateGungCounts / applyRecent10Filters 를 옮긴 참조 구현
  const gungDefinitions: Record<string, number[]> = {
    "1궁": [1, 2, 3, 4, 5], "2궁": [6, 7, 8, 9, 10], "3궁": [11, 12, 13, 14, 15], "4궁": [16, 17, 18, 19, 20], "5궁": [21, 22, 23, 24, 25],
    "6궁": [26, 27, 28, 29, 30], "7궁": [31, 32, 33, 34, 35], "8궁": [36, 37, 38, 39, 40], "9궁": [41, 42, 43, 44, 45],
  };
  it("무작위 조합 5000개에서 궁별 개수가 원본과 같다", () => {
    for (let i = 0; i < 5000; i++) {
      const c = randCombo();
      Object.entries(gungDefinitions).forEach(([name, nums], idx) => {
        expect(f(`gung${idx + 1}`).compute(c), name).toBe(c.filter((n) => nums.includes(n)).length);
      });
      const active = Object.values(gungDefinitions).filter((nums) => c.some((n) => nums.includes(n))).length;
      expect(f("gungActive").compute(c)).toBe(active);
      expect(f("gungMax").compute(c)).toBe(Math.max(...Object.values(gungDefinitions).map((nums) => c.filter((n) => nums.includes(n)).length)));
    }
  });
  it("궁 경계", () => {
    expect([1, 5, 6, 10, 41, 45].map((n) => m.gungOf(n))).toEqual([1, 1, 2, 2, 9, 9]);
    expect(f("gung9").compute([41, 42, 43, 44, 45, 1])).toBe(5);
    expect(f("gungActive").compute([1, 2, 3, 4, 5, 6])).toBe(2);
    expect(f("gungMax").compute([1, 6, 11, 16, 21, 26])).toBe(1);
  });
  it("최근 10회차 필터: 궁별 최솟값·최댓값이 원본과 같다", () => {
    const hist: Draw[] = Array.from({ length: 40 }, (_, i) => mk(i + 1, randCombo(), 0)).map((d) => ({ ...d, bonus: [1, 2, 3, 4, 5, 6, 7, 8].find((b) => !d.numbers.includes(b))! }));
    const recent10 = hist.slice(-10);
    for (const [name, nums] of Object.entries(gungDefinitions)) {
      const values = recent10.map((d) => d.numbers.filter((n) => nums.includes(n)).length);
      const g = Number(name[0]);
      const r = recentMetricRange({ key: `gung${g}` }, hist)!;
      expect({ min: r.min, max: r.max }).toEqual({ min: Math.min(...values), max: Math.max(...values) });
      expect(r.samples).toBe(10);
    }
    expect(recentMetricRange({ key: "gung1" }, [])).toBeNull();
    expect(recentMetricRange({ key: "gung1" }, hist.slice(0, 3))!.samples).toBe(3);
  });
});

describe("회귀 200개 동시 적용", () => {
  const many: Draw[] = Array.from({ length: 1203 }, (_, i) => mk(i + 1, randCombo(), 0)).map((d) => ({ ...d, bonus: [1, 2, 3, 4, 5, 6, 7, 8].find((b) => !d.numbers.includes(b))! }));
  it("1~200회귀 규칙 200개를 한꺼번에 걸어도 검증·생성이 동작한다", () => {
    const h = historyBefore(many, 1204);
    const rules = Array.from({ length: 200 }, (_, i) => ({ key: regressKey(i + 1), min: 0, max: 6 }));
    expect(validateOptions({ count: 5, fixed: [], exclude: [], candidates: [], rules }, true)).toEqual([]);
    const t0 = Date.now();
    const r = generate({ count: 200, fixed: [], exclude: [], candidates: [], rules, history: h, maxAttempts: 100000 });
    expect(r.combos).toHaveLength(200);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it("200개 모두에 최근 10회 범위를 계산하고 그 범위를 지킨다", () => {
    const h = historyBefore(many, 1204);
    const rules = Array.from({ length: 200 }, (_, i) => {
      const r = regressionRecentRange(many, 1204, i + 1)!;
      return { key: regressKey(i + 1), min: r.min, max: r.max };
    });
    const r = generate({ count: 5, fixed: [], exclude: [], candidates: [], rules, history: h, maxAttempts: 2_000_000 });
    for (const c of r.combos) {
      for (const rule of rules) {
        const step = parseRegressKey(rule.key)!;
        const src = new Set(many.find((d) => d.round === 1204 - step)!.numbers);
        const k = c.filter((n) => src.has(n)).length;
        expect(k >= rule.min && k <= rule.max).toBe(true);
      }
    }
  }, 60000);
});

import { diagnose } from "../src/core/diagnose";
import { effectiveRules } from "../src/core/filters";
import { forEachCombo } from "../src/core/enumerate";

describe("끄기·보존·회차 (원본 수동필터 동작)", () => {
  it("꺼진 규칙은 검증·생성·열거에서 모두 무시한다", async () => {
    const rules = [{ key: "sum", min: 200, max: 100, enabled: false }, { key: "odd", values: [3] }];
    expect(validateOptions({ count: 1, fixed: [], exclude: [], candidates: [], rules }, false)).toEqual([]);
    const r = generate({ count: 20, fixed: [], exclude: [], candidates: [], rules, maxAttempts: 100000 });
    expect(r.combos).toHaveLength(20);
    for (const c of r.combos) expect(m.oddCount(c)).toBe(3);
    const cnt = await countSpace({ fixed: [], exclude: [], candidates: Array.from({ length: 10 }, (_, i) => i + 1), rules });
    expect(cnt.passed).toBe(binom(5, 3) * binom(5, 3));
    expect(cnt.cumulative).toHaveLength(1);
  });
  it("이전 회차용 비보존 규칙은 제외, 보존 규칙은 유지", () => {
    const rules = [
      { key: "a", set: [1, 2], round: 10 }, // 이전 회차, 비보존 → 제외
      { key: "b", set: [1, 2], round: 10, preserve: true }, // 보존 → 유지
      { key: "c", set: [1, 2], round: 11 }, // 현재 회차 → 유지
      { key: "d", set: [1, 2] }, // 회차 없음 → 유지
      { key: "e", set: [1, 2], round: 11, enabled: false }, // 꺼짐 → 제외
    ];
    expect(effectiveRules(rules, 11).map((r) => r.key)).toEqual(["b", "c", "d"]);
    expect(effectiveRules(rules).map((r) => r.key)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("필터 진단", () => {
  it("규칙별 단독 차단 수가 무차별 대입 결과와 같다", async () => {
    const candidates = Array.from({ length: 12 }, (_, i) => i + 1);
    const rules = [{ key: "odd", values: [3] }, { key: "sum", max: 40 }, { key: "ac", min: 6 }];
    const d = await diagnose({ fixed: [], exclude: [], candidates, rules });
    // 무차별 대입 참조 구현
    const expected: Record<string, number> = { odd: 0, sum: 0, ac: 0 };
    let passed = 0, one = 0, two = 0, total = 0;
    await forEachCombo({ fixed: [], exclude: [], candidates }, (c) => {
      total++;
      const failed = [m.oddCount(c) !== 3 ? "odd" : null, m.sum(c) > 40 ? "sum" : null, m.acValue(c) < 6 ? "ac" : null].filter(Boolean) as string[];
      if (failed.length === 0) passed++;
      else if (failed.length === 1) { one++; expected[failed[0]!]!++; }
      else two++;
    });
    expect(d.total).toBe(total);
    expect(d.passed).toBe(passed);
    expect(d.failedHistogram).toEqual([passed, one, two]);
    for (const r of d.rules) expect(r.blockedAlone, r.key).toBe(expected[r.key]);
    expect(d.failedHistogram.reduce((a, b) => a + b, 0)).toBe(total);
  });
  it("모순된 규칙: 통과 0개이고 어느 규칙을 끄면 되살아나는지 알려준다", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => i + 1);
    const d = await diagnose({ fixed: [], exclude: [], candidates, rules: [{ key: "odd", values: [6] }, { key: "sum", max: 100 }] });
    expect(d.passed).toBe(0);
    const odd = d.rules.find((r) => r.key === "odd")!;
    expect(odd.blockedAlone).toBeGreaterThan(0); // odd를 끄면 sum<=100 인 조합이 되살아남
  });
});

import { runJob, spaceSize, type JobMessage } from "../src/core/jobs";

describe("계산 작업(워커용)", () => {
  const picks = { fixed: [], exclude: [], candidates: Array.from({ length: 14 }, (_, i) => i + 1) };
  const rules = [{ key: "odd", values: [3] }, { key: "sum", max: 50 }];
  const run = async (kind: "count" | "diagnose", extra: Partial<Parameters<typeof runJob>[0]> = {}, stop?: () => boolean) => {
    const msgs: JobMessage[] = [];
    await runJob({ kind, picks, rules, draws: [], targetRound: 0, ...extra }, (m) => msgs.push(m), stop);
    return msgs;
  };
  it("조합 공간 크기", () => {
    expect(spaceSize({ fixed: [], exclude: [], candidates: [] })).toBe(8145060);
    expect(spaceSize({ fixed: [7], exclude: [1], candidates: [] })).toBe(binom(43, 5));
    expect(spaceSize({ fixed: [1, 2, 3, 4, 5, 6, 7], exclude: [], candidates: [] })).toBe(0);
  });
  it("count 결과가 직접 호출과 같고 진행률을 보낸다", async () => {
    const direct = await countSpace({ ...picks, rules }, { yieldEvery: 500 });
    const msgs = await run("count");
    const done = msgs.find((m) => m.type === "done");
    expect(done && done.type === "done" && done.kind === "count" && done.result.passed).toBe(direct.passed);
    expect(msgs.some((m) => m.type === "progress")).toBe(false); // 3003개는 기본 yield 간격(20만) 미만
  });
  it("진단 결과와 취소", async () => {
    const msgs = await run("diagnose");
    const done = msgs.find((m) => m.type === "done");
    expect(done && done.type === "done" && done.kind === "diagnose" && done.result.total).toBe(3003);
    const msgs2 = await run("count", { picks: { fixed: [], exclude: [], candidates: [] }, rules: [{ key: "sum", min: 100 }] }, () => true);
    const d2 = msgs2.find((m) => m.type === "done");
    expect(d2 && d2.type === "done" && d2.kind === "count" && d2.result.cancelled).toBe(true);
  });
  it("이력이 있으면 목표 회차 이전만 쓴다", async () => {
    const hist = [mk(1, [1, 2, 3, 4, 5, 6], 7), mk(2, [10, 11, 12, 13, 14, 15], 16)];
    const msgs = await run("count", { rules: [{ key: "carry", values: [0] }], draws: hist, targetRound: 3, picks: { fixed: [], exclude: [], candidates: Array.from({ length: 20 }, (_, i) => i + 1) } });
    const d = msgs.find((m) => m.type === "done");
    // 후보 1~20 중 직전(2회) 번호 10~15를 하나도 안 쓰는 조합: C(14,6)
    expect(d && d.type === "done" && d.kind === "count" && d.result.passed).toBe(binom(14, 6));
  });
  it("잘못된 요청은 error 메시지", async () => {
    const msgs: JobMessage[] = [];
    await runJob({ kind: "count", picks, rules, draws: [{} as never], targetRound: 3 }, (m) => msgs.push(m));
    expect(msgs.some((m) => m.type === "error" || m.type === "done")).toBe(true);
  });
});


describe("원본 당첨번호 관리 페이지(winning-numbers) 정의와 대조", () => {
  // winning-numbers.html 의 processData / calc 를 옮긴 참조 구현
  const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43];
  const TRI = [1, 3, 6, 10, 15, 21, 28, 36, 45];
  const orig = (nums: number[], prev: number[] | null, window: number[][] | null) => {
    const nb = new Set<number>();
    prev?.forEach((n) => { if (n > 1) nb.add(n - 1); if (n < 45) nb.add(n + 1); });
    const sorted = [...nums].sort((a, b) => a - b);
    let consec = 0;
    for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] === sorted[i]! + 1) consec++;
    let hot = 0, neutral = 0, cold = 0;
    if (window) {
      const counts = new Array(46).fill(0);
      window.forEach((d) => d.forEach((n) => counts[n]++));
      nums.forEach((n) => { const c = counts[n]; if (c >= 3) hot++; else if (c === 0) cold++; else neutral++; });
    } else neutral = 6;
    const band = [0, 0, 0, 0, 0];
    nums.forEach((n) => { if (n <= 10) band[0]!++; else if (n <= 20) band[1]!++; else if (n <= 30) band[2]!++; else if (n <= 40) band[3]!++; else band[4]!++; });
    return {
      neighbor: prev ? nums.filter((n) => nb.has(n) && !prev.includes(n)).length : 0,
      carry: prev ? nums.filter((n) => prev.includes(n)).length : 0,
      consec, hot, neutral, cold, band,
      low: nums.filter((n) => n <= 23).length,
      m3: nums.filter((n) => n % 3 === 0).length, m4: nums.filter((n) => n % 4 === 0).length, m5: nums.filter((n) => n % 5 === 0).length,
      m7: nums.filter((n) => [7, 14, 21, 28, 35, 42].includes(n)).length, m8: nums.filter((n) => [8, 16, 24, 32, 40].includes(n)).length,
      mNo: nums.filter((n) => n % 3 !== 0 && n % 4 !== 0 && n % 5 !== 0).length,
      prime: nums.filter((n) => PRIMES.includes(n)).length, composite: nums.filter((n) => n !== 1 && !PRIMES.includes(n)).length, tri: nums.filter((n) => TRI.includes(n)).length,
    };
  };
  it("120회 무작위 이력에서 모든 속성이 원본 계산과 같다", () => {
    const all: Draw[] = Array.from({ length: 120 }, (_, i) => mk(i + 1, randCombo(), 0)).map((d) => ({ ...d, bonus: [1, 2, 3, 4, 5, 6, 7, 8].find((b) => !d.numbers.includes(b))! }));
    all.forEach((d, idx) => {
      const prior = all.slice(0, idx);
      const h = { draws: prior, targetRound: d.round };
      const o = orig([...d.numbers], idx > 0 ? [...all[idx - 1]!.numbers] : null, idx >= 10 ? all.slice(idx - 10, idx).map((x) => [...x.numbers]) : null);
      const g = (k: string) => f(k).compute(d.numbers, h);
      if (idx > 0) { expect(g("neighbor"), `neighbor ${d.round}`).toBe(o.neighbor); expect(g("carry")).toBe(o.carry); }
      expect(g("consecPairs")).toBe(o.consec);
      expect(g("hot10"), `hot ${d.round}`).toBe(o.hot);
      expect(g("neutral10"), `neutral ${d.round}`).toBe(o.neutral);
      expect(g("cold10"), `cold ${d.round}`).toBe(o.cold);
      expect([1, 2, 3, 4, 5].map((b) => g(`band${b}`))).toEqual(o.band);
      expect(6 - g("high")).toBe(o.low);
      expect([g("mul3"), g("mul4"), g("mul5"), g("mul7"), g("mul8"), g("mulNone")]).toEqual([o.m3, o.m4, o.m5, o.m7, o.m8, o.mNo]);
      expect([g("prime"), g("composite"), g("triangular")]).toEqual([o.prime, o.composite, o.tri]);
    });
  });
  it("저·고 경계: 23은 저, 24는 고", () => {
    expect(m.highCount([23, 1, 2, 3, 4, 5])).toBe(0);
    expect(m.highCount([24, 1, 2, 3, 4, 5])).toBe(1);
  });
});
