import type { Combo, Draw } from "./types";

export type Rank = 1 | 2 | 3 | 4 | 5 | null;

export interface MatchResult {
  matched: number;
  bonus: boolean;
  rank: Rank;
}

/** 6개=1등, 5개+보너스=2등, 5개=3등, 4개=4등, 3개=5등. 보너스는 본번호 일치 수에 더하지 않는다. */
export function matchDraw(c: Combo, d: Draw): MatchResult {
  const matched = c.filter((n) => d.numbers.includes(n)).length;
  const bonus = c.includes(d.bonus);
  let rank: Rank = null;
  if (matched === 6) rank = 1;
  else if (matched === 5 && bonus) rank = 2;
  else if (matched === 5) rank = 3;
  else if (matched === 4) rank = 4;
  else if (matched === 3) rank = 5;
  return { matched, bonus, rank };
}
