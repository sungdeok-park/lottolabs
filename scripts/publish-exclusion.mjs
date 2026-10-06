#!/usr/bin/env node
// 운영자 제외수를 public/data/exclusions.json 에 게시·수정·철회한다. 검증에 실패하면 파일을 바꾸지 않는다.
//   게시/수정: node scripts/publish-exclusion.mjs publish --round 1245 --numbers 3,8,14,22 --method v1 --desc "설명"
//   철회:      node scripts/publish-exclusion.mjs withdraw --round 1245
// 같은 회차를 다시 게시하면 revision이 1 늘어난다. 이전 revision은 이력으로 남는다(삭제하지 않음).
// 추첨 후에 게시한 기록은 앱에서 "사후 등록"으로 표시되어 성과 평가에서 제외된다.
import { readFileSync, writeFileSync } from "node:fs";

const [cmd, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((a, v, i) => (v.startsWith("--") ? [...a, [v.slice(2), rest[i + 1]]] : a), []));
const FILE = new URL("../public/data/exclusions.json", import.meta.url);
const file = JSON.parse(readFileSync(FILE, "utf8"));
const round = Number(args.round);
if (!Number.isInteger(round) || round < 1) { console.error("--round 가 필요합니다."); process.exit(2); }
const rev = Math.max(0, ...file.entries.filter((e) => e.targetRound === round).map((e) => e.revision)) + 1;
const now = new Date().toISOString();
let entry;
if (cmd === "publish") {
  const numbers = String(args.numbers ?? "").split(/[,\s]+/).filter(Boolean).map(Number);
  if (!numbers.length || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 45) || new Set(numbers).size !== numbers.length) { console.error("--numbers 는 1~45 사이 중복 없는 번호여야 합니다."); process.exit(2); }
  if (!args.method) { console.error("--method (methodVersion) 가 필요합니다."); process.exit(2); }
  entry = { targetRound: round, publishedAt: now, revision: rev, status: "published", numbers: numbers.sort((a, b) => a - b), methodVersion: args.method, description: args.desc ?? "" };
} else if (cmd === "withdraw") {
  const cur = file.entries.filter((e) => e.targetRound === round && e.status !== "draft").sort((a, b) => b.revision - a.revision)[0];
  if (!cur || cur.status !== "published") { console.error("철회할 게시본이 없습니다."); process.exit(1); }
  entry = { ...cur, publishedAt: now, revision: rev, status: "withdrawn", description: args.desc ?? "철회" };
} else { console.error("사용법: publish | withdraw"); process.exit(2); }
file.entries.push(entry);
file.updatedAt = now;
writeFileSync(FILE, JSON.stringify(file, null, 1) + "\n");
console.log(`${cmd}: ${round}회 revision ${rev} (${entry.status})`);
