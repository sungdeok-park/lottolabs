// 운영자 추천 필터를 과거 당첨번호로 계산해 public/data/operator-filters.json 에 쓴다.
// 실행: npx tsx scripts/make-recommended.ts
import { readFileSync, writeFileSync } from "node:fs";
import { centralRangeRules, passesAll, type RecommendedFilter } from "../src/core/operator";
import { countSpace } from "../src/core/generate";
import { TOTAL_COMBOS } from "../src/core/math";
import type { Draw } from "../src/core/types";

const draws: Draw[] = JSON.parse(readFileSync(new URL("../public/data/draws.json", import.meta.url), "utf8")).draws;
const KEYS = ["sum", "endSum", "ac", "odd", "high", "consecPairs"];
const rules = centralRangeRules(draws, KEYS, 0.05);
const historicalPass = draws.filter((d) => passesAll(rules, d.numbers)).length;
const space = await countSpace({ fixed: [], exclude: [], candidates: [], rules });
const filter: RecommendedFilter = {
  id: "central90-v1",
  name: "과거 흐름 범위",
  description: `과거 ${draws.length}회 당첨번호에서 총합·끝수합·AC·홀수 개수·고번호 개수·연속쌍 각각이 가운데 90%(양쪽 5%씩 제외)에 드는 범위입니다. 과거 분포를 요약한 것이며 당첨 확률을 높이지 않습니다.`,
  methodVersion: "central90-v1",
  publishedAt: new Date().toISOString(),
  revision: 1,
  rules,
  stats: { basedOnRounds: draws.length, historicalPass, spaceRemaining: space.passed, spaceTotal: TOTAL_COMBOS },
};
writeFileSync(new URL("../public/data/operator-filters.json", import.meta.url), JSON.stringify({ schemaVersion: 1, updatedAt: filter.publishedAt, filters: [filter] }, null, 1) + "\n");
console.log(JSON.stringify(filter, null, 1));
