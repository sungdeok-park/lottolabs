import { poolOf } from "./generate";
import { PICK, sortCombo } from "./metrics";
import type { Combo } from "./types";

export interface EnumControl {
  shouldStop?: () => boolean;
  yieldEvery?: number;
  /** yieldEvery마다 지금까지 방문한 조합 수를 알린다 */
  onProgress?: (visited: number) => void;
}

/** 후보 공간의 모든 조합을 방문한다. 취소되면 false를 돌려준다. */
export async function forEachCombo(
  o: { fixed: number[]; exclude: number[]; candidates: number[] },
  visit: (c: Combo) => void,
  control: EnumControl = {},
): Promise<boolean> {
  const pool = poolOf(o.fixed, o.exclude, o.candidates);
  const k = PICK - o.fixed.length;
  if (k < 0 || pool.length < k) return true;
  const every = control.yieldEvery ?? 200_000;
  if (k === 0) {
    visit(sortCombo(o.fixed));
    return true;
  }
  const idx = Array.from({ length: k }, (_, i) => i);
  let tick = 0;
  for (;;) {
    visit(sortCombo([...o.fixed, ...idx.map((i) => pool[i]!)]));
    if (++tick % every === 0) {
      control.onProgress?.(tick);
      if (control.shouldStop?.()) return false;
      await new Promise((r) => setTimeout(r, 0));
    }
    let i = k - 1;
    while (i >= 0 && idx[i] === pool.length - k + i) i--;
    if (i < 0) return true;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}
