import { binom, popcount16, subsetMasks } from "./math";
import { PICK, sortCombo } from "./metrics";
import type { Combo } from "./types";

/**
 * 휠(커버리지) 조합.
 * 번호군(pool)에서 당첨 본번호 6개 중 t개가 번호군 안에 있다면, 만들어진 조합 중 하나는 그 t개 중 m개 이상을 포함한다.
 * 이는 조건부 보장이며 한 장의 당첨 확률을 높이지 않는다. 그리디 방식이라 최소 장수를 보장하지 않는다.
 */
export interface WheelSpec {
  pool: number[];
  /** 번호군 안에 들어온다고 가정하는 당첨 번호 개수 (m ≤ t ≤ 6) */
  t: number;
  /** 보장하려는 최소 일치 개수 */
  m: number;
}

export const WHEEL_MAX_POOL = 16;

export interface WheelResult {
  tickets: Combo[];
  /** 모든 경우를 덮었는지 (그리디는 항상 true, 중단 시 false) */
  complete: boolean;
  /** 검증 대상 경우의 수 C(v,t) */
  cases: number;
  fullWheelSize: number;
}

export function checkWheelSpec(s: WheelSpec): string | null {
  const v = s.pool.length;
  if (new Set(s.pool).size !== v || s.pool.some((n) => !Number.isInteger(n) || n < 1 || n > 45)) return "번호군은 1~45 사이 중복 없는 번호여야 합니다.";
  if (v < PICK) return "번호군은 6개 이상이어야 합니다.";
  if (v > WHEEL_MAX_POOL) return `번호군은 최대 ${WHEEL_MAX_POOL}개까지 지원합니다.`;
  if (!Number.isInteger(s.t) || !Number.isInteger(s.m) || s.m < 1 || s.m > s.t || s.t > PICK) return "조건은 1 ≤ m ≤ t ≤ 6 이어야 합니다.";
  if (s.t > v) return "t는 번호군 크기를 넘을 수 없습니다.";
  return null;
}

/** 전체 휠: 번호군에서 만들 수 있는 모든 6개 조합 */
export function fullWheel(pool: number[], cap = 5000): Combo[] | null {
  if (binom(pool.length, PICK) > cap) return null;
  return subsetMasks(pool.length, PICK).map((mask) => sortCombo(pool.filter((_, i) => mask & (1 << i))));
}

export function abbreviatedWheel(s: WheelSpec): WheelResult {
  const err = checkWheelSpec(s);
  if (err) throw new Error(err);
  const v = s.pool.length;
  const cands = subsetMasks(v, PICK);
  const cases = subsetMasks(v, s.t);
  const U = cases.length;
  const words = Math.ceil(U / 32);
  const cover = cands.map((tm) => {
    const bits = new Uint32Array(words);
    for (let j = 0; j < U; j++) if (popcount16(tm & cases[j]!) >= s.m) bits[j >> 5]! |= 1 << (j & 31);
    return bits;
  });
  const uncovered = new Uint32Array(words);
  for (let j = 0; j < U; j++) uncovered[j >> 5]! |= 1 << (j & 31);
  const pop32 = (x: number) => {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  };
  const gainOf = (i: number) => {
    let g = 0;
    const b = cover[i]!;
    for (let w = 0; w < words; w++) g += pop32(b[w]! & uncovered[w]!);
    return g;
  };
  const stale = cands.map((_, i) => gainOf(i));
  let remaining = U;
  const picked: number[] = [];
  while (remaining > 0) {
    // 지연 그리디: 이득은 줄기만 하므로 오래된 값이 상한이다
    let best = -1;
    for (;;) {
      let bi = -1, bv = -1;
      for (let i = 0; i < stale.length; i++) if (stale[i]! > bv) { bv = stale[i]!; bi = i; }
      const fresh = gainOf(bi);
      stale[bi] = fresh;
      let other = -1;
      for (let i = 0; i < stale.length; i++) if (i !== bi && stale[i]! > other) other = stale[i]!;
      if (fresh >= other) { best = bi; break; }
    }
    if (stale[best]! <= 0) break;
    picked.push(best);
    const b = cover[best]!;
    for (let w = 0; w < words; w++) {
      remaining -= pop32(b[w]! & uncovered[w]!);
      uncovered[w] = uncovered[w]! & ~b[w]!;
    }
    stale[best] = 0;
  }
  const tickets = picked.map((i) => sortCombo(s.pool.filter((_, k) => cands[i]! & (1 << k))));
  return { tickets, complete: remaining === 0, cases: U, fullWheelSize: cands.length };
}

/** 조건을 실제로 모두 만족하는지 전수 검증한다. 어긴 경우의 번호 하나를 돌려준다. */
export function verifyWheel(s: WheelSpec, tickets: readonly Combo[]): { ok: boolean; counterexample?: number[] } {
  const idx = new Map(s.pool.map((n, i) => [n, i]));
  const tmasks = tickets.map((t) => t.reduce((a, n) => a | (idx.has(n) ? 1 << idx.get(n)! : 0), 0));
  for (const w of subsetMasks(s.pool.length, s.t)) {
    if (!tmasks.some((tm) => popcount16(tm & w) >= s.m)) return { ok: false, counterexample: s.pool.filter((_, i) => w & (1 << i)) };
  }
  return { ok: true };
}
