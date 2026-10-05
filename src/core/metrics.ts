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

// ---- 확장 지표 ----
export const first = (c: Combo) => Math.min(...c);
export const last = (c: Combo) => Math.max(...c);
/** 첫 수와 끝 수의 차 */
export const span = (c: Combo) => last(c) - first(c);

function gaps(c: Combo): number[] {
  const s = sortCombo(c);
  return s.slice(1).map((n, i) => n - s[i]!);
}
/** 이웃한 두 수 사이 간격의 최솟값/최댓값 */
export const minGap = (c: Combo) => Math.min(...gaps(c));
export const maxGap = (c: Combo) => Math.max(...gaps(c));

/** 쌍둥이수(11,22,33,44) 개수 */
export const twinCount = (c: Combo) => count(c, (n) => n % 11 === 0);
/** 일의 자리가 같은 쌍의 개수 (같은 끝수가 3개면 3쌍) */
export function sameEndPairs(c: Combo): number {
  const f = new Array<number>(10).fill(0);
  for (const n of c) f[n % 10]!++;
  return f.reduce((a, k) => a + (k * (k - 1)) / 2, 0);
}
export const endDigitCount = (d: number) => (c: Combo) => count(c, (n) => n % 10 === d);
/** 번호대별 개수: 1=1~10, 2=11~20, 3=21~30, 4=31~40, 5=41~45 */
export const bandCount = (b: number) => (c: Combo) => count(c, (n) => Math.ceil(n / 10) === b);

/**
 * 용지(7칸×7줄): 가로 1줄=1~7, 2줄=8~14, … 6줄=36~42, 7줄=43~45. 세로 1칸=1,8,15,…,43 … 7칸=7,14,…,42.
 */
export const ticketRow = (n: number) => Math.ceil(n / 7);
export const ticketCol = (n: number) => ((n - 1) % 7) + 1;
export const ticketRows = (c: Combo) => new Set(c.map(ticketRow)).size;
export const ticketCols = (c: Combo) => new Set(c.map(ticketCol)).size;
/** 가로 r줄에 놓인 번호 개수 / 세로 k칸에 놓인 번호 개수 */
export const rowCount = (r: number) => (c: Combo) => count(c, (n) => ticketRow(n) === r);
export const colCount = (k: number) => (c: Combo) => count(c, (n) => ticketCol(n) === k);

/** k의 배수 개수 (k = 3~9) */
export const multipleCount = (k: number) => (c: Combo) => count(c, (n) => n % k === 0);
/** 1~45 안에 있는 k의 배수 개수 */
export const multiplesInRange = (k: number) => Math.floor(MAX_NUM / k);

// ---- 로또용지 공간 지표 (원본 lotto_paper 분석과 같은 정의) ----
// 용지 좌표: 행 = floor((n-1)/7), 열 = (n-1)%7 (0부터).
const coord = (n: number) => ({ r: Math.floor((n - 1) / 7), c: (n - 1) % 7 });

/** 활성 라인 수: 번호가 1개 이상 놓인 가로 라인 + 세로 라인의 수 (최대 14) */
export const paperActiveLines = (c: Combo) => ticketRows(c) + ticketCols(c);
export const paperMaxRow = (c: Combo) => Math.max(...[1, 2, 3, 4, 5, 6, 7].map((r) => rowCount(r)(c)));
export const paperMaxCol = (c: Combo) => Math.max(...[1, 2, 3, 4, 5, 6, 7].map((k) => colCount(k)(c)));

/** 같은 대각선(↘ r−c 같음, ↗ r+c 같음)에 놓인 번호 수의 최댓값 */
export function paperMaxDiagonal(c: Combo): number {
  const down = new Map<number, number>();
  const up = new Map<number, number>();
  for (const n of c) {
    const { r, c: k } = coord(n);
    down.set(r - k, (down.get(r - k) ?? 0) + 1);
    up.set(r + k, (up.get(r + k) ?? 0) + 1);
  }
  return Math.max(...down.values(), ...up.values());
}

/** 8방향으로 이웃한 번호끼리 묶었을 때 가장 큰 묶음의 크기 */
export function paperMaxCluster(c: Combo): number {
  const pts = c.map(coord);
  const parent = pts.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.abs(pts[i]!.r - pts[j]!.r) <= 1 && Math.abs(pts[i]!.c - pts[j]!.c) <= 1) parent[find(i)] = find(j);
    }
  }
  const size = new Map<number, number>();
  for (let i = 0; i < pts.length; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  return Math.max(...size.values());
}

/** 공간 패턴 코드: 0 분산, 1 혼합, 2 클러스터(3개 이상 인접), 3 대각선(4개 이상), 4 세로 직선(4개 이상), 5 가로 직선(4개 이상). 우선순위는 5→4→3→2→0→1. */
export function paperPattern(c: Combo): number {
  if (paperMaxRow(c) >= 4) return 5;
  if (paperMaxCol(c) >= 4) return 4;
  if (paperMaxDiagonal(c) >= 4) return 3;
  if (paperMaxCluster(c) >= 3) return 2;
  if (paperMaxRow(c) <= 1 && paperMaxCol(c) <= 1) return 0;
  return 1;
}
