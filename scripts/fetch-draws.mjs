#!/usr/bin/env node
// 공식 회차 조회 주소에서 당첨 번호를 받아 public/data/draws.json 을 만들거나 이어서 갱신한다.
// 사용법: node scripts/fetch-draws.mjs [--base <URL 접두사>] [--max 회차] [--delay ms]
//   기본 base: https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=
// 응답 형식(JSON): { returnValue:"success", drwNo, drwNoDate, drwtNo1..6, bnusNo }
// 검증에 실패하거나 응답이 이상하면 기존 파일을 건드리지 않는다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const BASE = args.base ?? "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=";
const DELAY = Number(args.delay ?? 150);
const OUT = new URL("../public/data/draws.json", import.meta.url);

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { draws: [] };
const draws = [...(existing.draws ?? [])];
let next = (draws.at(-1)?.round ?? 0) + 1;
const max = Number(args.max ?? 5000);

const parse = (j, round) => {
  if (j.returnValue !== "success") return null; // 아직 추첨 전이거나 없는 회차
  const numbers = [1, 2, 3, 4, 5, 6].map((i) => Number(j[`drwtNo${i}`])).sort((a, b) => a - b);
  const d = { round: Number(j.drwNo), date: String(j.drwNoDate), numbers, bonus: Number(j.bnusNo) };
  const ok = d.round === round && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && new Set(numbers).size === 6 && numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 45) && Number.isInteger(d.bonus) && d.bonus >= 1 && d.bonus <= 45 && !numbers.includes(d.bonus);
  if (!ok) throw new Error(`${round}회 응답 검증 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return d;
};

let added = 0;
for (; next <= max; next++) {
  const res = await fetch(BASE + next, { headers: { "user-agent": "lotto-workroom-fetch/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${next}회)`);
  let json;
  try { json = await res.json(); } catch { throw new Error(`${next}회: JSON이 아닌 응답입니다. 주소나 응답 형식이 바뀌었을 수 있습니다.`); }
  const d = parse(json, next);
  if (!d) break;
  draws.push(d);
  added++;
  if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
}
if (!draws.length) { console.error("받은 회차가 없습니다. 기존 파일을 유지합니다."); process.exit(1); }
writeFileSync(OUT, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), source: BASE.split("?")[0], draws }, null, 1) + "\n");
console.log(`${added}개 회차 추가, 총 ${draws.length}개 (최신 ${draws.at(-1).round}회)`);
