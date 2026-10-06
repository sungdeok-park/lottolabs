import type { Combo, Draw, FilterRule } from "./core/types";
import { latestRound, validateDrawFile } from "./core/draws";
import { load, save } from "./storage";

export interface Picks {
  fixed: number[];
  exclude: number[];
  candidates: number[];
}

export interface StoredCombo {
  numbers: Combo;
}

export interface Batch {
  id: string;
  name: string;
  round: number;
  createdAt: string;
  source: "generated" | "imported";
  memo: string;
  combos: StoredCombo[];
  snapshot?: { rules: FilterRule[]; picks: Picks };
}

export interface Preset {
  name: string;
  rules: FilterRule[];
  picks: Picks;
}

export interface DrawStatus {
  state: "loading" | "ok" | "empty" | "error";
  draws: Draw[];
  updatedAt?: string;
  source?: string;
  message?: string;
}

export const state = {
  rules: [] as FilterRule[],
  picks: { fixed: [], exclude: [], candidates: [] } as Picks,
  batches: [] as Batch[],
  presets: [] as Preset[],
  targetRound: 0,
  draws: { state: "loading", draws: [] } as DrawStatus,
  lastSaveOk: true,
};

export const nextRound = () => (latestRound(state.draws.draws) || 0) + 1;

export async function init() {
  state.rules = await load("rules", []);
  state.picks = await load("picks", { fixed: [], exclude: [], candidates: [] });
  state.batches = await load("batches", []);
  state.presets = await load("presets", []);
  state.targetRound = await load("targetRound", 0);
}

export async function persist(): Promise<boolean> {
  const results = await Promise.all([
    save("rules", state.rules),
    save("picks", state.picks),
    save("batches", state.batches),
    save("presets", state.presets),
    save("targetRound", state.targetRound),
  ]);
  state.lastSaveOk = results.every(Boolean);
  return state.lastSaveOk;
}

declare global {
  interface Window { __DRAWS__?: unknown }
}

export async function loadDraws(baseUrl: string) {
  try {
    // 단일 파일 빌드(더블클릭으로 여는 버전)는 당첨 이력을 파일 안에 넣어 둔다.
    let json: any;
    if (window.__DRAWS__ !== undefined) json = window.__DRAWS__;
    else {
      const res = await fetch(`${baseUrl}data/draws.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    }
    const report = validateDrawFile(json);
    if (!report.ok) throw new Error(`당첨 이력 검증 실패: ${report.errors[0]}`);
    state.draws = json.draws.length
      ? { state: "ok", draws: json.draws, updatedAt: json.updatedAt, source: json.source }
      : { state: "empty", draws: [], updatedAt: json.updatedAt, source: json.source };
  } catch (e) {
    state.draws = { state: "error", draws: [], message: e instanceof Error ? e.message : String(e) };
  }
}
