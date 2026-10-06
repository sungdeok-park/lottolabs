import { ruleAccepts, type FilterDef } from "../core/filters";
import type { FilterRule } from "../core/types";
import { h } from "./dom";

export interface DistData {
  /** 값 → 개수 */
  counts: Map<number, number>;
  total: number;
  unit: string; // "조합" | "회차"
}

const MAX_COLS = 26;

/**
 * 분포 막대 차트: 값마다 막대 하나. 막대를 눌러 허용할 값을 고른다(값이 많으면 구간 막대 + 최소·최대 입력).
 * 마크: 가는 막대, 위쪽만 4px 둥근 끝, 기준선에 붙임, 선택한 막대만 직접 값 표시, 읽기 줄과 표 보기를 함께 제공.
 */
export function distChart(def: FilterDef, data: DistData, rule: FilterRule | undefined, onToggle: (value: number) => void): HTMLElement {
  const [lo, hi] = def.domain;
  const span = hi - lo + 1;
  const binned = span > MAX_COLS;
  const binSize = binned ? Math.ceil(span / MAX_COLS) : 1;
  const bins: { from: number; to: number; count: number }[] = [];
  for (let v = lo; v <= hi; v += binSize) bins.push({ from: v, to: Math.min(hi, v + binSize - 1), count: 0 });
  for (const [v, c] of data.counts) {
    const b = bins[Math.floor((v - lo) / binSize)];
    if (b) b.count += c;
  }
  // 값이 몰린 구간만 보여 준다: 앞뒤의 빈 막대는 잘라낸다
  let first = 0, last = bins.length - 1;
  while (first < last && bins[first]!.count === 0) first++;
  while (last > first && bins[last]!.count === 0) last--;
  const shown = bins.slice(first, last + 1);
  const max = Math.max(1, ...shown.map((b) => b.count));
  const accepts = (b: { from: number; to: number }) => {
    if (!rule) return false;
    for (let v = b.from; v <= b.to; v++) if (ruleAccepts(rule, v)) return true;
    return false;
  };
  const hasConstraint = !!rule && (!!rule.values?.length || rule.min !== undefined || rule.max !== undefined);
  const pctOf = (n: number) => ((n / data.total) * 100).toFixed(data.total > 1000 ? 2 : 1);
  const label = (b: { from: number; to: number }) => (b.from === b.to ? String(b.from) : `${b.from}–${b.to}`);
  const readout = h("div", { class: "readout", "aria-live": "polite" }, binned ? "구간에 마우스를 올리면 개수를 볼 수 있습니다. 범위는 아래 최소·최대로 정합니다." : "막대를 눌러 허용할 값을 고르세요.");

  const cols = h("div", { class: "cols", role: binned ? "img" : "group", "aria-label": `${def.label} 분포` });
  for (const b of shown) {
    const on = hasConstraint && accepts(b);
    const text = `${label(b)}: ${b.count.toLocaleString()}${data.unit === "조합" ? "개 조합" : "회"} (${pctOf(b.count)}%)`;
    const mark = h("span", { class: "m", style: `height:${Math.max(1, (b.count / max) * 100).toFixed(1)}%` });
    const kids = [h("span", { class: "v" }, on && shown.length <= 14 ? pctOf(b.count) + "%" : ""), mark];
    const show = () => (readout.textContent = text);
    const el = binned
      ? h("span", { class: `col${on ? " in" : ""}`, title: text, onmouseenter: show }, ...kids)
      : h("button", { type: "button", class: "col", "aria-pressed": String(on), "aria-label": text, title: text, onclick: () => onToggle(b.from), onmouseenter: show, onfocus: show }, ...kids);
    // 값 라벨을 막대 위에 놓기 위해 높이를 계산해 bottom 지정
    (kids[0] as HTMLElement).style.bottom = `calc(${Math.max(1, (b.count / max) * 100).toFixed(1)}% + 2px)`;
    cols.append(el);
  }
  const axis = h("div", { class: "axis" }, ...shown.map((b, i) => h("span", {}, binned ? (i % Math.ceil(shown.length / 8) === 0 ? String(b.from) : "") : label(b))));
  return h("div", { class: "chart" }, cols, axis, readout);
}

export function distTable(def: FilterDef, data: DistData): HTMLElement {
  const rows = [...data.counts.entries()].sort((a, b) => a[0] - b[0]);
  return h(
    "div",
    { class: "scroll" },
    h(
      "table",
      {},
      h("caption", {}, `${def.label} 값별 ${data.unit} 수`),
      h("thead", {}, h("tr", {}, h("th", {}, "값"), h("th", { class: "n" }, `${data.unit} 수`), h("th", { class: "n" }, "비율"))),
      h("tbody", {}, ...rows.map(([v, c]) => h("tr", {}, h("td", { class: "num" }, String(v)), h("td", { class: "n" }, c.toLocaleString()), h("td", { class: "n" }, `${((c / data.total) * 100).toFixed(2)}%`)))),
    ),
  );
}
