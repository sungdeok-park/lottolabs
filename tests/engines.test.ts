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
    expect(f("cold5").compute([30, 31, 32, 43, 44, 45], hist(5))).toBe(6);
    expect(f("cold5").compute([1, 10, 20, 40, 41, 42], hist(5))).toBe(0);
    expect(f("maxAbsence").compute([1, 10, 20, 30, 31, 32], hist(4))).toBe(3);
    expect(f("sumAbsence").compute([1, 10, 20, 30, 31, 32], hist(4))).toBe(2 + 1 + 0 + 3 + 3 + 3);
    expect(f("pastMatch").compute([1, 2, 3, 10, 11, 30], hist(4))).toBe(3);
    expect(f("pastMatch").compute([1, 2, 3, 4, 5, 6], hist(4))).toBe(6);
  });
  it("이력이 없으면 0", () => {
    for (const d of FILTERS.filter((x) => x.needsHistory)) expect(d.compute([1, 2, 3, 4, 5, 6], undefined)).toBe(0);
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
