/** 이항계수 (정확한 정수, 2^53 이내 범위에서 사용) */
export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

export const TOTAL_COMBOS = 8_145_060; // C(45,6)

const POP16 = new Uint8Array(1 << 16);
for (let i = 1; i < POP16.length; i++) POP16[i] = POP16[i >> 1]! + (i & 1);
export const popcount16 = (x: number) => POP16[x & 0xffff]!;

/** 0..n-1 에서 k개를 고른 모든 부분집합을 비트마스크로 (n ≤ 30) */
export function subsetMasks(n: number, k: number): number[] {
  const out: number[] = [];
  const rec = (start: number, left: number, mask: number) => {
    if (left === 0) return void out.push(mask);
    for (let i = start; i <= n - left; i++) rec(i + 1, left - 1, mask | (1 << i));
  };
  rec(0, k, 0);
  return out;
}
