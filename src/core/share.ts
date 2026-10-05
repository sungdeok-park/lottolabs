import { isValidCombo, sortCombo } from "./metrics";
import type { Combo } from "./types";

export const MAX_SHARE_COMBOS = 30;
export const MAX_FRAGMENT_LENGTH = 1200;

export interface SharePayload {
  round: number;
  combos: Combo[];
}

/** 형식: v1.<회차>.<12자리 조합>,<12자리 조합>... 예) v1.1200.030814223142,051119273445 */
export function encodeShare(p: SharePayload): string {
  if (p.combos.length === 0 || p.combos.length > MAX_SHARE_COMBOS) throw new Error("공유 조합 수가 범위를 벗어났습니다.");
  const body = p.combos.map((c) => sortCombo(c).map((n) => String(n).padStart(2, "0")).join("")).join(",");
  return `v1.${p.round}.${body}`;
}

export type ShareParse = { ok: true; payload: SharePayload } | { ok: false; error: string };

export function decodeShare(fragment: string): ShareParse {
  const s = fragment.replace(/^#/, "");
  if (s.length > MAX_FRAGMENT_LENGTH) return { ok: false, error: "공유 데이터가 너무 큽니다." };
  const m = /^v1\.(\d{1,5})\.([0-9,]+)$/.exec(s);
  if (!m) return { ok: false, error: "공유 형식이 올바르지 않습니다." };
  const round = Number(m[1]);
  const parts = m[2]!.split(",");
  if (parts.length > MAX_SHARE_COMBOS) return { ok: false, error: "조합 수가 너무 많습니다." };
  const combos: Combo[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (!/^\d{12}$/.test(part)) return { ok: false, error: "조합 형식이 올바르지 않습니다." };
    const c = part.match(/\d{2}/g)!.map(Number);
    if (!isValidCombo(c)) return { ok: false, error: "1~45 사이 중복 없는 6개 번호가 아닌 조합이 있습니다." };
    const sorted = sortCombo(c);
    if (sorted.some((n, i) => n !== c[i])) return { ok: false, error: "번호가 오름차순이 아닙니다." };
    const key = part;
    if (!seen.has(key)) {
      seen.add(key);
      combos.push(sorted);
    }
  }
  if (round < 1) return { ok: false, error: "회차가 올바르지 않습니다." };
  return { ok: true, payload: { round, combos } };
}

export function formatCombo(c: Combo): string {
  return sortCombo(c).map((n) => String(n).padStart(2, "0")).join(" ");
}

export function shareText(round: number, combos: Combo[], url: string, name = "로또 워크룸"): string {
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lines = combos.map((c, i) => `${labels[i] ?? i + 1} ${formatCombo(c)}`);
  return [`[${name}] 제${round}회 · 내 조합 ${combos.length}개`, ...lines, `전달받은 조합 확인: ${url}`, "조건 기반 생성 번호이며 당첨을 보장하지 않습니다."].join("\n");
}

export function mailtoLink(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
