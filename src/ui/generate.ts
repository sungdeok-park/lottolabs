import { createGenerator, validateOptions } from "../core/generate";
import { FILTERS, FILTER_BY_KEY, REGRESS_MAX, checkExpr, describeRule, effectiveRules, parseRegressKey, regressKey, type FilterDef } from "../core/filters";
import { spaceSize, type JobRequest } from "../core/jobs";
import { startJob, type JobHandle } from "./jobClient";
import { backtest, recentMetricRange, regressionRecentRange } from "../core/stats";
import { acValue, highCount, oddCount, sum } from "../core/metrics";
import { historyBefore } from "../core/draws";
import type { FilterRule } from "../core/types";
import { nextRound, persist, state, type Batch } from "../state";
import { balls, DISCLAIMER, fmtDate, notice, uid } from "./common";
import { clear, h } from "./dom";

const getRule = (key: string) => state.rules.find((r) => r.key === key);
const labelOf = (key: string) => state.rules.find((r) => r.key === key)?.label ?? FILTER_BY_KEY.get(key)?.label ?? (parseRegressKey(key) !== null ? `${parseRegressKey(key)}회귀` : key);
const MAX_COUNT = 500; // 성능 시험 전 임시 상한

function parseValues(s: string): number[] {
  return s
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n));
}

function targetRound() {
  return state.targetRound > 0 ? state.targetRound : nextRound();
}

const activeRules = () => effectiveRules(state.rules, targetRound());

function jobReq<K extends JobRequest["kind"]>(kind: K): JobRequest & { kind: K } {
  return { kind, picks: structuredClone(state.picks), rules: structuredClone(activeRules()), draws: state.draws.state === "ok" ? state.draws.draws.filter((d) => d.round < targetRound()) : [], targetRound: targetRound() };
}

function history() {
  return state.draws.state === "ok" ? historyBefore(state.draws.draws, targetRound()) : undefined;
}

type Mode = "fixed" | "exclude" | "candidates";
const MODE_LABEL: Record<Mode, string> = { fixed: "고정", exclude: "제외", candidates: "후보" };

