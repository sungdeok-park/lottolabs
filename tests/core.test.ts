import { describe, expect, it } from "vitest";
import { countSpace, createGenerator, generate, validateOptions } from "../src/core/generate";
import * as m from "../src/core/metrics";
import { matchDraw } from "../src/core/match";
import { historyBefore, validateDrawFile } from "../src/core/draws";
import { decodeShare, encodeShare, mailtoLink } from "../src/core/share";
import { FILTERS } from "../src/core/filters";
import type { Draw } from "../src/core/types";

const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("metrics", () => {
  it("AC 정의", () => {
    expect(m.acValue([1, 2, 3, 4, 5, 6])).toBe(0);
    expect(m.acValue([1, 2, 4, 8, 16, 32])).toBe(10);
  });
  it("연번과 연속쌍을 구분한다", () => {
    expect(m.consecutivePairs([7, 8, 9, 20, 30, 40])).toBe(2);
    expect(m.longestRun([7, 8, 9, 20, 30, 40])).toBe(3);
    expect(m.consecutivePairs([1, 2, 10, 11, 30, 40])).toBe(2);
    expect(m.longestRun([1, 2, 10, 11, 30, 40])).toBe(2);
    expect(m.longestRun([1, 5, 10, 20, 30, 40])).toBe(1);
  });
  it("총합·끝수합·홀짝·고저", () => {
    const c = [3, 8, 14, 22, 31, 42];
    expect(m.sum(c)).toBe(120);
    expect(m.endDigitSum(c)).toBe(3 + 8 + 4 + 2 + 1 + 2);
    expect(m.oddCount(c)).toBe(2);
    expect(m.highCount(c)).toBe(2); // 31, 42
  });
  it("1은 합성수가 아니다", () => {
    expect(m.isComposite(1)).toBe(false);
    expect(m.isPrime(1)).toBe(false);
    expect(m.isComposite(4)).toBe(true);
  });
  it("소수 개수는 1~45에서 14개", () => {
    expect(Array.from({ length: 45 }, (_, i) => i + 1).filter(m.isPrime)).toHaveLength(14);
  });
});

describe("match", () => {
  const d: Draw = { round: 1, date: "2000-01-01", numbers: [1, 2, 3, 4, 5, 6], bonus: 7 };
  it("등수 판정과 보너스 처리", () => {
    expect(matchDraw([1, 2, 3, 4, 5, 6], d).rank).toBe(1);
    expect(matchDraw([1, 2, 3, 4, 5, 7], d)).toEqual({ matched: 5, bonus: true, rank: 2 });
    expect(matchDraw([1, 2, 3, 4, 5, 8], d).rank).toBe(3);
    expect(matchDraw([1, 2, 3, 4, 8, 9], d).rank).toBe(4);
    expect(matchDraw([1, 2, 3, 8, 9, 10], d).rank).toBe(5);
    expect(matchDraw([1, 2, 7, 8, 9, 10], d).rank).toBeNull();
  });
});

describe("generate", () => {
  const base = { count: 10, fixed: [], exclude: [], candidates: [], rules: [], maxAttempts: 100000 };
  it("고정수 포함·제외수 미포함·중복 없음", () => {
    const r = generate({ ...base, count: 50, fixed: [7, 8], exclude: [1, 2, 3], rng: mulberry(1) });
    expect(r.reason).toBe("done");
    expect(r.combos).toHaveLength(50);
    expect(new Set(r.combos.map(m.comboKey)).size).toBe(50);
    for (const c of r.combos) {
      expect(c).toContain(7);
      expect(c).toContain(8);
      expect([1, 2, 3].some((n) => c.includes(n))).toBe(false);
      expect(m.isValidCombo(c)).toBe(true);
    }
  });
  it("필터를 모두 만족한다", () => {
    const r = generate({ ...base, count: 30, rules: [{ key: "sum", min: 100, max: 175 }, { key: "odd", values: [3] }, { key: "ac", min: 7 }], rng: mulberry(2) });
    for (const c of r.combos) {
      expect(m.sum(c)).toBeGreaterThanOrEqual(100);
      expect(m.sum(c)).toBeLessThanOrEqual(175);
      expect(m.oddCount(c)).toBe(3);
      expect(m.acValue(c)).toBeGreaterThanOrEqual(7);
    }
  });
  it("시도 상한은 attempt-limit이며 실제 수를 돌려준다", () => {
    const r = generate({ ...base, count: 1000, candidates: [1, 2, 3, 4, 5, 6, 7], maxAttempts: 5000, rng: mulberry(3) });
    expect(r.reason).toBe("attempt-limit");
    expect(r.combos.length).toBe(7); // C(7,6)
  });
  it("취소", () => {
    const g = createGenerator({ ...base, count: 1000, rng: mulberry(4) });
    g.step(50, () => true);
    expect(g.result().reason).toBe("cancelled");
  });
  it("필터별 탈락 수를 기록한다", () => {
    const r = generate({ ...base, count: 5, rules: [{ key: "sum", min: 100, max: 110 }], rng: mulberry(5) });
    expect(r.rejectedByRule.sum).toBeGreaterThan(0);
  });
});

