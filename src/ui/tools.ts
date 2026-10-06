import { abbreviatedWheel, checkWheelSpec, verifyWheel, WHEEL_MAX_POOL } from "../core/wheel";
import { rankProbabilities } from "../core/probabilities";
import { numberStats, overlapReport, rankByFrequency } from "../core/stats";
import { binom } from "../core/math";
import { persist, state, nextRound } from "../state";
import { balls, DISCLAIMER, fmtDate, notice, uid } from "./common";
import { clear, h } from "./dom";

export function renderWheel(root: HTMLElement) {
  const out = h("div");
  const pool = h("input", { type: "text", id: "pool", placeholder: "번호군 (6~16개, 예: 3,7,12,18,23,29,34,41)", style: "min-width:20rem", value: state.picks.candidates.join(",") });
  const t = h("input", { type: "number", id: "wt", min: 1, max: 6, value: "6" });
  const mm = h("input", { type: "number", id: "wm", min: 1, max: 6, value: "3" });
  const run = () => {
    clear(out);
    const nums = ((pool as HTMLInputElement).value.match(/\d+/g) ?? []).map(Number);
    const spec = { pool: [...nums].sort((a, b) => a - b), t: Number((t as HTMLInputElement).value), m: Number((mm as HTMLInputElement).value) };
    const err = checkWheelSpec(spec);
    if (err) return void out.append(notice("error", err));
    const t0 = performance.now();
    const r = abbreviatedWheel(spec);
    const ver = verifyWheel(spec, r.tickets);
    out.append(
      notice(ver.ok ? "ok" : "error", `번호군 ${spec.pool.length}개 중 당첨번호 ${spec.t}개가 번호군에 들어오면, 아래 ${r.tickets.length}장 중 한 장은 그 ${spec.t}개 중 ${spec.m}개 이상을 포함합니다. (전수 검증 ${ver.ok ? "통과" : "실패"}, ${Math.round(performance.now() - t0)}ms)`),
      h("p", { class: "muted" }, `전체 휠은 ${r.fullWheelSize.toLocaleString()}장입니다. 이 결과는 그리디 방식이라 최소 장수를 보장하지 않습니다. 장수가 늘면 비용도 그만큼 늘며, 한 장의 당첨 확률은 달라지지 않습니다.`),
      h("div", {}, ...r.tickets.map((c, i) => h("div", { class: "out-row" }, h("span", { class: "num muted" }, String(i + 1)), balls(c), h("span", {})))),
      h("button", { type: "button", class: "btn primary", onclick: async () => {
        state.batches.unshift({ id: uid(), name: `휠 ${spec.pool.length}개·t${spec.t}·m${spec.m}`, round: state.targetRound || nextRound(), createdAt: new Date().toISOString(), source: "generated", memo: `번호군 ${spec.pool.join(",")}`, combos: r.tickets.map((numbers) => ({ numbers })) });
        out.append((await persist()) ? notice("ok", "보관함에 저장했습니다.", h("a", { href: "#/vault" }, " 열기")) : notice("error", "저장하지 못했습니다."));
      } }, "보관함에 저장"),
    );
  };
  root.append(
    h("div", { class: "page-head" }, h("h2", {}, "휠링 (커버리지 조합)")),
    notice("info", "번호군 안에서 일부 번호가 맞을 때 최소 일치 개수를 보장하는 조합 묶음입니다. 조건부 보장일 뿐이며 한 장의 당첨 확률을 높이지 않습니다."),
    h("div", { class: "row", style: "margin-top:16px;align-items:flex-end" }, h("label", { class: "field" }, "번호군", pool)),
    h("div", { class: "row", style: "margin:12px 0;align-items:flex-end" }, h("label", { class: "field" }, "번호군 안에 들어오는 당첨번호 수 t", t), h("label", { class: "field" }, "보장할 최소 일치 m", mm), h("button", { type: "button", class: "btn primary", onclick: run }, "만들기")),
    h("p", { class: "muted" }, `번호군은 최대 ${WHEEL_MAX_POOL}개까지 지원합니다. 예) 번호군 12개, t=6, m=3 → 당첨번호 6개가 모두 번호군 안에 있으면 3개 이상 맞는 조합이 반드시 한 장 있습니다. 전체 조합 수 C(12,6)=${binom(12, 6)}.`),
    out,
  );
}