export function renderGenerate(root: HTMLElement) {
  let mode: Mode = "fixed";
  let cancel = false;
  let running = false;
  const out = h("div", { class: "out" });
  const problems = h("div");
  const board = h("div", { class: "board", role: "group", "aria-label": "번호판" });
  const filterBox = h("div");
  const roundInput = h("input", {
    type: "number",
    min: 1,
    id: "round",
    value: String(targetRound()),
    onchange: (e: Event) => {
      state.targetRound = Number((e.target as HTMLInputElement).value) || 0;
      void persist();
      drawFilters();
      refresh();
    },
  });

  // ---- 상단 실시간 조합 수 ----
  const counterBox = h("div", { class: "counter", role: "status", "aria-live": "polite" });
  let liveJob: JobHandle<unknown> | null = null;
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  const LIVE_AUTO_MAX_RULES = 20;
  const fmt = (n: number) => n.toLocaleString();
  const updateCounter = () => {
    clearTimeout(liveTimer);
    liveJob?.cancel();
    liveJob = null;
    clear(counterBox);
    const errs = validateOptions({ ...state.picks, rules: activeRules(), count: 1 }, !!history());
    const rules = activeRules();
    const total = spaceSize(state.picks);
    const head = (...kids: (Node | string)[]) => counterBox.append(h("span", { class: "label-caps" }, "조합 수 "), ...kids, h("span", { class: "muted" }, ` · 켜진 필터 ${rules.length}개`));
    if (errs.length) return void head(h("strong", {}, "조건 확인 필요"));
    if (!rules.length) return void head(h("strong", { class: "big" }, fmt(total)));
    const calc = () => {
      clear(counterBox);
      head(h("strong", { class: "big" }, "계산 중… 0%"));
      const j = startJob(jobReq("count"), (v, t) => { const el = counterBox.querySelector(".big"); if (el) el.textContent = `계산 중… ${t ? Math.min(99, Math.floor((v / t) * 100)) : 0}%`; });
      liveJob = j;
      void j.promise.then((r) => {
        if (liveJob !== j || !r) return;
        clear(counterBox);
        head(h("strong", { class: "big" }, fmt(r.passed)), h("span", { class: "muted" }, ` / ${fmt(r.total)} (${r.total ? ((r.passed / r.total) * 100).toFixed(2) : "0"}%)`));
      });
    };
    if (rules.length > LIVE_AUTO_MAX_RULES) {
      head(h("strong", { class: "big" }, `≤ ${fmt(total)}`), h("button", { type: "button", onclick: calc }, "정확히 계산"));
    } else liveTimer = setTimeout(calc, 600);
  };

  const refresh = () => {
    updateCounter();
    clear(problems);
    const errs = validateOptions({ ...state.picks, rules: activeRules(), count: 1 }, !!history());
    for (const e of errs) problems.append(notice("error", e.message));
    drawBoard();
    summary();
  };

  const summaryBox = h("div", { class: "summary" });
  const summary = () => {
    clear(summaryBox);
    const act = activeRules();
    const active = act.length;
    const p = state.picks;
    summaryBox.append(
      h("strong", {}, "현재 조건"),
      h("div", {}, `고정 ${p.fixed.join(", ") || "없음"} · 제외 ${p.exclude.join(", ") || "없음"} · 후보 ${p.candidates.length ? p.candidates.length + "개" : "전체"}`),
      h("div", {}, active ? [...act.filter((r) => parseRegressKey(r.key) === null).map(describeRule), ...(act.some((r) => parseRegressKey(r.key) !== null) ? [`회귀 ${act.filter((r) => parseRegressKey(r.key) !== null).length}개`] : [])].join(" · ") : "필터: 제한 없음"),
    );
  };

  const drawBoard = () => {
    clear(board);
    const p = state.picks;
    for (let n = 1; n <= 45; n++) {
      const tag = p.fixed.includes(n) ? "고정" : p.exclude.includes(n) ? "제외" : p.candidates.includes(n) ? "후보" : "";
      board.append(
        h(
          "button",
          {
            type: "button",
            class: `cell ${tag ? "on-" + tag : ""}`,
            "aria-pressed": tag ? "true" : "false",
            "aria-label": `${n}${tag ? " " + tag : ""}`,
            onclick: () => toggleNumber(n),
          },
          h("span", {}, String(n)),
          tag ? h("small", {}, tag) : null,
        ),
      );
    }
  };

  const toggleNumber = (n: number) => {
    const p = state.picks;
    const has = p[mode].includes(n);
    p.fixed = p.fixed.filter((x) => x !== n);
    p.exclude = p.exclude.filter((x) => x !== n);
    p.candidates = p.candidates.filter((x) => x !== n);
    if (!has) p[mode] = [...p[mode], n].sort((a, b) => a - b);
    void persist();
    refresh();
  };

  const modeBar = h(
    "div",
    { class: "seg", role: "radiogroup", "aria-label": "번호판 모드" },
    ...(["fixed", "exclude", "candidates"] as Mode[]).map((m) => {
      const id = `mode-${m}`;
      return h(
        "label",
        { for: id },
        h("input", { type: "radio", name: "mode", id, checked: m === mode, onchange: () => (mode = m) }),
        MODE_LABEL[m],
      );
    }),
    h(
      "button",
      {
        type: "button",
        class: "link",
        onclick: () => {
          state.picks = { fixed: [], exclude: [], candidates: [] };
          void persist();
          refresh();
        },
      },
      "번호판 초기화",
    ),
  );

  function statsPanel(def: FilterDef) {
    const d = h("details", { class: "stats" }, h("summary", {}, "통계 보기"));
    d.addEventListener("toggle", () => {
      if (!d.open || d.childElementCount > 1) return;
      if (state.draws.state !== "ok") {
        d.append(notice("info", "당첨 이력 데이터가 없어 과거 분포를 표시할 수 없습니다."));
        return;
      }
      const draws = state.draws.draws.filter((x) => x.round < targetRound());
      const counts = new Map<number, number>();
      draws.forEach((x, i) => {
        const v = def.compute(x.numbers, { draws: draws.slice(0, i) });
        counts.set(v, (counts.get(v) ?? 0) + 1);
      });
      const rows = [...counts.entries()].sort((a, b) => a[0] - b[0]);
      const t = h("table", {}, h("caption", {}, `${draws.length}회차 본번호 기준 값 분포 (보너스 제외)`), h("thead", {}, h("tr", {}, h("th", {}, "값"), h("th", {}, "회차 수"), h("th", {}, "비율"))));
      const tb = h("tbody");
      for (const [v, c] of rows) tb.append(h("tr", {}, h("td", {}, String(v)), h("td", {}, String(c)), h("td", {}, `${((c / draws.length) * 100).toFixed(1)}%`)));
      t.append(tb);
      d.append(t, h("p", { class: "muted" }, "과거 통과율은 구매 조합의 당첨률이 아닙니다."));
    });
    return d;
  }

  function filterCard(def: FilterDef) {
    const rule = getRule(def.key);
    const on = !!rule;
    const update = (patch: Partial<FilterRule> | null) => {
      state.rules = state.rules.filter((r) => r.key !== def.key);
      if (patch) {
        const next: FilterRule = { key: def.key, ...patch };
        for (const k of ["min", "max"] as const) if (next[k] === undefined || Number.isNaN(next[k])) delete next[k];
        if (!next.values?.length) delete next.values;
        state.rules.push(next);
      }
      void persist();
      refresh();
    };
    const num = (v: string) => (v === "" ? undefined : Number(v));
    const disabledHistory = def.needsHistory && !history();
    return h(
      "div",
      { class: `card ${on ? "active" : ""}` },
      h(
        "label",
        { class: "toggle" },
        h("input", {
          type: "checkbox",
          checked: on,
          disabled: disabledHistory,
          onchange: (e: Event) => {
            update((e.target as HTMLInputElement).checked ? { values: [] } : null);
            drawFilters();
          },
        }),
        h("strong", {}, def.label),
        h("span", { class: `state ${on ? "yes" : ""}` }, on ? "사용 중" : "꺼짐"),
      ),
      h("div", { class: "muted" }, def.description),
      disabledHistory ? h("div", { class: "muted" }, "당첨 이력이 필요합니다.") : null,
      on
        ? h(
            "div",
            { class: "inputs" },
            h("label", {}, "허용 값 ", h("input", { type: "text", inputMode: "numeric", placeholder: "예) 2,3,4", value: (rule?.values ?? []).join(","), onchange: (e: Event) => update({ ...getRule(def.key), values: parseValues((e.target as HTMLInputElement).value) }) })),
            h("label", {}, "최소 ", h("input", { type: "number", min: def.domain[0], max: def.domain[1], value: rule?.min !== undefined ? String(rule.min) : "", onchange: (e: Event) => update({ ...getRule(def.key), min: num((e.target as HTMLInputElement).value) }) })),
            h("label", {}, "최대 ", h("input", { type: "number", min: def.domain[0], max: def.domain[1], value: rule?.max !== undefined ? String(rule.max) : "", onchange: (e: Event) => update({ ...getRule(def.key), max: num((e.target as HTMLInputElement).value) }) })),
            h("small", { class: "muted" }, `가능 범위 ${def.domain[0]}~${def.domain[1]}`),
          )
        : null,
      statsPanel(def),
    );
  }

  function customSection() {
    const box = h("div", { class: "card" }, h("strong", {}, "내 필터 (수동 번호 집합 · 표현식)"));
    const target = targetRound();
    const isStale = (r: FilterRule) => r.round !== undefined && !r.preserve && r.round < target;
    const mine = state.rules.filter((r) => r.set || r.expr !== undefined);
    const save = () => { void persist(); drawFilters(); refresh(); };
    const row = (r: FilterRule, stale: boolean) => h("div", { class: "row between", style: stale ? "opacity:.6" : "" },
      h("label", { class: "toggle", style: "min-height:32px" },
        h("input", { type: "checkbox", checked: r.enabled !== false && !stale, disabled: stale, "aria-label": `${r.label ?? r.key} 적용`, onchange: (e: Event) => { r.enabled = (e.target as HTMLInputElement).checked; save(); } }),
        h("span", {}, describeRule({ ...r, enabled: undefined }) + (r.set ? ` ← {${r.set.join(",")}}` : "")),
        r.round !== undefined ? h("small", { class: "muted" }, `${r.round}회차${stale ? " (지난 회차)" : ""}`) : null),
      h("span", { class: "row" },
        h("label", { title: "회차가 바뀌어도 유지" }, h("input", { type: "checkbox", checked: !!r.preserve, onchange: (e: Event) => { r.preserve = (e.target as HTMLInputElement).checked; save(); } }), " 보존"),
        h("button", { type: "button", class: "danger", onclick: () => { state.rules = state.rules.filter((x) => x !== r); save(); } }, "삭제")));
    for (const r of mine.filter((x) => !isStale(x))) box.append(row(r, false));
    const stale = mine.filter(isStale);
    if (stale.length) box.append(h("details", {}, h("summary", {}, `이전 회차 필터 (${stale.length}개) — 적용되지 않음`), ...stale.map((r) => row(r, true)), h("button", { type: "button", class: "danger", onclick: () => { if (confirm(`이전 회차 필터 ${stale.length}개를 모두 삭제할까요?`)) { state.rules = state.rules.filter((x) => !isStale(x) || !(x.set || x.expr !== undefined)); save(); } } }, "이전 회차 전체 삭제")));
    const msg = h("div", { role: "status" });
    const err = (t: string) => { clear(msg); msg.append(notice("error", t)); };
    const setName = h("input", { type: "text", placeholder: "필터 제목 (예: 내 후보 A)", "aria-label": "번호 집합 이름" });
    const setNums = h("input", { type: "text", placeholder: "번호 직접 입력 (예: 3, 8, 14, 22, 31)", "aria-label": "번호 집합 번호", style: "min-width:16rem" });
    const setMin = h("input", { type: "number", min: 0, max: 6, value: "1", "aria-label": "포함 최소 개수", style: "width:5rem" });
    const setMax = h("input", { type: "number", min: 0, max: 6, value: "6", "aria-label": "포함 최대 개수", style: "width:5rem" });
    const setKeep = h("input", { type: "checkbox", id: "set-keep" });
    const exName = h("input", { type: "text", placeholder: "이름", "aria-label": "표현식 이름" });
    const exSrc = h("input", { type: "text", placeholder: "예: sum >= 100 && sum <= 175 && odd == 3 && !has(7)", "aria-label": "표현식", style: "min-width:18rem" });
    const add = (rule: FilterRule) => { state.rules.push({ ...rule, round: target }); save(); };
    box.append(
      h("div", { class: "row" }, setName, setNums, h("label", {}, "최소 ", setMin), h("label", {}, "최대 ", setMax), h("label", {}, setKeep, " 보존"), h("button", { type: "button", onclick: () => {
        const tokens = (setNums as HTMLInputElement).value.split(/[\s,;/.|-]+/).filter(Boolean);
        const nums = tokens.map((t) => parseInt(t, 10));
        if (!nums.length || nums.some((n) => !(n >= 1 && n <= 45))) return err("1~45 사이 번호를 입력하세요. (쉼표·공백으로 구분)");
        if (new Set(nums).size !== nums.length) return err("중복된 번호가 있습니다.");
        const size = nums.length;
        const mn = Math.max(0, Math.min(size, parseInt((setMin as HTMLInputElement).value, 10) || 0));
        const mx = Math.max(0, Math.min(size, 6, parseInt((setMax as HTMLInputElement).value, 10) || 0));
        if (mn > mx) return err("최소가 최대보다 클 수 없습니다.");
        add({ key: `set:${uid()}`, label: (setName as HTMLInputElement).value.trim() || "내 번호 집합", set: nums.sort((a, b) => a - b), min: mn, max: mx, preserve: (setKeep as HTMLInputElement).checked, enabled: true });
      } }, "수동필터 추가")),
      h("p", { class: "muted" }, "최소·최대는 이 집합의 번호가 한 조합에 들어가는 개수입니다. 선택한 번호가 6개 미만이면 최대는 그 개수로 제한됩니다."),
      h("div", { class: "row" }, exName, exSrc, h("button", { type: "button", onclick: () => {
        const src = (exSrc as HTMLInputElement).value.trim();
        const chk = checkExpr(src);
        if (!chk.ok) return err(chk.error);
        add({ key: `expr:${uid()}`, label: (exName as HTMLInputElement).value || "내 표현식", expr: src, enabled: true });
      } }, "표현식 추가")),
      h("p", { class: "muted" }, "표현식: 필터 이름(sum, ac, odd …)·n1~n6·has(n)·min/max/abs와 + - * / % < > == != && || ! 를 쓸 수 있습니다. 임의 코드는 실행되지 않습니다."),
      msg,
    );
    return box;
  }

  let regressNote: ["ok" | "warn" | "error" | "info", string] | null = null;
  let regOpen = false;
  const openGroups = new Set<string>();
  function regressionSection() {
    const regSteps = Array.from({ length: REGRESS_MAX }, (_, i) => i + 1);
    const getReg = (n: number) => state.rules.find((r) => r.key === regressKey(n));
    const onCount = () => regSteps.filter((n) => { const r = getReg(n); return r && r.enabled !== false; }).length;
    const box = h("details", { class: "card", open: regOpen || onCount() > 0 },
      h("summary", {}, h("strong", {}, "회귀 필터 (1~200회귀)"), " ", h("span", { class: "state yes", id: "reg-count" }, `${onCount()}개 켜짐`)));
    box.addEventListener("toggle", () => { regOpen = box.open; });
    box.append(h("p", { class: "muted" }, "N회귀: 목표 회차에서 N회 전 당첨 본번호와 겹치는 번호의 개수입니다. 1회귀는 이월수와 같고, 1~200회귀를 모두 동시에 켤 수 있습니다."));
    const msg = h("div", { role: "status" });
    const say = (kind: "ok" | "warn" | "error" | "info", t: string) => { regressNote = [kind, t]; clear(msg); msg.append(notice(kind, t)); };
    const history2 = () => (state.draws.state === "ok" ? state.draws.draws.filter((d) => d.round < targetRound()) : []);
    const badge = () => { const el = document.getElementById("reg-count"); if (el) el.textContent = `${onCount()}개 켜짐`; };
    const clamp = (v: string, d: number) => Math.max(0, Math.min(6, Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d));
    const ensure = (n: number): FilterRule => {
      let r = getReg(n);
      if (!r) { r = { key: regressKey(n), min: 0, max: 6, enabled: false }; state.rules.push(r); }
      return r;
    };
    const changed = () => { void persist(); badge(); refresh(); };

    const bMin = h("input", { type: "number", min: 0, max: 6, placeholder: "0", "aria-label": "일괄 최소", style: "width:4.5rem" });
    const bMax = h("input", { type: "number", min: 0, max: 6, placeholder: "6", "aria-label": "일괄 최대", style: "width:4.5rem" });
    const bulkRange = () => ({ min: clamp((bMin as HTMLInputElement).value, 0), max: clamp((bMax as HTMLInputElement).value, 6) });
    const redraw = () => { void persist(); drawFilters(); refresh(); };
    box.append(
      h("div", { class: "row" },
        h("span", {}, "일괄 적용"), bMin, "~", bMax,
        h("button", { type: "button", class: "primary", onclick: () => {
          const { min, max } = bulkRange();
          if (min > max) return say("error", "최소가 최대보다 큽니다.");
          for (const n of regSteps) Object.assign(ensure(n), { min, max, enabled: true });
          say("ok", `1~200회귀 ${REGRESS_MAX}개를 ${min}~${max}로 켰습니다.`); redraw();
        } }, "일괄 필터 적용"),
        h("button", { type: "button", onclick: () => { for (const n of regSteps) ensure(n).enabled = true; say("ok", "전체 ON"); redraw(); } }, "전체 ON"),
        h("button", { type: "button", onclick: () => { for (const r of state.rules) if (parseRegressKey(r.key) !== null) r.enabled = false; say("info", "전체 OFF (설정값은 유지)"); redraw(); } }, "전체 OFF"),
        h("button", { type: "button", onclick: () => {
          if (state.draws.state !== "ok") return say("info", "당첨 이력이 없어 계산할 수 없습니다.");
          const hist = history2();
          let withData = 0;
          for (const n of regSteps) {
            const rg = regressionRecentRange(hist, targetRound(), n);
            if (rg) withData++;
            Object.assign(ensure(n), { min: rg?.min ?? 0, max: rg?.max ?? 6, enabled: true });
          }
          say("ok", `${REGRESS_MAX}개 회귀를 켰습니다. 최근 10회 기준 범위를 계산한 것은 ${withData}개이고, 이력이 모자란 ${REGRESS_MAX - withData}개는 0~6(제한 없음)입니다.`); redraw();
        } }, "최근 10회 기준 일괄 적용 (원본 방식)"),
        h("button", { type: "button", class: "danger", onclick: () => { state.rules = state.rules.filter((r) => parseRegressKey(r.key) === null); say("info", "회귀 필터 설정을 모두 지웠습니다."); redraw(); } }, "설정 모두 삭제")),
    );
    const t = h("table", {}, h("thead", {}, h("tr", {}, ...["회귀", "사용", "최소", "최대"].map((x) => h("th", {}, x)))));
    const tb = h("tbody");
    for (const n of regSteps) {
      const r = getReg(n);
      tb.append(h("tr", {},
        h("td", {}, `${n}회귀`),
        h("td", {}, h("input", { type: "checkbox", checked: !!r && r.enabled !== false, "aria-label": `${n}회귀 사용`, onchange: (e: Event) => { ensure(n).enabled = (e.target as HTMLInputElement).checked; changed(); } })),
        h("td", {}, h("input", { type: "number", min: 0, max: 6, value: String(r?.min ?? 0), "aria-label": `${n}회귀 최소`, style: "width:4.5rem", onchange: (e: Event) => { ensure(n).min = clamp((e.target as HTMLInputElement).value, 0); changed(); } })),
        h("td", {}, h("input", { type: "number", min: 0, max: 6, value: String(r?.max ?? 6), "aria-label": `${n}회귀 최대`, style: "width:4.5rem", onchange: (e: Event) => { ensure(n).max = clamp((e.target as HTMLInputElement).value, 6); changed(); } })),
      ));
    }
    t.append(tb);
    if (regressNote) msg.append(notice(regressNote[0], regressNote[1]));
    box.append(msg, h("div", { class: "scroll", style: "max-height:420px;overflow:auto" }, t));
    return box;
  }

  function backtestBox() {
    const box = h("div", { class: "card" }, h("strong", {}, "과거 통과율"));
    const out2 = h("div");
    box.append(h("button", { type: "button", onclick: () => {
      clear(out2);
      if (state.draws.state !== "ok") { out2.append(notice("info", "당첨 이력 데이터가 없어 계산할 수 없습니다.")); return; }
      const draws = state.draws.draws.filter((d) => d.round < targetRound());
      const r = backtest(activeRules(), draws);
      out2.append(notice("info", `현재 활성 필터가 과거 ${r.tested}회 당첨번호 중 ${r.passed}회(${r.tested ? ((r.passed / r.tested) * 100).toFixed(1) : 0}%)를 통과시켰습니다.${r.skipped ? ` (이력이 필요한 필터 때문에 첫 ${r.skipped}회 제외)` : ""} 이 비율은 구매 조합의 당첨률이 아닙니다.`));
    } }, "과거 회차로 확인"), out2);
    return box;
  }

  function drawFilters() {
    clear(filterBox);
    filterBox.append(customSection(), regressionSection(), backtestBox());
    const groups = [...new Set(FILTERS.map((f) => f.group))];
    groups.forEach((g, gi) => {
      const list = FILTERS.filter((f) => f.group === g);
      const active = list.filter((f) => getRule(f.key)).length;
      const groupTools = g === "용지" || g === "9궁"
        ? h("div", { class: "row" },
            h("button", { type: "button", onclick: () => {
              if (state.draws.state !== "ok") return void alert("당첨 이력 데이터가 없어 계산할 수 없습니다.");
              const hist = state.draws.draws.filter((d) => d.round < targetRound());
              const rows = list.filter((f) => /^(row|col|gung)\d$/.test(f.key)); // 원본처럼 가로·세로 14라인, 9궁 9개만
              const keys = new Set(rows.map((f) => f.key));
              state.rules = state.rules.filter((r) => !keys.has(r.key));
              for (const f of rows) {
                const rg = recentMetricRange({ key: f.key }, hist);
                if (rg) state.rules.push({ key: f.key, min: rg.min, max: rg.max });
              }
              void persist(); drawFilters(); refresh();
            } }, `${g} 최근 10회 범위 일괄 적용`),
            h("button", { type: "button", class: "danger", onclick: () => { const keys = new Set(list.map((f) => f.key)); state.rules = state.rules.filter((r) => !keys.has(r.key)); void persist(); drawFilters(); refresh(); } }, `${g} 필터 해제`))
        : "";
      const det = h("details", { open: gi === 0 || active > 0 || openGroups.has(g) }, h("summary", {}, h("strong", {}, `${g} (${list.length}개${active ? ` · 사용 중 ${active}` : ""})`)), groupTools, h("div", { class: "cards" }, ...list.map(filterCard)));
      det.addEventListener("toggle", () => { if (det.open) openGroups.add(g); else openGroups.delete(g); });
      filterBox.append(det);
    });
  }

  // ---- 실행 ----
  const countInput = h("input", { type: "number", id: "count", min: 1, max: MAX_COUNT, value: "10" });
  const runBtn = h("button", { type: "button", class: "primary", onclick: () => void run() }, "조합 생성");
  let job: JobHandle<unknown> | null = null;
  const cancelBtn = h("button", { type: "button", hidden: true, onclick: () => { cancel = true; job?.cancel(); } }, "취소");
  const analyzeBtn = h("button", { type: "button", onclick: () => void analyze() }, "단계별 분석 (정확한 조합 수)");
  const diagnoseBtn = h("button", { type: "button", onclick: () => void runDiagnose() }, "필터 진단");
  const progress = h("div", { role: "status", "aria-live": "polite" });

  const setRunning = (r: boolean) => {
    running = r;
    runBtn.disabled = r;
    analyzeBtn.disabled = r;
    diagnoseBtn.disabled = r;
    cancelBtn.hidden = !r;
  };

  async function run() {
    if (running) return;
    const count = Math.min(MAX_COUNT, Math.max(1, Math.floor(Number((countInput as HTMLInputElement).value))));
    const errs = validateOptions({ ...state.picks, rules: activeRules(), count }, !!history());
    clear(out);
    if (errs.length) {
      out.append(notice("error", "조건을 수정한 뒤 다시 실행해 주세요."));
      return;
    }
    cancel = false;
    setRunning(true);
    const gen = createGenerator({ count, ...state.picks, rules: activeRules(), history: history(), maxAttempts: 3_000_000 });
    while (!gen.finished) {
      gen.step(20000, () => cancel);
      const p = gen.progress();
      progress.textContent = `생성 중… ${p.found}/${count}개 · 시도 ${p.attempts.toLocaleString()}회`;
      await new Promise((r) => setTimeout(r, 0));
    }
    setRunning(false);
    progress.textContent = "";
    const res = gen.result();
    showResult(res.combos.map((c) => [...c]), res.reason, res.attempts, res.rejectedByRule, count);
  }

  function showResult(combos: number[][], reason: string, attempts: number, rejected: Record<string, number>, requested: number) {
    clear(out);
    const reasonText = reason === "done" ? "" : reason === "cancelled" ? "취소했습니다." : "시도 상한에 도달했습니다. 조건에 맞는 조합이 없다는 뜻은 아닙니다.";
    out.append(h("h3", {}, `결과 ${combos.length}개 (요청 ${requested}개 · 시도 ${attempts.toLocaleString()}회)`));
    if (reasonText) out.append(notice("warn", `요청보다 적게 생성되었습니다. ${reasonText}`));
    if (!combos.length) return;
    const t = h("table", { class: "result" }, h("thead", {}, h("tr", {}, ...["#", "번호", "총합", "AC", "홀:짝", "저:고"].map((x) => h("th", {}, x)))));
    const tb = h("tbody");
    combos.forEach((c, i) => tb.append(h("tr", {}, h("td", {}, String(i + 1)), h("td", {}, balls(c)), h("td", {}, String(sum(c))), h("td", {}, String(acValue(c))), h("td", {}, `${oddCount(c)}:${6 - oddCount(c)}`), h("td", {}, `${6 - highCount(c)}:${highCount(c)}`))));
    t.append(tb);
    out.append(h("div", { class: "scroll" }, t));
    const rej = Object.entries(rejected).sort((a, b) => b[1] - a[1]);
    if (rej.length) {
      out.append(h("details", {}, h("summary", {}, "필터별 탈락 내역 (적용 순서상 처음 걸린 필터 기준)"), h("ul", {}, ...rej.map(([k, v]) => h("li", {}, `${labelOf(k)}: ${v.toLocaleString()}회`)))));
    }
    const batch: Batch = {
      id: uid(),
      name: `${targetRound()}회 생성 ${fmtDate(new Date().toISOString())}`,
      round: targetRound(),
      createdAt: new Date().toISOString(),
      source: "generated",
      memo: "",
      combos: combos.map((numbers) => ({ numbers })),
      snapshot: { rules: structuredClone(state.rules), picks: structuredClone(state.picks) },
    };
    state.batches.unshift(batch);
    void persist().then((ok) => {
      out.append(ok ? notice("ok", "조합번호 보관함에 자동 저장했습니다.", h("a", { href: "#/vault" }, " 보관함 열기")) : notice("error", "저장하지 못했습니다. 보관함에서 백업(JSON)을 내려받아 주세요."));
    });
  }

  async function analyze() {
    const errs = validateOptions({ ...state.picks, rules: activeRules(), count: 1 }, !!history());
    clear(out);
    if (errs.length) {
      out.append(notice("error", "조건을 수정한 뒤 다시 실행해 주세요."));
      return;
    }
    cancel = false;
    setRunning(true);
    progress.textContent = "전체 조합을 세는 중… (조건에 따라 수 초 걸릴 수 있습니다)";
    const j = startJob(jobReq("count"), (v, t) => (progress.textContent = `전체 조합을 세는 중… ${t ? Math.min(99, Math.floor((v / t) * 100)) : 0}%`));
    job = j;
    const r = await j.promise;
    job = null;
    setRunning(false);
    progress.textContent = "";
    if (!r || r.cancelled) {
      out.append(notice("warn", "취소했습니다. 부분 결과는 표시하지 않습니다."));
      return;
    }
    out.append(h("h3", {}, "정확한 조합 수 (추정이 아닌 전체 열거)"), h("p", {}, `후보 공간 ${r.total.toLocaleString()}개 중 모든 필터 통과 ${r.passed.toLocaleString()}개 (${r.total ? ((r.passed / r.total) * 100).toFixed(2) : "0"}%)`));
    if (r.cumulative.length) {
      const t = h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "필터(적용 순서)"), h("th", {}, "누적 남은 수"), h("th", {}, "단독 통과 수"))));
      const tb = h("tbody");
      r.cumulative.forEach((c) => tb.append(h("tr", {}, h("td", {}, labelOf(c.key)), h("td", {}, c.remaining.toLocaleString()), h("td", {}, (r.independent[c.key] ?? 0).toLocaleString()))));
      t.append(tb);
      out.append(h("div", { class: "scroll" }, t));
    }
    out.append(h("p", { class: "muted" }, "통과 조합 수는 당첨 확률과 무관합니다. 모든 조합의 당첨 확률은 같습니다."));
  }

  async function runDiagnose() {
    const errs = validateOptions({ ...state.picks, rules: activeRules(), count: 1 }, !!history());
    clear(out);
    if (errs.length) return void out.append(notice("error", "조건을 수정한 뒤 다시 실행해 주세요."));
    if (!activeRules().length) return void out.append(notice("info", "켜져 있는 필터가 없어 진단할 내용이 없습니다."));
    cancel = false;
    setRunning(true);
    progress.textContent = "필터를 진단하는 중… (전체 조합을 훑습니다. 조건에 따라 시간이 걸릴 수 있습니다)";
    const j = startJob(jobReq("diagnose"), (v, t) => (progress.textContent = `필터를 진단하는 중… ${t ? Math.min(99, Math.floor((v / t) * 100)) : 0}%`));
    job = j;
    const d = await j.promise;
    job = null;
    setRunning(false);
    progress.textContent = "";
    if (!d || d.cancelled) return void out.append(notice("warn", "취소했습니다. 부분 결과는 표시하지 않습니다."));
    out.append(h("h3", {}, "필터 진단"), h("p", {}, `후보 공간 ${d.total.toLocaleString()}개 중 모든 필터 통과 ${d.passed.toLocaleString()}개. 필터 1개만 어겨 탈락 ${d.failedHistogram[1].toLocaleString()}개, 2개 이상 어겨 탈락 ${d.failedHistogram[2].toLocaleString()}개.`));
    const top = d.rules.filter((r) => r.blockedAlone > 0);
    if (d.passed === 0) {
      out.append(notice("warn", top.length ? `통과하는 조합이 없습니다. 가장 많이 막는 필터는 '${labelOf(top[0]!.key)}'이며, 이것 하나만 끄면 ${top[0]!.blockedAlone.toLocaleString()}개가 되살아납니다.` : "통과하는 조합이 없습니다. 어느 필터 하나만 꺼서는 풀리지 않고 여러 필터가 함께 막고 있습니다."));
    }
    if (top.length) {
      const t = h("table", {}, h("caption", {}, "이 필터 하나만 끄면 되살아나는 조합 수 (많이 막는 순)"), h("thead", {}, h("tr", {}, h("th", {}, "필터"), h("th", {}, "단독 차단 조합 수"))));
      const tb = h("tbody");
      for (const r of top.slice(0, 30)) tb.append(h("tr", {}, h("td", {}, labelOf(r.key)), h("td", {}, r.blockedAlone.toLocaleString())));
      t.append(tb);
      out.append(h("div", { class: "scroll" }, t), top.length > 30 ? h("p", { class: "muted" }, `상위 30개만 표시했습니다 (전체 ${top.length}개).`) : "");
    }
  }

  const presetSel = h("select", { "aria-label": "프리셋" }, h("option", { value: "" }, "프리셋 선택"), ...state.presets.map((p, i) => h("option", { value: String(i) }, p.name)));
  const presetBar = h(
    "div",
    { class: "row" },
    presetSel,
    h("button", { type: "button", onclick: () => {
      const p = state.presets[Number((presetSel as HTMLSelectElement).value)];
      if (!p) return;
      state.rules = structuredClone(p.rules);
      state.picks = structuredClone(p.picks);
      void persist();
      drawFilters();
      refresh();
    } }, "불러오기"),
    h("button", { type: "button", onclick: () => {
      const name = prompt("프리셋 이름");
      if (!name) return;
      state.presets = [...state.presets.filter((p) => p.name !== name), { name, rules: structuredClone(state.rules), picks: structuredClone(state.picks) }];
      void persist().then(() => renderGenerate(clearRoot(root)));
    } }, "현재 조건 저장"),
    h("button", { type: "button", onclick: () => {
      state.rules = [];
      void persist();
      drawFilters();
      refresh();
    } }, "필터 모두 끄기"),
  );

  root.append(
    counterBox,
    h("h2", {}, "조합 만들기"),
    notice("info", DISCLAIMER),
    state.draws.state !== "ok" ? notice("warn", "당첨 이력 데이터가 없습니다. 과거 이력 필터와 결과 대조는 사용할 수 없습니다.") : "",
    h("section", {}, h("h3", {}, "1. 목표 회차"), h("label", { for: "round" }, "추첨 회차 "), roundInput),
    h("section", {}, h("h3", {}, "2. 번호 선택"), modeBar, h("p", { class: "muted" }, "고정수는 모든 조합에 포함, 제외수는 절대 포함하지 않으며, 후보는 그 안에서만 고릅니다. 고정수와 후보는 별개 개념입니다."), board),
    h("section", {}, h("h3", {}, "3. 필터"), presetBar, filterBox),
    summaryBox,
    problems,
    h("section", { class: "sticky" }, h("h3", {}, "4. 생성"), h("div", { class: "row" }, h("label", { for: "count" }, "개수"), ...[5, 10, 20, 50, 100].map((n) => h("button", { type: "button", onclick: () => ((countInput as HTMLInputElement).value = String(n)) }, String(n))), countInput, runBtn, analyzeBtn, diagnoseBtn, cancelBtn), progress),
    out,
  );
  drawFilters();
  refresh();
}

function clearRoot(root: HTMLElement) {
  clear(root);
  return root;
}

