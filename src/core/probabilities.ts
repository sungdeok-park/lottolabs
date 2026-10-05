import { binom, TOTAL_COMBOS } from "./math";

export interface RankProbability {
  rank: 1 | 2 | 3 | 4 | 5;
  label: string;
  /** 해당 등수가 되는 서로 다른 조합 수 (한 장 기준) */
  ways: number;
  probability: number;
  /** "1 / N" 형태로 표시할 N */
  oneIn: number;
}

/**
 * 한 장이 각 등수에 해당할 정확한 확률 (공정한 6/45 추첨).
 *  2등: 본번호 5개 + 보너스 / 3등: 본번호 5개(보너스 제외) / 4등: 4개 / 5등: 3개
 *  보너스 번호는 본번호와 겹치지 않는 39개 중 하나다.
 */
export function rankProbabilities(): RankProbability[] {
  const ways: [1 | 2 | 3 | 4 | 5, string, number][] = [
    [1, "6개 일치", 1],
    [2, "5개 + 보너스", binom(6, 5)],
    [3, "5개 일치", binom(6, 5) * (45 - 6 - 1)],
    [4, "4개 일치", binom(6, 4) * binom(39, 2)],
    [5, "3개 일치", binom(6, 3) * binom(39, 3)],
  ];
  return ways.map(([rank, label, w]) => ({ rank, label, ways: w, probability: w / TOTAL_COMBOS, oneIn: TOTAL_COMBOS / w }));
}

/**
 * 서로 다른 N장을 샀을 때 기대 일치 개수 등 단순 지표는 장당 확률과 같다.
 * 같은 번호를 중복하지 않는다고 해서 한 장의 확률이 달라지지는 않는다.
 * 여기서는 "N장 모두 낙첨(등수 없음)"일 확률의 근사 (1−p)^N 을 제공한다. 장들이 서로 독립이라는 근사다.
 */
export function noPrizeApprox(tickets: number): number {
  const p = rankProbabilities().reduce((a, r) => a + r.probability, 0);
  return Math.pow(1 - p, tickets);
}
