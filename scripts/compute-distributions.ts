// 이력이 필요 없는 모든 필터에 대해, 전체 8,145,060 조합에서 값별 조합 수를 센다.
// 결과는 content/distributions.json 으로 저장하고(결정적인 수학적 결과라 저장소에 포함), 해설 페이지가 이를 사용한다.
// 실행: npx tsx scripts/compute-distributions.ts   (약 1분)
import { writeFileSync } from "node:fs";
import { FILTERS } from "../src/core/filters";
import { forEachCombo } from "../src/core/enumerate";
import { TOTAL_COMBOS } from "../src/core/math";

const fs = FILTERS.filter((f) => !f.needsHistory);
const counts = fs.map(() => new Map<number, number>());
let total = 0;
await forEachCombo({ fixed: [], exclude: [], candidates: [] }, (c) => {
  total++;
  for (let i = 0; i < fs.length; i++) {
    const v = fs[i]!.compute(c);
    const m = counts[i]!;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
});
if (total !== TOTAL_COMBOS) throw new Error(`총 조합 수가 ${total} 입니다`);
const out: Record<string, Record<string, number>> = {};
fs.forEach((f, i) => {
  const entries = [...counts[i]!.entries()].sort((a, b) => a[0] - b[0]);
  if (entries.reduce((a, [, n]) => a + n, 0) !== TOTAL_COMBOS) throw new Error(`${f.key} 합계 불일치`);
  out[f.key] = Object.fromEntries(entries);
});
writeFileSync(new URL("../content/distributions.json", import.meta.url), JSON.stringify({ total: TOTAL_COMBOS, filters: out }, null, 1) + "\n");
console.log(`필터 ${fs.length}개 분포 저장 (총 ${total.toLocaleString()} 조합)`);
