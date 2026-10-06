import { FILTER_BY_KEY } from "./filters";
import { MAX_NUM } from "./metrics";
import type { Draw, FilterRule } from "./types";

/* ============ 운영자 제외수 ============ */

export type ExclusionStatus = "draft" | "published" | "withdrawn";

export interface ExclusionEntry {
  targetRound: number;
  /** 게시 시각(ISO). 추첨 전에 고정된 기록인지 판단하는 기준 */
  publishedAt: string;
  revision: number;
  status: ExclusionStatus;
  numbers: number[];
  methodVersion: string;
  description: string;
}

export interface ExclusionFile {
  schemaVersion: 1;
  updatedAt: string;
  entries: ExclusionEntry[];
}

export interface Report {
  ok: boolean;
  errors: string[];
}

export function validateExclusionFile(f: unknown): Report {
  const errors: string[] = [];
  const o = f as Partial<ExclusionFile> | null;
  if (!o || typeof o !== "object") return { ok: false, errors: ["파일 형식이 올바르지 않습니다."] };
  if (o.schemaVersion !== 1) errors.push("지원하지 않는 schemaVersion");
  if (!Array.isArray(o.entries)) return { ok: false, errors: [...errors, "entries 배열이 없습니다."] };
  const seen = new Set<string>();
  for (const e of o.entries) {
    const tag = `${e?.targetRound}회 r${e?.revision}`;
    if (!e || !Number.isInteger(e.targetRound) || e.targetRound < 1) { errors.push(`${tag}: targetRound가 올바르지 않습니다.`); continue; }
    if (!Number.isInteger(e.revision) || e.revision < 1) errors.push(`${tag}: revision은 1 이상의 정수입니다.`);
    if (!["draft", "published", "withdrawn"].includes(e.status)) errors.push(`${tag}: status가 올바르지 않습니다.`);
    if (!Array.isArray(e.numbers) || e.numbers.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_NUM)) errors.push(`${tag}: numbers는 1~45 정수여야 합니다.`);
    else if (new Set(e.numbers).size !== e.numbers.length) errors.push(`${tag}: numbers에 중복이 있습니다.`);
    else if (e.status === "published" && e.numbers.length === 0) errors.push(`${tag}: 게시된 항목은 번호가 1개 이상이어야 합니다.`);
    if (typeof e.publishedAt !== "string" || Number.isNaN(Date.parse(e.publishedAt))) errors.push(`${tag}: publishedAt이 올바른 시각이 아닙니다.`);
    if (typeof e.methodVersion !== "string" || !e.methodVersion.trim()) errors.push(`${tag}: methodVersion이 필요합니다.`);
    if (typeof e.description !== "string") errors.push(`${tag}: description이 필요합니다.`);
    const key = `${e.targetRound}:${e.revision}`;
    if (seen.has(key)) errors.push(`${tag}: 같은 회차·revision이 중복됩니다.`);
    seen.add(key);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 한 회차의 현재 유효 항목. 초안은 무시하고, 게시·철회 중 revision이 가장 높은 것이 게시본이면 그것,
 * 철회본이면 "철회됨"이므로 null (이전 게시본으로 되돌아가지 않는다).
 */
export function currentExclusion(entries: readonly ExclusionEntry[], round: number): ExclusionEntry | null {
  const last = entries.filter((e) => e.targetRound === round && e.status !== "draft").sort((a, b) => b.revision - a.revision)[0];
  return last && last.status === "published" ? last : null;
}

export interface ExclusionEvaluation {
  round: number;
  revision: number;
  /** 제외수 개수 */
  count: number;
  /** 제외수 중 실제 본번호로 나온 개수 (제외가 "맞았다"면 0에 가까울수록 좋음) */
  mainHits: number;
  bonusHit: boolean;
  /** 같은 개수를 무작위로 골랐을 때 본번호가 나올 기대 개수: 6 × count / 45 */
  expectedMainHits: number;
  /** 게시 시각이 추첨일 이전인가 (사후 등록은 원래 발표처럼 평가하지 않는다) */
  preDraw: boolean;
}

/** 추첨일 당일 00:00(한국 시간)보다 이전에 게시된 기록만 사전 기록으로 본다. */
export const drawDeadline = (drawDate: string) => Date.parse(`${drawDate}T00:00:00+09:00`);

export function evaluateExclusion(e: ExclusionEntry, d: Draw): ExclusionEvaluation {
  return {
    round: e.targetRound,
    revision: e.revision,
    count: e.numbers.length,
    mainHits: e.numbers.filter((n) => d.numbers.includes(n)).length,
    bonusHit: e.numbers.includes(d.bonus),
    expectedMainHits: (6 * e.numbers.length) / MAX_NUM,
    preDraw: Date.parse(e.publishedAt) < drawDeadline(d.date),
  };
}

/** 평가 대상: 추첨이 끝난 회차의 사전 게시본만, 회차마다 추첨 전 마지막 revision */
export function evaluationTargets(entries: readonly ExclusionEntry[], draws: readonly Draw[]): { entry: ExclusionEntry; draw: Draw; ev: ExclusionEvaluation }[] {
  const out: { entry: ExclusionEntry; draw: Draw; ev: ExclusionEvaluation }[] = [];
  const rounds = [...new Set(entries.map((e) => e.targetRound))].sort((a, b) => a - b);
  for (const r of rounds) {
    const draw = draws.find((d) => d.round === r);
    if (!draw) continue;
    const pre = entries.filter((e) => e.targetRound === r && e.status !== "draft" && Date.parse(e.publishedAt) < drawDeadline(draw.date)).sort((a, b) => b.revision - a.revision)[0];
    if (pre && pre.status === "published") out.push({ entry: pre, draw, ev: evaluateExclusion(pre, draw) });
  }
  return out;
}

/* ============ 운영자 추천 필터 ============ */

export interface RecommendedFilter {
  id: string;
  name: string;
  description: string;
  methodVersion: string;
  publishedAt: string;
  revision: number;
  rules: FilterRule[];
  /** 만들 때 계산한 근거 수치 */
  stats: { basedOnRounds: number; historicalPass: number; spaceRemaining: number; spaceTotal: number };
}

export interface RecommendedFile {
  schemaVersion: 1;
  updatedAt: string;
  filters: RecommendedFilter[];
}

export function validateRecommendedFile(f: unknown): Report {
  const errors: string[] = [];
  const o = f as Partial<RecommendedFile> | null;
  if (!o || typeof o !== "object") return { ok: false, errors: ["파일 형식이 올바르지 않습니다."] };
  if (o.schemaVersion !== 1) errors.push("지원하지 않는 schemaVersion");
  if (!Array.isArray(o.filters)) return { ok: false, errors: [...errors, "filters 배열이 없습니다."] };
  const ids = new Set<string>();
  for (const r of o.filters) {
    const tag = r?.id ?? "?";
    if (!r || typeof r.id !== "string" || !r.id) { errors.push("id가 필요합니다."); continue; }
    if (ids.has(r.id)) errors.push(`${tag}: id가 중복됩니다.`);
    ids.add(r.id);
    if (!r.name?.trim()) errors.push(`${tag}: name이 필요합니다.`);
    if (!Array.isArray(r.rules) || r.rules.length === 0) errors.push(`${tag}: rules가 비어 있습니다.`);
    else for (const rule of r.rules) {
      const def = FILTER_BY_KEY.get(rule.key);
      if (!def) errors.push(`${tag}: 알 수 없는 필터 ${rule.key}`);
      else if (def.needsHistory) errors.push(`${tag}: 이력이 필요한 필터(${rule.key})는 추천 필터에 넣을 수 없습니다.`);
      if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) errors.push(`${tag}: ${rule.key} 범위가 뒤집혔습니다.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 과거 당첨번호의 값 분포에서 가운데 구간(기본 5%~95%)을 범위로 하는 규칙을 만든다.
 * 값을 정렬한 뒤 lo = values[floor(n·p)], hi = values[ceil(n·(1−p)) − 1].
 */
export function centralRangeRules(draws: readonly Draw[], keys: readonly string[], tail = 0.05): FilterRule[] {
  return keys.map((key) => {
    const def = FILTER_BY_KEY.get(key);
    if (!def || def.needsHistory) throw new Error(`추천 필터에 쓸 수 없는 필터: ${key}`);
    const values = draws.map((d) => def.compute(d.numbers)).sort((a, b) => a - b);
    const n = values.length;
    return { key, min: values[Math.floor(n * tail)]!, max: values[Math.ceil(n * (1 - tail)) - 1]! };
  });
}

export const passesAll = (rules: readonly FilterRule[], numbers: readonly number[]) =>
  rules.every((r) => { const v = FILTER_BY_KEY.get(r.key)!.compute(numbers); return (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max); });
