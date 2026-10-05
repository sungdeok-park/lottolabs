import { it } from "vitest";
import { FILTERS } from "../src/core/filters";
import { forEachCombo } from "../src/core/enumerate";
it("선언한 필터 도메인이 전체 8,145,060 조합의 실제 최솟값·최댓값과 일치한다", async () => {
  const fs = FILTERS.filter((f) => !f.needsHistory);
  const lo = fs.map(() => Infinity), hi = fs.map(() => -Infinity);
  await forEachCombo({ fixed: [], exclude: [], candidates: [] }, (c) => {
    for (let i = 0; i < fs.length; i++) { const v = fs[i]!.compute(c); if (v < lo[i]!) lo[i] = v; if (v > hi[i]!) hi[i] = v; }
  });
  const bad = fs.filter((f, i) => f.domain[0] !== lo[i] || f.domain[1] !== hi[i]).map((f) => `${f.key}: 선언 ${f.domain} 실제 ${[lo[fs.indexOf(f)], hi[fs.indexOf(f)]]}`);
  if (bad.length) throw new Error("MISMATCH\n" + bad.join("\n"));
}, 900000);