describe("validateOptions", () => {
  const ok = { count: 5, fixed: [], exclude: [], candidates: [], rules: [] };
  it("확정 불가능 조건을 막는다", () => {
    expect(validateOptions({ ...ok, fixed: [1, 2, 3, 4, 5, 6, 7] }, false).map((p) => p.code)).toContain("fixed-many");
    expect(validateOptions({ ...ok, fixed: [1], exclude: [1] }, false).map((p) => p.code)).toContain("fixed-excluded");
    expect(validateOptions({ ...ok, candidates: [1, 2, 3, 4, 5] }, false).map((p) => p.code)).toContain("pool-small");
    expect(validateOptions({ ...ok, rules: [{ key: "sum", min: 200, max: 100 }] }, false).map((p) => p.code)).toContain("range-inverted");
    expect(validateOptions({ ...ok, rules: [{ key: "ac", min: 11 }] }, false).map((p) => p.code)).toContain("rule-impossible");
    expect(validateOptions({ ...ok, rules: [{ key: "carry", values: [1] }] }, false).map((p) => p.code)).toContain("no-history");
    expect(validateOptions(ok, false)).toEqual([]);
  });
  it("고정수와 후보 번호군은 별개다", () => {
    expect(validateOptions({ ...ok, fixed: [40], candidates: [1, 2, 3, 4, 5] }, false)).toEqual([]);
  });
});

describe("countSpace", () => {
  it("제한 없음이면 전체 C(45,6)=8,145,060", async () => {
    const r = await countSpace({ fixed: [], exclude: [], candidates: [], rules: [] });
    expect(r.total).toBe(8145060);
    expect(r.passed).toBe(8145060);
  }, 60000);
  it("고정수 1개 → C(44,5)", async () => {
    const r = await countSpace({ fixed: [7], exclude: [], candidates: [], rules: [] });
    expect(r.total).toBe(1086008);
  });
  it("홀수 3개 필터: C(23,3)*C(22,3)", async () => {
    const r = await countSpace({ fixed: [], exclude: [], candidates: [], rules: [{ key: "odd", values: [3] }] });
    expect(r.passed).toBe(1771 * 1540);
  }, 60000);
  it("누적/독립 집계", async () => {
    const r = await countSpace({ fixed: [], exclude: [], candidates: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rules: [{ key: "odd", values: [3] }, { key: "sum", max: 30 }] });
    expect(r.total).toBe(210);
    expect(r.cumulative[0]!.remaining).toBe(100); // C(5,3)*C(5,3)
    expect(r.cumulative[1]!.remaining).toBeLessThanOrEqual(r.cumulative[0]!.remaining);
    expect(r.independent.odd).toBe(100);
  });
});

describe("history", () => {
  const draws: Draw[] = [
    { round: 1, date: "2000-01-01", numbers: [1, 2, 3, 4, 5, 6], bonus: 7 },
    { round: 2, date: "2000-01-08", numbers: [10, 11, 12, 13, 14, 15], bonus: 16 },
    { round: 3, date: "2000-01-15", numbers: [20, 21, 22, 23, 24, 25], bonus: 26 },
  ];
  it("목표 회차 이전 데이터만 사용한다", () => {
    expect(historyBefore(draws, 3).draws.map((d) => d.round)).toEqual([1, 2]);
    expect(historyBefore(draws, 1).draws).toEqual([]);
  });
  it("이월수·이웃수·최근 출현수", () => {
    const h = historyBefore(draws, 3);
    const f = (k: string) => FILTERS.find((x) => x.key === k)!;
    expect(f("carry").compute([10, 11, 30, 31, 32, 33], h)).toBe(2);
    expect(f("neighbor").compute([9, 16, 30, 31, 32, 33], h)).toBe(2); // 9,16 은 10~15의 ±1
    expect(f("recent5").compute([1, 10, 30, 31, 32, 33], h)).toBe(2);
    expect(f("recent5").compute([1, 10, 30, 31, 32, 33], historyBefore(draws, 2))).toBe(1);
  });
  it("당첨 파일 검증", () => {
    expect(validateDrawFile({ schemaVersion: 1, updatedAt: "", source: "", draws }).ok).toBe(true);
    const bad = { schemaVersion: 1, draws: [{ round: 1, date: "2000-01-01", numbers: [1, 1, 3, 4, 5, 6], bonus: 7 }] };
    expect(validateDrawFile(bad).ok).toBe(false);
    const dupBonus = { schemaVersion: 1, draws: [{ round: 1, date: "2000-01-01", numbers: [1, 2, 3, 4, 5, 6], bonus: 6 }] };
    expect(validateDrawFile(dupBonus).ok).toBe(false);
    expect(validateDrawFile(null).ok).toBe(false);
  });
});

describe("share", () => {
  const combos = [[3, 8, 14, 22, 31, 42], [5, 11, 19, 27, 34, 45]];
  it("왕복", () => {
    const frag = encodeShare({ round: 1200, combos });
    expect(frag).toBe("v1.1200.030814223142,051119273445");
    const r = decodeShare("#" + frag);
    expect(r.ok && r.payload.combos).toEqual(combos);
  });
  it("악성·잘못된 payload 거부", () => {
    for (const bad of ["", "v2.1.030814223142", "v1.1.0308142231", "v1.1.030814223146", "v1.1.000814223142", "v1.1.464544434241", "v1.1.424231221408", "v1.1.<script>", "v1.1." + ("030814223142,".repeat(40)).slice(0, -1), "v1.0.030814223142"]) {
      expect(decodeShare(bad).ok, bad).toBe(false);
    }
  });
  it("mailto 한글·줄바꿈 인코딩", () => {
    const l = mailtoLink("제1200회 조합", "A 03 08\nB 05 11");
    expect(l).toContain("%EC%A0%9C1200");
    expect(l).toContain("%0A");
    expect(l).not.toContain("\n");
  });
});
