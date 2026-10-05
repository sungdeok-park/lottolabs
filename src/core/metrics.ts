import type { Combo } from "./types";

export const MAX_NUM = 45;
export const PICK = 6;
/** 저번호 1~22, 고번호 23~45 */
export const HIGH_FROM = 23;

const PRIMES = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43]);
const SQUARES = new Set([1, 4, 9, 16, 25, 36]);
const TRIANGULAR = new Set([1, 3, 6, 10, 15, 21, 28, 36, 45]);

export const isPrime = (n: number) => PRIMES.has(n);
/** 1은 소수도 합성수도 아니다. */
export const isComposite = (n: number) => n > 1 && !PRIMES.has(n);
export const isSquare = (n: number) => SQUARES.has(n);
export const isTriangular = (n: number) => TRIANGULAR.has(n);

const count = (c: Combo, pred: (n: number) => boolean) => c.filter(pred).length;

export const sum = (c: Combo) => c.reduce((a, b) => a + b, 0);
export const endDigitSum = (c: Combo) => c.reduce((a, b) => a + (b % 10), 0);
export const oddCount = (c: Combo) => count(c, (n) => n % 2 === 1);
export const highCount = (c: Combo) => count(c, (n) => n >= HIGH_FROM);

/** AC: 모든 두 수 차이의 서로 다른 값 개수 − (6−1). 범위 0~10. */
export function acValue(c: Combo): number {
  const diffs = new Set<number>();
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) diffs.add(Math.abs(c[j]! - c[i]!));
  }
  return diffs.size - (c.length - 1);
}

/** 연속쌍: 바로 이웃한 두 수의 차가 1인 쌍의 개수. 예) 7,8,9 → 2쌍. */
export function consecutivePairs(c: Combo): number {
  let n = 0;
  for (let i = 1; i < c.length; i++) if (c[i]! - c[i - 1]! === 1) n++;
  return n;
}

/** 연번(최장 연속 길이): 연속으로 이어진 가장 긴 묶음의 길이. 없으면 1. 예) 7,8,9 → 3. */
export function longestRun(c: Combo): number {
  let best = 1;
  let run = 1;
  for (let i = 1; i < c.length; i++) {
    run = c[i]! - c[i - 1]! === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

export const primeCount = (c: Combo) => count(c, isPrime);
export const compositeCount = (c: Combo) => count(c, isComposite);
export const squareCount = (c: Combo) => count(c, isSquare);
export const triangularCount = (c: Combo) => count(c, isTriangular);
export const multipleOf3Count = (c: Combo) => count(c, (n) => n % 3 === 0);
export const multipleOf5Count = (c: Combo) => count(c, (n) => n % 5 === 0);

/** 서로 다른 끝수(일의 자리)의 개수 */
export const distinctEndDigits = (c: Combo) => new Set(c.map((n) => n % 10)).size;

/** 번호대: 1~10, 11~20, 21~30, 31~40, 41~45 중 번호가 있는 구간 수 */
export function bandsUsed(c: Combo): number {
  return new Set(c.map((n) => Math.ceil(n / 10))).size;
}

export const comboKey = (c: Combo) => [...c].sort((a, b) => a - b).join("-");
export const sortCombo = (c: readonly number[]): number[] => [...c].sort((a, b) => a - b);

export function isValidCombo(c: readonly number[]): boolean {
  if (c.length !== PICK) return false;
  const seen = new Set<number>();
  for (const n of c) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_NUM || seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}
