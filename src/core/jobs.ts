import { diagnose, type Diagnosis } from "./diagnose";
import { historyBefore } from "./draws";
import { countSpace, poolOf, type CountResult } from "./generate";
import { PICK } from "./metrics";
import { binom } from "./math";
import type { Draw, FilterRule } from "./types";

/** Web Worker(또는 메인 스레드)에서 돌리는 무거운 계산 작업. 구조 복제로 전달 가능한 값만 담는다. */
export interface JobRequest {
  kind: "count" | "diagnose";
  picks: { fixed: number[]; exclude: number[]; candidates: number[] };
  rules: FilterRule[];
  /** 당첨 이력(없으면 빈 배열). targetRound 이전 회차만 사용한다. */
  draws: Draw[];
  targetRound: number;
}

export type JobMessage =
  | { type: "progress"; visited: number; total: number }
  | { type: "done"; kind: "count"; result: CountResult }
  | { type: "done"; kind: "diagnose"; result: Diagnosis }
  | { type: "error"; message: string };

/** 후보 공간의 전체 조합 수 (필터 적용 전) */
export function spaceSize(picks: JobRequest["picks"]): number {
  const need = PICK - picks.fixed.length;
  const pool = poolOf(picks.fixed, picks.exclude, picks.candidates);
  return need < 0 ? 0 : binom(pool.length, need);
}

export async function runJob(req: JobRequest, post: (m: JobMessage) => void, shouldStop?: () => boolean): Promise<void> {
  try {
    const total = spaceSize(req.picks);
    const history = req.draws.length ? historyBefore(req.draws, req.targetRound) : undefined;
    const control = { shouldStop, onProgress: (visited: number) => post({ type: "progress", visited, total }) };
    const base = { ...req.picks, rules: req.rules, history };
    if (req.kind === "count") post({ type: "done", kind: "count", result: await countSpace(base, control) });
    else post({ type: "done", kind: "diagnose", result: await diagnose(base, control) });
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
