import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { centralRangeRules, currentExclusion, drawDeadline, evaluateExclusion, evaluationTargets, passesAll, validateExclusionFile, validateRecommendedFile, type ExclusionEntry } from "../src/core/operator";
import { countSpace } from "../src/core/generate";
import type { Draw } from "../src/core/types";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const draws: Draw[] = read("../public/data/draws.json").draws;
const entry = (o: Partial<ExclusionEntry> = {}): ExclusionEntry => ({ targetRound: 1244, publishedAt: "2026-10-02T09:00:00+09:00", revision: 1, status: "published", numbers: [2, 3, 4, 5], methodVersion: "t1", description: "시험", ...o });

describe("운영자 제외수 데이터", () => {
  it("저장소의 exclusions.json이 유효하다", () => {
    const f = read("../public/data/exclusions.json");
    expect(validateExclusionFile(f)).toEqual({ ok: true, errors: [] });
  });
  it("잘못된 항목을 거부한다", () => {
    const bad = (e: unknown) => validateExclusionFile({ schemaVersion: 1, entries: [e] });
    expect(bad(entry({ numbers: [1, 1] })).ok).toBe(false);
    expect(bad(entry({ numbers: [0, 46] })).ok).toBe(false);
    expect(bad(entry({ numbers: [] })).ok).toBe(false); // 게시본은 비어 있으면 안 됨
    expect(bad(entry({ status: "x" as never })).ok).toBe(false);
    expect(bad(entry({ revision: 0 })).ok).toBe(false);
    expect(bad(entry({ publishedAt: "어제" })).ok).toBe(false);
    expect(bad(entry({ methodVersion: " " })).ok).toBe(false);
    expect(validateExclusionFile({ schemaVersion: 1, entries: [entry(), entry()] }).ok).toBe(false); // 같은 회차·revision 중복
    expect(validateExclusionFile({ schemaVersion: 2, entries: [] }).ok).toBe(false);
    expect(validateExclusionFile(null).ok).toBe(false);
    expect(bad(entry()).ok).toBe(true);
  });
  it("회차의 현재 유효 항목: 철회·초안 제외, revision 높은 게시본", () => {
    const es = [entry({ revision: 1 }), entry({ revision: 2, numbers: [9] }), entry({ revision: 3, status: "draft", numbers: [8] }), entry({ targetRound: 1245 })];
    expect(currentExclusion(es, 1244)!.revision).toBe(2);
    expect(currentExclusion([...es, entry({ revision: 4, status: "withdrawn" })], 1244)).toBeNull(); // 철회하면 미등록으로 돌아간다 (이전 게시본으로 되돌아가지 않음)
    expect(currentExclusion([...es, entry({ revision: 4, status: "withdrawn" }), entry({ revision: 5 })], 1244)!.revision).toBe(5); // 철회 뒤 다시 게시하면 유효
    expect(currentExclusion(es, 9999)).toBeNull();
    expect(currentExclusion([], 1244)).toBeNull();
  });
});

describe("제외수 평가", () => {
  const d1244 = draws[1243]!; // [1,13,18,26,34,38] + 25, 2026-10-03
  it("나온 번호 수와 무작위 기대치", () => {
    const ev = evaluateExclusion(entry({ numbers: [1, 2, 3, 13, 25] }), d1244);
    expect(ev.mainHits).toBe(2); // 1, 13
    expect(ev.bonusHit).toBe(true); // 25
    expect(ev.expectedMainHits).toBeCloseTo((6 * 5) / 45);
    expect(ev.count).toBe(5);
  });
  it("추첨 전에 게시한 기록만 사전 기록이다 (추첨일 00:00 한국 시간 기준)", () => {
    expect(drawDeadline("2026-10-03")).toBe(Date.parse("2026-10-03T00:00:00+09:00"));
    expect(evaluateExclusion(entry({ publishedAt: "2026-10-02T23:59:00+09:00" }), d1244).preDraw).toBe(true);
    expect(evaluateExclusion(entry({ publishedAt: "2026-10-03T00:00:00+09:00" }), d1244).preDraw).toBe(false);
    expect(evaluateExclusion(entry({ publishedAt: "2026-10-04T10:00:00+09:00" }), d1244).preDraw).toBe(false);
  });
  it("평가 대상: 추첨이 끝난 회차의 사전 게시본 중 마지막 revision, 사후 수정본은 원래 발표처럼 평가하지 않는다", () => {
    const es = [
      entry({ revision: 1, numbers: [2, 3] }), // 사전
      entry({ revision: 2, numbers: [1, 13], publishedAt: "2026-10-02T20:00:00+09:00" }), // 사전, 더 최신
      entry({ revision: 3, numbers: [1, 13, 18, 26], publishedAt: "2026-10-04T09:00:00+09:00" }), // 사후 → 제외
      entry({ targetRound: 1245, numbers: [9] }), // 추첨 전 회차 → 평가 없음
      entry({ targetRound: 1243, status: "withdrawn", numbers: [9] }), // 철회(게시본 없음)
      entry({ targetRound: 1242, revision: 1, numbers: [9], publishedAt: "2026-09-18T09:00:00+09:00" }),
      entry({ targetRound: 1242, revision: 2, status: "withdrawn", numbers: [9], publishedAt: "2026-09-18T10:00:00+09:00" }), // 사전에 철회 → 평가 제외
    ];
    const t = evaluationTargets(es, draws);
    expect(t).toHaveLength(1);
    expect(t[0]!.entry.revision).toBe(2);
    expect(t[0]!.ev.mainHits).toBe(2);
    expect(evaluationTargets([], draws)).toEqual([]);
  });
});

