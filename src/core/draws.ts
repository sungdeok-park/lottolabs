import { MAX_NUM, PICK, isValidCombo } from "./metrics";
import type { Draw, HistoryContext } from "./types";

export interface DrawFile {
  schemaVersion: 1;
  updatedAt: string;
  source: string;
  draws: Draw[];
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateDrawFile(f: unknown): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const o = f as Partial<DrawFile> | null;
  if (!o || typeof o !== "object") return { ok: false, errors: ["파일 형식이 올바르지 않습니다."], warnings };
  if (o.schemaVersion !== 1) errors.push("지원하지 않는 schemaVersion");
  if (!Array.isArray(o.draws)) return { ok: false, errors: [...errors, "draws 배열이 없습니다."], warnings };
  let prev = 0;
  for (const d of o.draws) {
    const tag = `${d?.round}회`;
    if (!d || !Number.isInteger(d.round) || d.round < 1) {
      errors.push(`${tag}: 회차가 올바르지 않습니다.`);
      continue;
    }
    if (d.round <= prev) errors.push(`${tag}: 회차가 오름차순·중복 없음이 아닙니다.`);
    else if (prev && d.round !== prev + 1) warnings.push(`${prev}회 다음이 ${d.round}회입니다 (누락 가능).`);
    prev = Math.max(prev, d.round);
    if (!Array.isArray(d.numbers) || !isValidCombo(d.numbers)) errors.push(`${tag}: 본번호가 올바르지 않습니다.`);
    else if (d.numbers.some((n, i) => i > 0 && n < d.numbers[i - 1]!)) errors.push(`${tag}: 본번호가 오름차순이 아닙니다.`);
    if (!Number.isInteger(d.bonus) || d.bonus < 1 || d.bonus > MAX_NUM || d.numbers?.includes(d.bonus)) errors.push(`${tag}: 보너스 번호가 올바르지 않습니다.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) errors.push(`${tag}: 날짜 형식은 YYYY-MM-DD 입니다.`);
  }
  void PICK;
  return { ok: errors.length === 0, errors, warnings };
}

/** 목표 회차 이전 회차만 반환한다. */
export function historyBefore(draws: readonly Draw[], targetRound: number): HistoryContext {
  return { draws: draws.filter((d) => d.round < targetRound), targetRound };
}

export const latestRound = (draws: readonly Draw[]) => draws.reduce((a, d) => Math.max(a, d.round), 0);