export function renderStats(root: HTMLElement) {
  const box = h("div");
  const win = h("select", { id: "win", "aria-label": "분석 기간" }, ...[["0", "전체"], ["5", "최근 5회"], ["10", "최근 10회"], ["20", "최근 20회"], ["50", "최근 50회"], ["100", "최근 100회"]].map(([v, l]) => h("option", { value: v }, l)));
  const bonus = h("input", { type: "checkbox", id: "bonus" });
  const draw = () => {
    clear(box);
    if (state.draws.state !== "ok") return void box.append(notice("info", "당첨 이력 데이터가 없어 번호별 통계를 표시할 수 없습니다."));
    const w = Number((win as HTMLSelectElement).value);
    const stats = numberStats(state.draws.draws, { window: w || undefined, includeBonus: (bonus as HTMLInputElement).checked });
    const ranked = rankByFrequency(stats);
    const t = h("table", {}, h("caption", {}, `번호별 출현 횟수와 미출현 회차 (${w ? `최근 ${w}회` : "전체"}, 보너스 ${(bonus as HTMLInputElement).checked ? "포함" : "제외"})`), h("thead", {}, h("tr", {}, ...["순위", "번호", "출현", "미출현 회차"].map((x) => h("th", {}, x)))));
    const tb = h("tbody");
    ranked.forEach((s, i) => tb.append(h("tr", {}, h("td", {}, String(i + 1)), h("td", {}, balls([s.number])), h("td", {}, String(s.count)), h("td", {}, String(s.absence)))));
    t.append(tb);
    box.append(h("div", { class: "scroll" }, t), h("p", { class: "muted" }, "많이 나온 번호가 더 나올 이유도, 덜 나온 번호가 나올 차례라는 근거도 없습니다. 추첨은 매 회차 독립입니다."));
  };
  win.addEventListener("change", draw);
  bonus.addEventListener("change", draw);
  const probs = rankProbabilities();
  const pt = h("table", {}, h("caption", {}, "한 장이 각 등수에 해당할 정확한 확률 (공정한 6/45 추첨)"), h("thead", {}, h("tr", {}, ...["등수", "조건", "경우의 수", "확률"].map((x) => h("th", {}, x)))), h("tbody", {}, ...probs.map((p) => h("tr", {}, h("td", {}, `${p.rank}등`), h("td", {}, p.label), h("td", {}, p.ways.toLocaleString()), h("td", {}, `1 / ${Math.round(p.oneIn).toLocaleString()}`)))));
  const recent = state.batches[0];
  const ov = recent ? overlapReport(recent.combos.map((c) => c.numbers)) : null;
  root.append(
    h("div", { class: "page-head" }, h("h2", {}, "통계")),
    notice("info", DISCLAIMER),
    h("section", { class: "sect" }, h("h3", {}, "당첨 확률"), h("div", { class: "scroll" }, pt)),
    ov && recent ? h("section", { class: "sect" }, h("h3", {}, `최근 묶음 분석 (${fmtDate(recent.createdAt)}, ${recent.combos.length}개)`), h("p", {}, `사용된 서로 다른 번호 ${ov.distinctNumbers}개 · 가장 많이 쓴 번호 ${ov.topNumber?.number ?? "-"}(${ov.topNumber?.count ?? 0}회) · 조합 쌍 최대 겹침 ${ov.maxOverlap}개 · 평균 겹침 ${ov.avgOverlap.toFixed(2)}개`)) : "",
    h("section", { class: "sect" }, h("h3", {}, "번호별 통계"), h("div", { class: "row" }, h("label", { for: "win" }, "기간"), win, h("label", { class: "row", style: "gap:6px" }, bonus, " 보너스 포함")), box),
  );
  draw();
}
