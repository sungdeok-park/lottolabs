import { h } from "./dom";
import type { Combo } from "../core/types";
import { sortCombo } from "../core/metrics";

export function balls(c: Combo, hit?: { numbers: readonly number[]; bonus: number }, size?: "lg") {
  const wrap = h("span", { class: "balls" });
  for (const n of sortCombo(c)) {
    const isHit = hit?.numbers.includes(n);
    const isBonus = hit && !isHit && hit.bonus === n;
    wrap.append(
      h(
        "span",
        {
          class: `ball b${Math.ceil(n / 10)}${isHit ? " hit" : ""}${isBonus ? " bonus" : ""}${size ? " " + size : ""}`,
          title: isHit ? "본번호 일치" : isBonus ? "보너스 일치" : undefined,
        },
        String(n).padStart(2, "0"),
        isHit ? h("span", { class: "sr" }, " (일치)") : isBonus ? h("span", { class: "sr" }, " (보너스 일치)") : null,
      ),
    );
  }
  return wrap;
}

export function notice(kind: "info" | "warn" | "error" | "ok", ...kids: (Node | string)[]) {
  const icon = { info: "i", warn: "!", error: "×", ok: "✓" }[kind];
  return h("div", { class: `notice ${kind}`, role: kind === "error" ? "alert" : "status" }, h("span", { class: "ic", "aria-hidden": "true" }, icon), h("div", {}, ...kids));
}

export const DISCLAIMER = "필터는 번호를 줄여 줄 뿐, 한 조합의 당첨 확률을 높이지 않습니다. 이 도구는 당첨을 보장하거나 예측하지 않습니다.";

export function download(name: string, text: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: `${mime};charset=utf-8` }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const fmtDate = (iso: string) => iso.slice(0, 16).replace("T", " ");
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
