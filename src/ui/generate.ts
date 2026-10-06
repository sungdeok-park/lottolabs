import dist from "../../content/distributions.json";
import { createGenerator, validateOptions } from "../core/generate";
import { FILTERS, FILTER_BY_KEY, REGRESS_MAX, checkExpr, describeRule, effectiveRules, parseRegressKey, regressKey, ruleAccepts, type FilterDef, type FilterGroup } from "../core/filters";
import { spaceSize, type JobRequest } from "../core/jobs";
import { startJob, type JobHandle } from "./jobClient";
import { backtest, recentMetricRange, regressionRecentRange } from "../core/stats";
import { acValue, highCount, oddCount, sum } from "../core/metrics";
import { historyBefore } from "../core/draws";
import type { FilterRule } from "../core/types";
import { nextRound, persist, state, type Batch } from "../state";
import { balls, DISCLAIMER, fmtDate, notice, uid } from "./common";
import { distChart, distTable, type DistData } from "./distChart";
import { clear, h } from "./dom";

const SPACE = dist.filters as Record<string, Record<string, number>>;
const TOTAL = dist.total;
const MAX_COUNT = 500; // 성능 시험 전 임시 상한
const GROUPS: FilterGroup[] = ["기본 분석", "번호 특성", "분포", "용지", "9궁", "과거 이력"];
const fmt = (n: number) => n.toLocaleString("ko-KR");

const getRule = (key: string) => state.rules.find((r) => r.key === key);
const isOn = (key: string) => { const r = getRule(key); return !!r && r.enabled !== false; };
const labelOf = (key: string) => getRule(key)?.label ?? FILTER_BY_KEY.get(key)?.label ?? (parseRegressKey(key) !== null ? `${parseRegressKey(key)}회귀` : key);

function parseValues(s: string): number[] {
  return s.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n));
}
const targetRound = () => (state.targetRound > 0 ? state.targetRound : nextRound());
const activeRules = () => effectiveRules(state.rules, targetRound());
const history = () => (state.draws.state === "ok" ? historyBefore(state.draws.draws, targetRound()) : undefined);
function jobReq<K extends JobRequest["kind"]>(kind: K): JobRequest & { kind: K } {
  return { kind, picks: structuredClone(state.picks), rules: structuredClone(activeRules()), draws: state.draws.state === "ok" ? state.draws.draws.filter((d) => d.round < targetRound()) : [], targetRound: targetRound() };
}

/** 규칙의 한 줄 요약 (목록 오른쪽에 표시) */
function shortSummary(r: FilterRule | undefined): string {
  if (!r || r.enabled === false) return "";
  const parts: string[] = [];
  if (r.values?.length) parts.push(r.values.join("·"));
  if (r.min !== undefined && r.max !== undefined) parts.push(r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);
  else if (r.min !== undefined) parts.push(`≥${r.min}`);
  else if (r.max !== undefined) parts.push(`≤${r.max}`);
  if (r.set) parts.unshift(`{${r.set.length}}`);
  if (r.expr !== undefined) return "식";
  return parts.join(" ") || "전체";
}

type Sel = { kind: "operator"; id: string } | { kind: "board" } | { kind: "round" } | { kind: "presets" } | { kind: "regress" } | { kind: "custom" } | { kind: "filter"; key: string };
type Mode = "fixed" | "exclude" | "candidates";

