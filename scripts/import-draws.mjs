#!/usr/bin/env node
// 사용법: node scripts/import-draws.mjs <draws.csv> [출처 설명]
// CSV 열: round,date,n1,n2,n3,n4,n5,n6,bonus  (헤더 줄 허용)
// 검증을 통과해야만 public/data/draws.json을 덮어쓴다. 실패하면 기존 파일을 유지한다.
import { readFileSync, writeFileSync } from "node:fs";

const [file, source = "수동 CSV 가져오기"] = process.argv.slice(2);
if (!file) { console.error("CSV 파일 경로가 필요합니다."); process.exit(2); }

const draws = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d/.test(l)).map((l) => {
  const p = l.split(",").map((x) => x.trim());
  const nums = p.slice(2, 8).map(Number);
  return { round: Number(p[0]), date: p[1], numbers: nums.sort((a, b) => a - b), bonus: Number(p[8]) };
});

const errors = [];
let prev = 0;
for (const d of draws) {
  const tag = `${d.round}회`;
  if (d.round <= prev) errors.push(`${tag}: 회차 순서/중복`);
  prev = d.round;
  if (new Set(d.numbers).size !== 6 || d.numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 45)) errors.push(`${tag}: 본번호`);
  if (!Number.isInteger(d.bonus) || d.bonus < 1 || d.bonus > 45 || d.numbers.includes(d.bonus)) errors.push(`${tag}: 보너스`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) errors.push(`${tag}: 날짜 형식`);
}
if (errors.length || !draws.length) {
  console.error("검증 실패, 기존 파일을 유지합니다:\n" + (errors.slice(0, 20).join("\n") || "데이터 없음"));
  process.exit(1);
}
writeFileSync(new URL("../public/data/draws.json", import.meta.url), JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), source, draws }, null, 1) + "\n");
console.log(`${draws.length}개 회차 저장 (최신 ${draws.at(-1).round}회)`);
