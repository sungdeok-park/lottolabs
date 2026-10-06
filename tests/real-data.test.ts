import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateDrawFile } from "../src/core/draws";
import { FILTER_BY_KEY } from "../src/core/filters";
import type { Draw } from "../src/core/types";

const file = JSON.parse(readFileSync(new URL("../public/data/draws.json", import.meta.url), "utf8"));
const draws: Draw[] = file.draws;
const sample = JSON.parse(readFileSync(new URL("./fixtures/original-sample.json", import.meta.url), "utf8")).rows as Record<string, any>[];
const f = (k: string) => FILTER_BY_KEY.get(k)!;

describe("당첨 이력 데이터(public/data/draws.json)", () => {
  it("검증을 통과하고 회차가 1부터 빠짐없이 이어진다", () => {
    const r = validateDrawFile(file);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(draws.length).toBeGreaterThanOrEqual(1244);
    draws.forEach((d, i) => expect(d.round).toBe(i + 1));
  });
  it("날짜는 오름차순이고 토요일 추첨이다(첫 회 2002-12-07)", () => {
    expect(draws[0]!.date).toBe("2002-12-07");
    for (let i = 1; i < draws.length; i++) expect(draws[i]!.date > draws[i - 1]!.date).toBe(true);
    for (const d of draws) expect(new Date(d.date + "T00:00:00Z").getUTCDay(), `${d.round}회 ${d.date}`).toBe(6);
  });
  it("알려진 회차", () => {
    expect(draws[0]).toMatchObject({ numbers: [10, 23, 29, 33, 37, 40], bonus: 16 });
    expect(draws[1243]).toMatchObject({ round: 1244, date: "2026-10-03", numbers: [1, 13, 18, 26, 34, 38], bonus: 25 });
  });
});

describe("원본 도구(엑셀 내보내기) 계산값과 비교 — 표본 행", () => {
  it("총합·끝수합·AC·홀짝·저고·소합·연번·핫콜드·배수·번호대·이웃수·이월수가 같다", () => {
    expect(sample.length).toBeGreaterThan(50);
    for (const r of sample) {
      const i = draws.findIndex((d) => d.round === r.round);
      const d = draws[i]!;
      expect([...d.numbers, d.bonus], `${r.round}회 번호`).toEqual([r.n1, r.n2, r.n3, r.n4, r.n5, r.n6, r.bonus]);
      const h = { draws: draws.slice(0, i), targetRound: d.round };
      const g = (k: string) => f(k).compute(d.numbers, h);
      const at = (k: string) => `${r.round}회 ${k}`;
      expect(g("sum"), at("총합")).toBe(r.sum);
      expect(g("endSum"), at("끝수합")).toBe(r.endSum);
      expect(g("ac"), at("AC")).toBe(r.ac);
      expect(`${g("odd")}:${6 - g("odd")}`, at("홀짝")).toBe(r.oddEven);
      expect(`${6 - g("high")}:${g("high")}`, at("저고")).toBe(r.lowHigh);
      expect(`${g("prime")}:${g("composite")}`, at("소합")).toBe(r.primeComposite);
      expect(g("consecPairs"), at("연번")).toBe(r.consecutive);
      expect(`${g("hot10")}-${g("neutral10")}-${g("cold10")}`, at("핫콜드")).toBe(r.hotCold);
      expect(`${g("mul3")}/${g("mul4")}/${g("mul5")}/${g("mulNone")}`, at("배수")).toBe(r.multiples);
      expect([1, 2, 3, 4, 5].map((b) => g(`band${b}`)).join("-"), at("번호대")).toBe(r.bands);
      if (i > 0) {
        expect(g("neighbor"), at("이웃수")).toBe(r.neighbor);
        expect(g("carry"), at("이월수")).toBe(r.carry);
      }
    }
  });
});

describe("실제 이력으로 동작 확인", () => {
  it("1회귀는 이월수와 같고 N회귀는 N회 전 번호와의 겹침이다", async () => {
    const { resolveDef } = await import("../src/core/filters");
    const target = draws.length + 1; // 다음 회차
    const h = { draws, targetRound: target };
    const c = [1, 13, 18, 26, 34, 38];
    expect(resolveDef({ key: "regress1" })!.compute(c, h)).toBe(f("carry").compute(c, h));
    const src = new Set(draws[target - 5 - 1]!.numbers); // 5회 전
    expect(resolveDef({ key: "regress5" })!.compute(c, h)).toBe(c.filter((n) => src.has(n)).length);
  });
  it("역대 최대 일치 필터: 과거 1등 조합 자체는 6", () => {
    const h = { draws, targetRound: draws.length + 1 };
    expect(f("pastMatch").compute([1, 13, 18, 26, 34, 38], h)).toBe(6);
    expect(f("pastMatch").compute([1, 2, 3, 4, 5, 6], h)).toBeLessThan(6);
  });
});