describe("운영자 추천 필터", () => {
  const file = read("../public/data/operator-filters.json");
  it("저장소의 operator-filters.json이 유효하고 이력 필터를 쓰지 않는다", () => {
    expect(validateRecommendedFile(file)).toEqual({ ok: true, errors: [] });
    expect(file.filters.length).toBeGreaterThanOrEqual(1);
  });
  it("잘못된 추천 필터를 거부한다", () => {
    const base = file.filters[0];
    const bad = (f: unknown) => validateRecommendedFile({ schemaVersion: 1, filters: [f] }).ok;
    expect(bad({ ...base, rules: [{ key: "carry", min: 0, max: 1 }] })).toBe(false); // 이력 필터
    expect(bad({ ...base, rules: [{ key: "nope", min: 0 }] })).toBe(false);
    expect(bad({ ...base, rules: [{ key: "sum", min: 200, max: 100 }] })).toBe(false);
    expect(bad({ ...base, rules: [] })).toBe(false);
    expect(bad({ ...base, name: "" })).toBe(false);
    expect(validateRecommendedFile({ schemaVersion: 1, filters: [base, base] }).ok).toBe(false); // id 중복
  });
  it("범위는 과거 당첨번호의 가운데 90%에서 다시 계산한 값과 같다", () => {
    const rec = file.filters.find((f: any) => f.id === "central90-v1");
    const keys = rec.rules.map((r: any) => r.key);
    expect(centralRangeRules(draws, keys, 0.05)).toEqual(rec.rules);
    // 각 필터는 과거 회차의 90% 이상을 통과시킨다 (분위수 정의)
    for (const r of rec.rules) expect(draws.filter((d) => passesAll([r], d.numbers)).length / draws.length).toBeGreaterThanOrEqual(0.9);
  });
  it("저장된 근거 수치가 다시 계산한 값과 같다", async () => {
    const rec = file.filters.find((f: any) => f.id === "central90-v1");
    expect(rec.stats.basedOnRounds).toBe(draws.length);
    expect(draws.filter((d) => passesAll(rec.rules, d.numbers)).length).toBe(rec.stats.historicalPass);
    const space = await countSpace({ fixed: [], exclude: [], candidates: [], rules: rec.rules });
    expect(space.passed).toBe(rec.stats.spaceRemaining);
    expect(space.total).toBe(rec.stats.spaceTotal);
  }, 120000);
  it("분위수 규칙 만들기(작은 예)", () => {
    const mk = (n: number[], r: number): Draw => ({ round: r, date: "2020-01-04", numbers: n, bonus: 45 });
    const ds = Array.from({ length: 20 }, (_, i) => mk([1, 2, 3, 4, 5, 6 + i], i + 1));
    const r = centralRangeRules(ds, ["sum"], 0.1)[0]!;
    // 합: 21..40 (20개) → 하위 10% = 2개 제외, 상위 10% = 2개 제외
    expect(r).toEqual({ key: "sum", min: 23, max: 38 });
    expect(() => centralRangeRules(ds, ["carry"])).toThrow();
  });
});