export function renderGenerate(root: HTMLElement) {
  let sel: Sel = { kind: "board" };
  let query = "";
  let mode: Mode = "fixed";
  let cancel = false;
  let running = false;
  let job: JobHandle<unknown> | null = null;
  let distTab: "space" | "history" = "space";
  let showTable = false;
  let regressNote: ["ok" | "warn" | "error" | "info", string] | null = null;
  const openGroups = new Set<string>([GROUPS[0]!]);

  const wb = h("div", { class: "wb" });
  const rail = h("nav", { class: "rail", "aria-label": "필터 목록" });
  const edit = h("div", { class: "edit", id: "editor", tabindex: -1 });
  const side = h("aside", { class: "side", "aria-label": "결과" });
  const out = h("div", { class: "results", hidden: true });
  const counterBox = h("div", { class: "counter", role: "status", "aria-live": "polite" });
  const footCounter = h("span", { class: "num" });
  const problems = h("div");
  const activeBox = h("div", { class: "active-list" });
  const progress = h("div", { class: "muted", role: "status", "aria-live": "polite" });

  const commit = () => { void persist(); refreshAll(); };
  const select = (s: Sel) => {
    sel = s;
    wb.setAttribute("data-editing", "");
    drawRail();
    drawEdit();
    edit.scrollTop = 0;
  };

  /* ====================== 규칙 조작 ====================== */
  function setRule(key: string, patch: Partial<FilterRule>, base?: Partial<FilterRule>) {
    let r = getRule(key);
    if (!r) { r = { key, enabled: true, ...base }; state.rules.push(r); }
    Object.assign(r, patch);
    for (const k of ["min", "max"] as const) if (r[k] === undefined || Number.isNaN(r[k])) delete r[k];
    if (r.values && !r.values.length) delete r.values;
    return r;
  }
  const turnOff = (key: string) => { const r = getRule(key); if (r) r.enabled = false; };

  /* ====================== 상단 카운터 ====================== */
  let liveJob: JobHandle<unknown> | null = null;
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  const LIVE_AUTO_MAX_RULES = 20;
  function paintCounter(big: string, sub: string, ratio?: number) {
    clear(counterBox);
    counterBox.append(h("span", { class: "eyebrow" }, "남은 조합"), h("span", { class: `big${/^계산|^확인|^≤/.test(big) ? " calc" : ""}` }, big), h("span", { class: "of" }, sub));
    if (ratio !== undefined) counterBox.append(h("div", { class: "meter" }, h("i", { style: `width:${Math.max(0.5, ratio * 100).toFixed(2)}%` })));
    footCounter.textContent = big;
  }
  function updateCounter() {
    clearTimeout(liveTimer);
    liveJob?.cancel();
    liveJob = null;
    const errs = validateOptions({ ...state.picks, rules: activeRules(), count: 1 }, !!history());
    const rules = activeRules();
    const total = spaceSize(state.picks);
    if (errs.length) return paintCounter("확인 필요", "조건이 맞지 않습니다");
    if (!rules.length) return paintCounter(fmt(total), "켜진 필터 없음", 1);
    const calc = () => {
      paintCounter("계산 중 0%", `켜진 필터 ${rules.length}개`);
      const j = startJob(jobReq("count"), (v, t) => paintCounter(`계산 중 ${t ? Math.min(99, Math.floor((v / t) * 100)) : 0}%`, `켜진 필터 ${rules.length}개`));
      liveJob = j;
      void j.promise.then((r) => {
        if (liveJob !== j || !r) return;
        paintCounter(fmt(r.passed), `/ ${fmt(r.total)} · ${r.total ? ((r.passed / r.total) * 100).toFixed(2) : "0"}% · 필터 ${rules.length}개`, r.total ? r.passed / r.total : 0);
      });
    };
    if (rules.length > LIVE_AUTO_MAX_RULES) {
      paintCounter(`≤ ${fmt(total)}`, `켜진 필터 ${rules.length}개 · 자동 계산 생략`);
      counterBox.append(h("button", { type: "button", class: "btn sm", style: "margin-top:8px", onclick: calc }, "정확히 계산"));
    } else liveTimer = setTimeout(calc, 500);
  }

  /* ====================== 목록(왼쪽) ====================== */
  function frow(key: string, name: string, summary: string, on: boolean, current: boolean, onClick: () => void) {
    return h("li", {}, h("button", { type: "button", class: `frow${on ? " on" : ""}`, "aria-current": current ? "true" : undefined, onclick: onClick }, h("span", { class: "dot", "aria-hidden": "true" }), h("span", { class: "nm" }, name), h("span", { class: "sm" }, summary)));
  }
  function drawRail() {
    const top = rail.scrollTop;
    clear(rail);
    const q = query.trim().toLowerCase();
    const p = state.picks;
    const search = h("div", { class: "rail-search" }, h("label", { class: "sr", for: "fsearch" }, "필터 검색"), h("input", { id: "fsearch", type: "search", placeholder: "필터 검색 (예: 총합, 회귀, 9궁)", value: query, oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; const pos = (e.target as HTMLInputElement).selectionStart; drawRail(); const el = document.getElementById("fsearch") as HTMLInputElement | null; el?.focus(); el?.setSelectionRange(pos, pos); } }));
    rail.append(search);
    const cur = (k: Sel["kind"], key?: string) => sel.kind === k && (key === undefined || (sel.kind === "filter" && sel.key === key));
    if (!q) {
      rail.append(h("h3", { class: "group" }, "기본 조건"));
      rail.append(h("ul", { class: "rows" },
        frow("board", "번호 선택", [p.fixed.length ? `고정 ${p.fixed.length}` : "", p.exclude.length ? `제외 ${p.exclude.length}` : "", p.candidates.length ? `후보 ${p.candidates.length}` : ""].filter(Boolean).join(" · ") || "전체", p.fixed.length + p.exclude.length + p.candidates.length > 0, cur("board"), () => select({ kind: "board" })),
        frow("round", "목표 회차", `${targetRound()}회`, false, cur("round"), () => select({ kind: "round" })),
        frow("presets", "프리셋", state.presets.length ? `${state.presets.length}개` : "", false, cur("presets"), () => select({ kind: "presets" })),
      ));
      const on = FILTERS.filter((f) => isOn(f.key));
      const customOn = state.rules.filter((r) => (r.set || r.expr !== undefined) && r.enabled !== false);
      const regOn = state.rules.filter((r) => parseRegressKey(r.key) !== null && r.enabled !== false).length;
      rail.append(h("h3", { class: "group" }, h("span", {}, "켜진 필터"), h("span", { class: "num" }, String(on.length + customOn.length + (regOn ? 1 : 0)))));
      const onList = h("ul", { class: "rows" });
      for (const f of on) onList.append(frow(f.key, f.label, shortSummary(getRule(f.key)), true, cur("filter", f.key), () => select({ kind: "filter", key: f.key })));
      if (regOn) onList.append(frow("regress", `회귀 ${regOn}개`, "", true, cur("regress"), () => select({ kind: "regress" })));
      for (const r of customOn) onList.append(frow(r.key, r.label ?? "내 필터", shortSummary(r), true, cur("custom"), () => select({ kind: "custom" })));
      if (!on.length && !customOn.length && !regOn) onList.append(h("li", { class: "muted", style: "padding:10px 0" }, "켠 필터가 없습니다. 아래에서 고르세요."));
      rail.append(onList);
      for (const g of GROUPS) {
        const list = FILTERS.filter((f) => f.group === g);
        const n = list.filter((f) => isOn(f.key)).length;
        const det = h("details", { open: openGroups.has(g) || n > 0 }, h("summary", {}, h("span", {}, g), h("span", { class: "num" }, n ? `${n}/${list.length}` : String(list.length))), h("ul", { class: "rows" }, ...list.map((f) => frow(f.key, f.label, shortSummary(getRule(f.key)), isOn(f.key), cur("filter", f.key), () => select({ kind: "filter", key: f.key })))));
        det.addEventListener("toggle", () => { if (det.open) openGroups.add(g); else openGroups.delete(g); });
        rail.append(det);
      }
      const recs = state.operator.recommended?.filters ?? [];
      rail.append(h("h3", { class: "group" }, h("span", {}, "운영자 추천"), h("span", { class: "num" }, String(recs.length))));
      rail.append(recs.length
        ? h("ul", { class: "rows" }, ...recs.map((r) => { const applied = r.rules.every((x) => state.rules.some((y) => y.source === r.id && y.key === x.key && y.enabled !== false)); return frow("op-" + r.id, r.name, applied ? "적용됨" : "", applied, sel.kind === "operator" && sel.id === r.id, () => select({ kind: "operator", id: r.id })); }))
        : h("p", { class: "muted", style: "padding:6px 16px 6px 0" }, "게시된 추천 필터가 없습니다."));
      rail.append(h("h3", { class: "group" }, "직접 만들기"), h("ul", { class: "rows" },
        frow("regress", "회귀 1~200", regOn ? `${regOn}개 켜짐` : "", regOn > 0, cur("regress"), () => select({ kind: "regress" })),
        frow("custom", "내 필터 (번호 집합·표현식)", customOn.length ? `${customOn.length}개` : "", customOn.length > 0, cur("custom"), () => select({ kind: "custom" })),
      ));
    } else {
      const hits = FILTERS.filter((f) => f.label.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.key.toLowerCase().includes(q) || f.group.includes(q));
      rail.append(h("h3", { class: "group" }, h("span", {}, "검색 결과"), h("span", { class: "num" }, String(hits.length))));
      const list = h("ul", { class: "rows" }, ...hits.map((f) => frow(f.key, f.label, shortSummary(getRule(f.key)), isOn(f.key), cur("filter", f.key), () => select({ kind: "filter", key: f.key }))));
      if ("회귀".includes(q) || "regress".includes(q)) list.append(frow("regress", "회귀 1~200", "", false, cur("regress"), () => select({ kind: "regress" })));
      rail.append(list);
    }
    rail.scrollTop = top;
  }

  /* ====================== 설정(가운데) ====================== */
  const backBtn = () => h("button", { type: "button", class: "btn quiet edit-back", onclick: () => wb.removeAttribute("data-editing") }, "← 목록");
  const head = (title: string, meta: string, right?: Node) => h("div", { class: "edit-head" }, h("div", {}, h("h2", {}, title), meta ? h("p", { class: "meta" }, meta) : ""), right ?? "");
  const sw = (checked: boolean, label: string, onChange: (v: boolean) => void) => h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(checked), "aria-label": label, onclick: () => onChange(!checked) });

  function drawEdit(focusSel?: string) {
    clear(edit);
    edit.append(backBtn());
    if (sel.kind === "board") editBoard();
    else if (sel.kind === "round") editRound();
    else if (sel.kind === "presets") editPresets();
    else if (sel.kind === "operator") editOperator(sel.id);
    else if (sel.kind === "regress") editRegress();
    else if (sel.kind === "custom") editCustom();
    else editFilter(FILTER_BY_KEY.get(sel.key)!);
    edit.append(h("div", { class: "edit-foot" }, h("span", { class: "muted" }, "남은 조합 "), footCounter, h("button", { type: "button", class: "btn sm", onclick: () => wb.removeAttribute("data-editing") }, "목록으로")));
    if (focusSel) (edit.querySelector(focusSel) as HTMLElement | null)?.focus();
  }

  /* ---- 일반 필터 ---- */
  let histCache: { key: string; round: number; data: DistData } | null = null;
  function historyDist(def: FilterDef): DistData | null {
    if (state.draws.state !== "ok") return null;
    const round = targetRound();
    if (histCache && histCache.key === def.key && histCache.round === round) return histCache.data;
    const draws = state.draws.draws.filter((d) => d.round < round);
    const counts = new Map<number, number>();
    draws.forEach((d, i) => {
      const v = def.compute(d.numbers, { draws: draws.slice(0, i), targetRound: d.round });
      counts.set(v, (counts.get(v) ?? 0) + 1);
    });
    const data = { counts, total: draws.length, unit: "회차" };
    histCache = { key: def.key, round, data };
    return data;
  }
  function spaceDist(def: FilterDef): DistData | null {
    const row = SPACE[def.key];
    return row ? { counts: new Map(Object.entries(row).map(([v, c]) => [Number(v), c])), total: TOTAL, unit: "조합" } : null;
  }

  function editFilter(def: FilterDef) {
    const rule = getRule(def.key);
    const on = isOn(def.key);
    const example = def.needsHistory ? null : def.compute([3, 8, 14, 22, 31, 42]);
    edit.append(head(def.label, def.description, sw(on, `${def.label} 켜기`, (v) => { if (v) setRule(def.key, { enabled: true }); else turnOff(def.key); commit(); drawEdit(); })));
    if (def.needsHistory && state.draws.state !== "ok") edit.append(notice("warn", "당첨 이력이 없어 이 필터는 계산할 수 없습니다. 이력을 불러온 뒤 쓰세요."));

    const sp = spaceDist(def);
    const hs = historyDist(def);
    if (!sp && distTab === "space") distTab = "history";
    if (!hs && distTab === "history" && sp) distTab = "space";
    const data = distTab === "space" ? sp : hs;
    const sectionChart = h("section", {});
    sectionChart.append(h("h3", {}, "허용할 값"));
    if (sp || hs) {
      const tabs = h("div", { class: "tabs", role: "tablist" });
      if (sp) tabs.append(h("button", { type: "button", role: "tab", "aria-selected": String(distTab === "space"), onclick: () => { distTab = "space"; drawEdit(); } }, `전체 ${fmt(TOTAL)}개 조합`));
      if (hs) tabs.append(h("button", { type: "button", role: "tab", "aria-selected": String(distTab === "history"), onclick: () => { distTab = "history"; drawEdit(); } }, `과거 당첨번호 ${fmt(hs.total)}회`));
      sectionChart.append(tabs);
    }
    if (data) {
      sectionChart.append(distChart(def, data, on ? rule : undefined, (v) => {
        const cur = new Set(rule?.values ?? []);
        if (cur.has(v)) cur.delete(v); else cur.add(v);
        setRule(def.key, { enabled: true, values: [...cur].sort((a, b) => a - b) });
        commit();
        drawEdit(`.col[aria-label^="${v}:"]`);
      }));
      sectionChart.append(h("div", { class: "row" }, h("button", { type: "button", class: "btn quiet sm", onclick: () => { showTable = !showTable; drawEdit(); } }, showTable ? "표 닫기" : "표로 보기")));
      if (showTable) sectionChart.append(distTable(def, data));
      if (distTab === "history") sectionChart.append(h("p", { class: "muted" }, "과거 통과율은 구매 조합의 당첨률이 아닙니다."));
    } else sectionChart.append(h("p", { class: "muted" }, "이 필터는 과거 이력에 따라 값이 달라져 전체 분포가 없습니다."));
    edit.append(sectionChart);

    // 범위 입력
    const num = (v: string) => (v === "" ? undefined : Number(v));
    const field = (label: string, input: HTMLElement) => h("label", { class: "field" }, label, input);
    edit.append(h("section", {},
      h("h3", {}, "범위로 정하기"),
      h("div", { class: "row", style: "align-items:flex-end" },
        field("허용 값 (쉼표로 구분)", h("input", { type: "text", inputMode: "numeric", placeholder: "예) 2, 3, 4", value: (rule?.values ?? []).join(", "), style: "width:12rem", onchange: (e: Event) => { setRule(def.key, { enabled: true, values: parseValues((e.target as HTMLInputElement).value) }); commit(); drawEdit(); } })),
        field("최소", h("input", { type: "number", min: def.domain[0], max: def.domain[1], value: rule?.min !== undefined ? String(rule.min) : "", style: "width:6rem", onchange: (e: Event) => { setRule(def.key, { enabled: true, min: num((e.target as HTMLInputElement).value) }); commit(); drawEdit(); } })),
        field("최대", h("input", { type: "number", min: def.domain[0], max: def.domain[1], value: rule?.max !== undefined ? String(rule.max) : "", style: "width:6rem", onchange: (e: Event) => { setRule(def.key, { enabled: true, max: num((e.target as HTMLInputElement).value) }); commit(); drawEdit(); } })),
        h("button", { type: "button", class: "btn quiet", onclick: () => { const r = getRule(def.key); if (r) { delete r.values; delete r.min; delete r.max; } commit(); drawEdit(); } }, "범위 지우기"),
      ),
      h("p", { class: "muted" }, `가능한 값은 ${def.domain[0]}~${def.domain[1]}입니다. 허용 값과 최소·최대를 함께 쓰면 둘 다 만족해야 합니다.`),
    ));

    // 이 필터만 걸었을 때
    if (sp && on) {
      let pass = 0;
      for (const [v, c] of sp.counts) if (rule && ruleAccepts(rule, v)) pass += c;
      edit.append(h("section", {}, h("h3", {}, "이 필터만 걸었을 때"), h("p", {}, h("strong", { class: "num" }, fmt(pass)), h("span", { class: "muted" }, ` / ${fmt(TOTAL)}개 조합 (${((pass / TOTAL) * 100).toFixed(2)}%)`)), h("p", { class: "muted" }, "조합 수가 많은 값이 당첨 확률이 높다는 뜻은 아닙니다.")));
    }
    edit.append(h("section", {}, h("h3", {}, "정의"), h("dl", { class: "kv" },
      h("dt", {}, "분류"), h("dd", {}, def.group),
      example !== null ? h("dt", {}, "예시") : "", example !== null ? h("dd", {}, balls([3, 8, 14, 22, 31, 42]), h("span", { class: "muted" }, `  →  ${def.label} = `), h("strong", { class: "num" }, String(example))) : "",
      h("dt", {}, "해설"), h("dd", {}, h("a", { href: `/filters/${def.key}/` }, "필터 해설 페이지")),
    )));
    // 그룹 도구
    const group = FILTERS.filter((f) => f.group === def.group);
    const tools = h("section", {}, h("h3", {}, `${def.group} 그룹`));
    const row = h("div", { class: "row" });
    if (def.group === "용지" || def.group === "9궁") {
      row.append(h("button", { type: "button", class: "btn sm", onclick: () => {
        if (state.draws.state !== "ok") return void alert("당첨 이력 데이터가 없어 계산할 수 없습니다.");
        const hist = state.draws.draws.filter((d) => d.round < targetRound());
        for (const f of group.filter((x) => /^(row|col|gung)\d$/.test(x.key))) {
          const rg = recentMetricRange({ key: f.key }, hist);
          if (rg) setRule(f.key, { enabled: true, min: rg.min, max: rg.max });
        }
        commit(); drawEdit();
      } }, "최근 10회 범위 일괄 적용"));
    }
    row.append(h("button", { type: "button", class: "btn sm danger", onclick: () => { for (const f of group) turnOff(f.key); commit(); drawEdit(); } }, "이 그룹 모두 끄기"));
    tools.append(row);
    edit.append(tools);
  }

  /* ---- 번호 선택(용지 배치) ---- */
  function editBoard() {
    const p = state.picks;
    edit.append(head("번호 선택", "고정수는 모든 조합에 넣고, 제외수는 절대 넣지 않고, 후보는 그 안에서만 고릅니다. 고정수와 후보는 별개입니다."));
    const seg = h("div", { class: "seg", role: "group", "aria-label": "번호판 모드" }, ...(["fixed", "exclude", "candidates"] as Mode[]).map((m) => h("button", { type: "button", "aria-pressed": String(mode === m), onclick: () => { mode = m; drawEdit(); } }, { fixed: "고정", exclude: "제외", candidates: "후보" }[m])));
    const slip = h("div", { class: "slip", role: "group", "aria-label": "번호판 (동행복권 용지 배치)" });
    for (let n = 1; n <= 49; n++) {
      if (n > 45) { slip.append(h("span", { class: "cell blank", "aria-hidden": "true" })); continue; }
      const cls = p.fixed.includes(n) ? "fixed" : p.exclude.includes(n) ? "exclude" : p.candidates.includes(n) ? "cand" : "";
      const tag = { fixed: "고정", exclude: "제외", cand: "후보", "": "" }[cls];
      slip.append(h("button", { type: "button", class: `cell ${cls}`, "aria-pressed": String(!!cls), "aria-label": `${n}${tag ? " " + tag : ""}`, onclick: () => {
        const has = p[mode].includes(n);
        p.fixed = p.fixed.filter((x) => x !== n); p.exclude = p.exclude.filter((x) => x !== n); p.candidates = p.candidates.filter((x) => x !== n);
        if (!has) p[mode] = [...p[mode], n].sort((a, b) => a - b);
        commit(); drawEdit(`.cell[aria-label^="${n}"]`);
      } }, String(n), tag ? h("small", {}, tag) : ""));
    }
    edit.append(h("section", {}, h("h3", {}, "모드"), h("div", { class: "row" }, seg, h("button", { type: "button", class: "btn quiet", onclick: () => { state.picks = { fixed: [], exclude: [], candidates: [] }; commit(); drawEdit(); } }, "전체 지우기")),
      h("div", { class: "legend" }, h("span", { class: "l-fixed" }, "고정"), h("span", { class: "l-excl" }, "제외"), h("span", { class: "l-cand" }, "후보")), slip));
    edit.append(h("section", {}, h("h3", {}, "선택 현황"), h("dl", { class: "kv" },
      h("dt", {}, "고정"), h("dd", { class: "num" }, p.fixed.join(", ") || "없음"),
      h("dt", {}, "제외"), h("dd", { class: "num" }, p.exclude.join(", ") || "없음"),
      h("dt", {}, "후보"), h("dd", { class: "num" }, p.candidates.length ? `${p.candidates.length}개: ${p.candidates.join(", ")}` : "전체 1~45"))));
  }

  function editRound() {
    edit.append(head("목표 회차", "이 회차의 추첨을 노리고 만듭니다. 이 회차 이전의 당첨 이력만 필터에 사용합니다."));
    edit.append(h("section", {}, h("div", { class: "row", style: "align-items:flex-end" },
      h("label", { class: "field" }, "추첨 회차", h("input", { id: "round", type: "number", min: 1, value: String(targetRound()), style: "width:8rem", onchange: (e: Event) => { state.targetRound = Number((e.target as HTMLInputElement).value) || 0; commit(); drawEdit(); } })),
      h("button", { type: "button", class: "btn quiet", onclick: () => { state.targetRound = 0; commit(); drawEdit(); } }, `다음 회차로 (${nextRound()}회)`)),
      state.draws.state !== "ok" ? notice("info", "당첨 이력이 없어 다음 회차는 1회로 계산됩니다.") : ""));
  }

  function editPresets() {
    edit.append(head("프리셋", "지금의 번호 선택과 필터 설정을 이름 붙여 저장해 두었다가 불러옵니다."));
    const nameIn = h("input", { type: "text", placeholder: "프리셋 이름", "aria-label": "프리셋 이름", style: "min-width:14rem" });
    edit.append(h("section", {}, h("h3", {}, "저장"), h("div", { class: "row" }, nameIn, h("button", { type: "button", class: "btn primary", onclick: () => {
      const name = (nameIn as HTMLInputElement).value.trim();
      if (!name) return;
      state.presets = [...state.presets.filter((p) => p.name !== name), { name, rules: structuredClone(state.rules), picks: structuredClone(state.picks) }];
      commit(); drawEdit();
    } }, "현재 조건 저장"))));
    const list = h("ul", { class: "rows" });
    for (const [i, p] of state.presets.entries()) {
      list.append(h("li", {}, h("div", { class: "row between", style: "padding:10px 0" }, h("span", {}, h("strong", {}, p.name), h("span", { class: "muted" }, `  필터 ${p.rules.filter((r) => r.enabled !== false).length}개`)),
        h("span", { class: "toolbar" },
          h("button", { type: "button", class: "btn sm", onclick: () => { state.rules = structuredClone(p.rules); state.picks = structuredClone(p.picks); commit(); drawEdit(); } }, "불러오기"),
          h("button", { type: "button", class: "btn sm danger", onclick: () => { state.presets.splice(i, 1); commit(); drawEdit(); } }, "삭제")))));
    }
    edit.append(h("section", {}, h("h3", {}, `저장된 프리셋 ${state.presets.length}개`), state.presets.length ? list : h("p", { class: "muted" }, "저장된 프리셋이 없습니다.")));
  }

  /* ---- 운영자 추천 필터 ---- */
  function editOperator(id: string) {
    const rec = state.operator.recommended?.filters.find((r) => r.id === id);
    if (!rec) { edit.append(head("운영자 추천", ""), notice("info", "게시된 추천 필터가 없습니다.")); return; }
    const mine = () => state.rules.filter((r) => r.source === rec.id);
    const applied = rec.rules.every((x) => mine().some((y) => y.key === x.key && y.enabled !== false));
    const st = rec.stats;
    edit.append(head(rec.name, rec.description, sw(applied, `${rec.name} 적용`, (v) => {
      if (v) for (const r of rec.rules) { const cur = getRule(r.key); if (cur) { delete cur.values; } setRule(r.key, { enabled: true, min: r.min, max: r.max, source: rec.id }); }
      else for (const r of mine()) r.enabled = false;
      commit(); drawEdit();
    })));
    edit.append(h("section", {}, h("h3", {}, "근거"),
      h("dl", { class: "kv" },
        h("dt", {}, "과거 통과"), h("dd", {}, h("strong", { class: "num" }, `${st.historicalPass} / ${st.basedOnRounds}회`), h("span", { class: "muted" }, ` (${((st.historicalPass / st.basedOnRounds) * 100).toFixed(1)}%)`)),
        h("dt", {}, "전체 조합 통과"), h("dd", {}, h("strong", { class: "num" }, `${fmt(st.spaceRemaining)} / ${fmt(st.spaceTotal)}개`), h("span", { class: "muted" }, ` (${((st.spaceRemaining / st.spaceTotal) * 100).toFixed(1)}%)`)),
        h("dt", {}, "게시"), h("dd", {}, `revision ${rec.revision} · 방법 ${rec.methodVersion} · ${new Date(rec.publishedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}`)),
      notice("info", st.historicalPass / st.basedOnRounds < st.spaceRemaining / st.spaceTotal + 0.05 ? "과거 당첨번호의 통과율이 아무 조합이나 고를 때의 통과율과 비슷합니다. 이 범위는 극단적인 조합만 덜어낼 뿐, 당첨번호가 이 범위에 더 잘 들어온다는 근거는 아닙니다." : "과거 통과율이 전체 조합 통과율보다 높습니다. 그래도 이는 과거 분포의 요약이며 앞으로의 당첨 확률을 높이지 않습니다.")));
    const tb = h("tbody");
    for (const r of rec.rules) {
      const cur = state.rules.find((y) => y.source === rec.id && y.key === r.key);
      tb.append(h("tr", {}, h("td", {}, h("a", { href: "#/generate", onclick: (e: Event) => { e.preventDefault(); select({ kind: "filter", key: r.key }); } }, FILTER_BY_KEY.get(r.key)?.label ?? r.key)), h("td", { class: "n" }, `${r.min ?? "~"} – ${r.max ?? "~"}`), h("td", { class: "n" }, cur && cur.enabled !== false ? (cur.min !== r.min || cur.max !== r.max ? `${cur.min ?? "~"} – ${cur.max ?? "~"} (수정됨)` : "적용 중") : "—")));
    }
    edit.append(h("section", {}, h("h3", {}, `포함된 필터 ${rec.rules.length}개`), h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "필터"), h("th", { class: "n" }, "추천 범위"), h("th", { class: "n" }, "내 설정"))), tb)),
      h("p", { class: "muted" }, "적용하면 같은 이름의 필터 설정을 이 범위로 덮어씁니다. 적용한 뒤에도 각 필터를 따로 고칠 수 있습니다.")));
  }

  /* ---- 회귀 ---- */
  function editRegress() {
    const steps = Array.from({ length: REGRESS_MAX }, (_, i) => i + 1);
    const onCount = () => steps.filter((n) => isOn(regressKey(n))).length;
    edit.append(head("회귀 1~200", "N회귀는 목표 회차에서 N회 전 당첨 본번호와 겹치는 번호의 개수입니다. 1회귀는 이월수와 같고, 1~200회귀를 모두 동시에 켤 수 있습니다.", h("span", { class: "num muted" }, `${onCount()}개 켜짐`)));
    const clamp = (v: string, d: number) => Math.max(0, Math.min(6, Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d));
    const hist = () => (state.draws.state === "ok" ? state.draws.draws.filter((d) => d.round < targetRound()) : []);
    const bMin = h("input", { type: "number", min: 0, max: 6, placeholder: "0", "aria-label": "일괄 최소", style: "width:5rem" });
    const bMax = h("input", { type: "number", min: 0, max: 6, placeholder: "6", "aria-label": "일괄 최대", style: "width:5rem" });
    const say = (kind: "ok" | "warn" | "error" | "info", t: string) => { regressNote = [kind, t]; };
    const redo = () => { commit(); drawEdit(); };
    edit.append(h("section", {}, h("h3", {}, "한꺼번에"),
      h("div", { class: "row" }, h("span", { class: "muted" }, "최소"), bMin, h("span", { class: "muted" }, "최대"), bMax,
        h("button", { type: "button", class: "btn primary", onclick: () => {
          const min = clamp((bMin as HTMLInputElement).value, 0), max = clamp((bMax as HTMLInputElement).value, 6);
          if (min > max) { say("error", "최소가 최대보다 큽니다."); return drawEdit(); }
          for (const n of steps) setRule(regressKey(n), { enabled: true, min, max });
          say("ok", `1~200회귀 ${REGRESS_MAX}개를 ${min}~${max}로 켰습니다.`); redo();
        } }, "일괄 적용")),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn", onclick: () => { for (const n of steps) setRule(regressKey(n), { enabled: true }); say("ok", "전체 ON"); redo(); } }, "전체 ON"),
        h("button", { type: "button", class: "btn", onclick: () => { for (const n of steps) turnOff(regressKey(n)); say("info", "전체 OFF (설정값은 유지)"); redo(); } }, "전체 OFF"),
        h("button", { type: "button", class: "btn", onclick: () => {
          if (state.draws.state !== "ok") { say("info", "당첨 이력이 없어 계산할 수 없습니다."); return drawEdit(); }
          const hs = hist(); let withData = 0;
          for (const n of steps) { const rg = regressionRecentRange(hs, targetRound(), n); if (rg) withData++; setRule(regressKey(n), { enabled: true, min: rg?.min ?? 0, max: rg?.max ?? 6 }); }
          say("ok", `${REGRESS_MAX}개 회귀를 켰습니다. 최근 10회 기준 범위를 계산한 것은 ${withData}개이고, 이력이 모자란 ${REGRESS_MAX - withData}개는 0~6(제한 없음)입니다.`); redo();
        } }, "최근 10회 기준 일괄 적용"),
        h("button", { type: "button", class: "btn danger", onclick: () => { state.rules = state.rules.filter((r) => parseRegressKey(r.key) === null); say("info", "회귀 설정을 모두 지웠습니다."); redo(); } }, "설정 모두 삭제")),
      regressNote ? notice(regressNote[0], regressNote[1]) : ""));
    const tb = h("tbody");
    for (const n of steps) {
      const key = regressKey(n); const r = getRule(key);
      tb.append(h("tr", {},
        h("td", {}, `${n}회귀`),
        h("td", {}, sw(isOn(key), `${n}회귀 사용`, (v) => { if (v) setRule(key, { enabled: true, min: r?.min ?? 0, max: r?.max ?? 6 }); else turnOff(key); commit(); drawEdit(`.reg-table tr:nth-child(${n}) .switch`); })),
        h("td", {}, h("input", { type: "number", min: 0, max: 6, value: String(r?.min ?? 0), "aria-label": `${n}회귀 최소`, onchange: (e: Event) => { setRule(key, { min: clamp((e.target as HTMLInputElement).value, 0) }); void persist(); refreshAll(); } })),
        h("td", {}, h("input", { type: "number", min: 0, max: 6, value: String(r?.max ?? 6), "aria-label": `${n}회귀 최대`, onchange: (e: Event) => { setRule(key, { max: clamp((e.target as HTMLInputElement).value, 6) }); void persist(); refreshAll(); } })),
      ));
    }
    edit.append(h("section", {}, h("h3", {}, "회귀별 설정"), h("div", { class: "reg-table" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "회귀"), h("th", {}, "사용"), h("th", {}, "최소"), h("th", {}, "최대"))), tb))));
  }

  /* ---- 내 필터 ---- */
  function editCustom() {
    edit.append(head("내 필터", "번호 집합(수동필터)이나 표현식으로 나만의 조건을 만듭니다."));
    const target = targetRound();
    const isStale = (r: FilterRule) => r.round !== undefined && !r.preserve && r.round < target;
    const mine = state.rules.filter((r) => r.set || r.expr !== undefined);
    const msg = h("div", { role: "status" });
    const err = (t: string) => { clear(msg); msg.append(notice("error", t)); };
    const rowOf = (r: FilterRule, stale: boolean) => h("li", { style: stale ? "opacity:.6" : "" }, h("div", { class: "row between", style: "padding:10px 0" },
      h("span", { class: "row" }, sw(r.enabled !== false && !stale, `${r.label ?? r.key} 적용`, (v) => { r.enabled = v; commit(); drawEdit(); }),
        h("span", {}, h("strong", {}, r.label ?? "내 필터"), h("span", { class: "muted" }, `  ${r.set ? `{${r.set.join(",")}} 포함 ${shortSummary({ ...r, set: undefined, enabled: true })}` : r.expr}${r.round !== undefined ? `  · ${r.round}회차${stale ? " (지난 회차)" : ""}` : ""}`))),
      h("span", { class: "toolbar" },
        h("label", { class: "row", style: "gap:4px" }, h("input", { type: "checkbox", checked: !!r.preserve, onchange: (e: Event) => { r.preserve = (e.target as HTMLInputElement).checked; commit(); drawEdit(); } }), "보존"),
        h("button", { type: "button", class: "btn sm danger", onclick: () => { state.rules = state.rules.filter((x) => x !== r); commit(); drawEdit(); } }, "삭제"))));
    const list = h("ul", { class: "rows" }, ...mine.map((r) => rowOf(r, isStale(r))));
    edit.append(h("section", {}, h("h3", {}, `내 필터 ${mine.length}개`), mine.length ? list : h("p", { class: "muted" }, "만든 필터가 없습니다.")));
    const setName = h("input", { type: "text", placeholder: "제목 (예: 내 후보 A)", "aria-label": "번호 집합 제목" });
    const setNums = h("input", { type: "text", placeholder: "번호 직접 입력 (예: 3, 8, 14, 22, 31)", "aria-label": "번호 집합 번호", style: "min-width:16rem" });
    const setMin = h("input", { type: "number", min: 0, max: 6, value: "1", "aria-label": "포함 최소 개수", style: "width:5rem" });
    const setMax = h("input", { type: "number", min: 0, max: 6, value: "6", "aria-label": "포함 최대 개수", style: "width:5rem" });
    const keep = h("input", { type: "checkbox", id: "set-keep" });
    edit.append(h("section", {}, h("h3", {}, "번호 집합(수동필터) 만들기"),
      h("div", { class: "row" }, setName, setNums),
      h("div", { class: "row", style: "align-items:flex-end" }, h("label", { class: "field" }, "최소 포함", setMin), h("label", { class: "field" }, "최대 포함", setMax), h("label", { class: "row", style: "gap:6px;min-height:40px" }, keep, "회차가 바뀌어도 보존"),
        h("button", { type: "button", class: "btn primary", onclick: () => {
          const nums = (setNums as HTMLInputElement).value.split(/[\s,;/.|-]+/).filter(Boolean).map((t) => parseInt(t, 10));
          if (!nums.length || nums.some((n) => !(n >= 1 && n <= 45))) return err("1~45 사이 번호를 입력하세요. (쉼표·공백으로 구분)");
          if (new Set(nums).size !== nums.length) return err("중복된 번호가 있습니다.");
          const mn = Math.max(0, Math.min(nums.length, parseInt((setMin as HTMLInputElement).value, 10) || 0));
          const mx = Math.max(0, Math.min(nums.length, 6, parseInt((setMax as HTMLInputElement).value, 10) || 0));
          if (mn > mx) return err("최소가 최대보다 클 수 없습니다.");
          state.rules.push({ key: `set:${uid()}`, label: (setName as HTMLInputElement).value.trim() || "내 번호 집합", set: nums.sort((a, b) => a - b), min: mn, max: mx, preserve: (keep as HTMLInputElement).checked, enabled: true, round: target });
          commit(); drawEdit();
        } }, "수동필터 추가")),
      h("p", { class: "muted" }, "최대는 선택한 번호 수(6개 이하)로 제한됩니다.")));
    const exName = h("input", { type: "text", placeholder: "이름", "aria-label": "표현식 이름" });
    const exSrc = h("input", { type: "text", placeholder: "예: sum >= 100 && sum <= 175 && odd == 3 && !has(7)", "aria-label": "표현식", style: "min-width:20rem;flex:1" });
    edit.append(h("section", {}, h("h3", {}, "표현식 만들기"), h("div", { class: "row" }, exName, exSrc, h("button", { type: "button", class: "btn primary", onclick: () => {
      const src = (exSrc as HTMLInputElement).value.trim();
      const chk = checkExpr(src);
      if (!chk.ok) return err(chk.error);
      state.rules.push({ key: `expr:${uid()}`, label: (exName as HTMLInputElement).value || "내 표현식", expr: src, enabled: true, round: target });
      commit(); drawEdit();
    } }, "표현식 추가")),
      h("p", { class: "muted" }, "필터 이름(sum, ac, odd …)·n1~n6·has(n)·min/max/abs와 + - * / % < > == != && || ! 를 쓸 수 있습니다. 임의 코드는 실행되지 않습니다."), msg));
  }

  /* ====================== 결과 패널(오른쪽) ====================== */
  const countInput = h("input", { type: "number", id: "count", min: 1, max: MAX_COUNT, value: "10", class: "num", style: "width:6rem", "aria-label": "생성 개수" });
  const runBtn = h("button", { type: "button", class: "btn primary", onclick: () => void run() }, "조합 생성");
  const analyzeBtn = h("button", { type: "button", class: "btn", onclick: () => void analyze() }, "단계별 분석");
  const diagnoseBtn = h("button", { type: "button", class: "btn", onclick: () => void runDiagnose() }, "필터 진단");
  const backBtn2 = h("button", { type: "button", class: "btn quiet", onclick: () => checkHistory() }, "과거 통과율");
  const cancelBtn = h("button", { type: "button", class: "btn", hidden: true, onclick: () => { cancel = true; job?.cancel(); } }, "취소");
  const setRunning = (r: boolean) => { running = r; for (const b of [runBtn, analyzeBtn, diagnoseBtn, backBtn2]) b.disabled = r; cancelBtn.hidden = !r; };

  function drawSide() {
    clear(activeBox);
    const act = activeRules();
    const regs = act.filter((r) => parseRegressKey(r.key) !== null);
    const list = act.filter((r) => parseRegressKey(r.key) === null);
    for (const r of list) {
      const def = FILTER_BY_KEY.get(r.key);
      activeBox.append(h("button", { type: "button", onclick: () => select(def ? { kind: "filter", key: r.key } : { kind: "custom" }) }, h("span", { class: "nm" }, r.label ?? def?.label ?? r.key), h("span", { class: "sm" }, shortSummary(r))));
    }
    if (regs.length) activeBox.append(h("button", { type: "button", onclick: () => select({ kind: "regress" }) }, h("span", { class: "nm" }, "회귀"), h("span", { class: "sm" }, `${regs.length}개`)));
    const p = state.picks;
    const picks = [p.fixed.length ? `고정 ${p.fixed.join(" ")}` : "", p.exclude.length ? `제외 ${p.exclude.join(" ")}` : "", p.candidates.length ? `후보 ${p.candidates.length}개` : ""].filter(Boolean);
    if (picks.length) activeBox.append(h("button", { type: "button", onclick: () => select({ kind: "board" }) }, h("span", { class: "nm" }, "번호 선택"), h("span", { class: "sm" }, picks.join(" · "))));
    if (!activeBox.childElementCount) activeBox.append(h("p", { class: "muted" }, "켜진 조건이 없습니다. 제한 없이 생성합니다."));
    clear(problems);
    for (const e of validateOptions({ ...state.picks, rules: activeRules(), count: 1 }, !!history())) problems.append(notice("error", e.message));
  }

  function refreshAll() {
    drawRail();
    drawSide();
    updateCounter();
  }

  async function run() {
    if (running) return;
    const count = Math.min(MAX_COUNT, Math.max(1, Math.floor(Number((countInput as HTMLInputElement).value))));
    const errs = validateOptions({ ...state.picks, rules: activeRules(), count }, !!history());
    clear(out); out.hidden = false;
    if (errs.length) return void out.append(notice("error", "조건을 수정한 뒤 다시 실행해 주세요."));
    cancel = false; setRunning(true);
    const gen = createGenerator({ count, ...state.picks, rules: activeRules(), history: history(), maxAttempts: 3_000_000 });
    while (!gen.finished) {
      gen.step(20000, () => cancel);
      const p = gen.progress();
      progress.textContent = `생성 중… ${p.found}/${count}개 · 시도 ${p.attempts.toLocaleString()}회`;
      await new Promise((r) => setTimeout(r, 0));
    }
    setRunning(false); progress.textContent = "";
    const res = gen.result();
    showResult(res.combos.map((c) => [...c]), res.reason, res.attempts, res.rejectedByRule, count);
  }

  function showResult(combos: number[][], reason: string, attempts: number, rejected: Record<string, number>, requested: number) {
    clear(out); out.hidden = false;
    const reasonText = reason === "done" ? "" : reason === "cancelled" ? "취소했습니다." : "시도 상한에 도달했습니다. 조건에 맞는 조합이 없다는 뜻은 아닙니다.";
    out.append(h("div", { class: "row between" }, h("h3", {}, `결과 ${combos.length}개`), h("span", { class: "muted" }, `요청 ${requested}개 · 시도 ${attempts.toLocaleString()}회`)));
    if (reasonText) out.append(notice("warn", `요청보다 적게 생성되었습니다. ${reasonText}`));
    if (!combos.length) return;
    const rows = h("div", {});
    combos.forEach((c, i) => rows.append(h("div", { class: "out-row" }, h("span", { class: "num muted" }, String(i + 1)), balls(c), h("span", { class: "mt" }, `합 ${sum(c)} · AC ${acValue(c)}`, h("br"), `홀짝 ${oddCount(c)}:${6 - oddCount(c)} · 저고 ${6 - highCount(c)}:${highCount(c)}`))));
    out.append(rows);
    const rej = Object.entries(rejected).sort((a, b) => b[1] - a[1]);
    if (rej.length) out.append(h("details", {}, h("summary", {}, "필터별 탈락 내역 (적용 순서상 처음 걸린 필터 기준)"), h("ul", {}, ...rej.map(([k, v]) => h("li", {}, `${labelOf(k)}: ${v.toLocaleString()}회`)))));
    const batch: Batch = { id: uid(), name: `${targetRound()}회 생성 ${fmtDate(new Date().toISOString())}`, round: targetRound(), createdAt: new Date().toISOString(), source: "generated", memo: "", combos: combos.map((numbers) => ({ numbers })), snapshot: { rules: structuredClone(state.rules), picks: structuredClone(state.picks) } };
    state.batches.unshift(batch);
    void persist().then((ok) => out.append(ok ? notice("ok", "조합번호 보관함에 자동 저장했습니다. ", h("a", { href: "#/vault" }, "보관함 열기")) : notice("error", "저장하지 못했습니다. 보관함에서 백업(JSON)을 내려받아 주세요.")));
  }

  async function analyze() {
    const errs = validateOptions({ ...state.picks, rules: activeRules(), count: 1 }, !!history());
    clear(out); out.hidden = false;
    if (errs.length) return void out.append(notice("error", "조건을 수정한 뒤 다시 실행해 주세요."));
    cancel = false; setRunning(true);
    const j = startJob(jobReq("count"), (v, t) => (progress.textContent = `전체 조합을 세는 중… ${t ? Math.min(99, Math.floor((v / t) * 100)) : 0}%`));
    job = j; const r = await j.promise; job = null;
    setRunning(false); progress.textContent = "";
    if (!r || r.cancelled) return void out.append(notice("warn", "취소했습니다. 부분 결과는 표시하지 않습니다."));
    out.append(h("h3", {}, "단계별 분석 (정확한 조합 수)"), h("p", {}, `후보 공간 ${r.total.toLocaleString()}개 중 모든 필터 통과 `, h("strong", { class: "num" }, r.passed.toLocaleString()), `개 (${r.total ? ((r.passed / r.total) * 100).toFixed(2) : "0"}%)`));
    if (r.cumulative.length) {
      out.append(h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "필터(적용 순서)"), h("th", { class: "n" }, "누적 남은 수"), h("th", { class: "n" }, "단독 통과 수"))),
        h("tbody", {}, ...r.cumulative.map((c) => h("tr", {}, h("td", {}, labelOf(c.key)), h("td", { class: "n" }, c.remaining.toLocaleString()), h("td", { class: "n" }, (r.independent[c.key] ?? 0).toLocaleString())))))));
    }
    out.append(h("p", { class: "muted" }, "통과 조합 수는 당첨 확률과 무관합니다. 모든 조합의 당첨 확률은 같습니다."));
  }

  async function runDiagnose() {
    const errs = validateOptions({ ...state.picks, rules: activeRules(), count: 1 }, !!history());
    clear(out); out.hidden = false;
    if (errs.length) return void out.append(notice("error", "조건을 수정한 뒤 다시 실행해 주세요."));
    if (!activeRules().length) return void out.append(notice("info", "켜져 있는 필터가 없어 진단할 내용이 없습니다."));
    cancel = false; setRunning(true);
    const j = startJob(jobReq("diagnose"), (v, t) => (progress.textContent = `필터를 진단하는 중… ${t ? Math.min(99, Math.floor((v / t) * 100)) : 0}%`));
    job = j; const d = await j.promise; job = null;
    setRunning(false); progress.textContent = "";
    if (!d || d.cancelled) return void out.append(notice("warn", "취소했습니다. 부분 결과는 표시하지 않습니다."));
    out.append(h("h3", {}, "필터 진단"), h("p", {}, `후보 공간 ${d.total.toLocaleString()}개 중 모든 필터 통과 ${d.passed.toLocaleString()}개. 필터 1개만 어겨 탈락 ${d.failedHistogram[1].toLocaleString()}개, 2개 이상 어겨 탈락 ${d.failedHistogram[2].toLocaleString()}개.`));
    const top = d.rules.filter((r) => r.blockedAlone > 0);
    if (d.passed === 0) out.append(notice("warn", top.length ? `통과하는 조합이 없습니다. 가장 많이 막는 필터는 '${labelOf(top[0]!.key)}'이며, 이것 하나만 끄면 ${top[0]!.blockedAlone.toLocaleString()}개가 되살아납니다.` : "통과하는 조합이 없습니다. 어느 필터 하나만 꺼서는 풀리지 않고 여러 필터가 함께 막고 있습니다."));
    if (top.length) {
      out.append(h("div", { class: "scroll" }, h("table", {}, h("caption", {}, "이 필터 하나만 끄면 되살아나는 조합 수 (많이 막는 순)"), h("thead", {}, h("tr", {}, h("th", {}, "필터"), h("th", { class: "n" }, "단독 차단 조합 수"))),
        h("tbody", {}, ...top.slice(0, 30).map((r) => h("tr", {}, h("td", {}, labelOf(r.key)), h("td", { class: "n" }, r.blockedAlone.toLocaleString())))))));
      if (top.length > 30) out.append(h("p", { class: "muted" }, `상위 30개만 표시했습니다 (전체 ${top.length}개).`));
    }
  }

  function checkHistory() {
    clear(out); out.hidden = false;
    if (state.draws.state !== "ok") return void out.append(notice("info", "당첨 이력 데이터가 없어 계산할 수 없습니다."));
    const draws = state.draws.draws.filter((d) => d.round < targetRound());
    const r = backtest(activeRules(), draws);
    out.append(notice("info", `현재 켜진 필터가 과거 ${r.tested}회 당첨번호 중 ${r.passed}회(${r.tested ? ((r.passed / r.tested) * 100).toFixed(1) : 0}%)를 통과시켰습니다.${r.skipped ? ` (이력이 필요한 필터 때문에 첫 ${r.skipped}회 제외)` : ""} 이 비율은 구매 조합의 당첨률이 아닙니다.`));
  }

  side.append(
    counterBox, problems,
    h("section", { class: "gen" }, h("h3", { class: "eyebrow" }, "켜진 조건"), activeBox),
    h("section", { class: "gen" }, h("h3", { class: "eyebrow" }, "생성"),
      h("div", { class: "chips" }, ...[5, 10, 20, 50, 100].map((n) => h("button", { type: "button", class: "chip", onclick: () => ((countInput as HTMLInputElement).value = String(n)) }, String(n)))),
      h("div", { class: "row" }, h("label", { class: "sr", for: "count" }, "생성 개수"), countInput, runBtn, cancelBtn),
      h("div", { class: "row" }, analyzeBtn, diagnoseBtn, backBtn2), progress),
  );
  wb.append(rail, edit, side);
  root.append(
    h("div", { class: "page-head" }, h("h2", {}, "조합 만들기"), h("p", { class: "muted" }, DISCLAIMER)),
    state.draws.state !== "ok" ? notice("warn", "당첨 이력 데이터가 없습니다. 과거 이력 필터와 결과 대조는 사용할 수 없습니다.") : "",
    wb, out,
  );
  drawRail();
  drawEdit();
  drawSide();
  updateCounter();
}
