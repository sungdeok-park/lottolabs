import { countSpace, createGenerator, validateOptions } from "../core/generate";
import { FILTERS, FILTER_BY_KEY, describeRule, type FilterDef } from "../core/filters";
import { acValue, highCount, oddCount, sum } from "../core/metrics";
import { historyBefore } from "../core/draws";
import type { FilterRule } from "../core/types";
import { nextRound, persist, state, type Batch } from "../state";
import { balls, DISCLAIMER, fmtDate, notice, uid } from "./common";
import { clear, h } from "./dom";

const getRule = (key: string) => state.rules.find((r) => r.key === key);
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

  const refresh = () => {
    clear(problems);
    const errs = validateOptions({ ...state.picks, rules: state.rules, count: 1 }, !!history());
    for (const e of errs) problems.append(notice("error", e.message));
    drawBoard();
    summary();
  };

  const summaryBox = h("div", { class: "summary" });
  const summary = () => {
    clear(summaryBox);
    const active = state.rules.length;
    const p = state.picks;
    summaryBox.append(
      h("strong", {}, "현재 조건"),
      h("div", {}, `고정 ${p.fixed.join(", ") || "없음"} · 제외 ${p.exclude.join(", ") || "없음"} · 후보 ${p.candidates.length ? p.candidates.length + "개" : "전체"}`),
      h("div", {}, active ? state.rules.map(describeRule).join(" · ") : "필터: 제한 없음"),
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
            h("label", {}, "허용 값 ", h("input", { type: "text", inputMode: "numeric", placeholder: "예) 2,3,4", value: (rule?.values ?? []).join(","), onchange: (e: Event) => update({ ...rule, values: parseValues((e.target as HTMLInputElement).value) }) })),
            h("label", {}, "최소 ", h("input", { type: "number", min: def.domain[0], max: def.domain[1], value: rule?.min !== undefined ? String(rule.min) : "", onchange: (e: Event) => update({ ...rule, min: num((e.target as HTMLInputElement).value) }) })),
            h("label", {}, "최대 ", h("input", { type: "number", min: def.domain[0], max: def.domain[1], value: rule?.max !== undefined ? String(rule.max) : "", onchange: (e: Event) => update({ ...rule, max: num((e.target as HTMLInputElement).value) }) })),
            h("small", { class: "muted" }, `가능 범위 ${def.domain[0]}~${def.domain[1]}`),
          )
        : null,
      statsPanel(def),
    );
  }

  function drawFilters() {
    clear(filterBox);
    const groups = [...new Set(FILTERS.map((f) => f.group))];
    for (const g of groups) {
      filterBox.append(h("h3", {}, g), h("div", { class: "cards" }, ...FILTERS.filter((f) => f.group === g).map(filterCard)));
    }
  }

  // ---- 실행 ----
  const countInput = h("input", { type: "number", id: "count", min: 1, max: MAX_COUNT, value: "10" });
  const runBtn = h("button", { type: "button", class: "primary", onclick: () => void run() }, "조합 생성");
  const cancelBtn = h("button", { type: "button", hidden: true, onclick: () => (cancel = true) }, "취소");
  const analyzeBtn = h("button", { type: "button", onclick: () => void analyze() }, "정확한 조합 수 분석");
  const progress = h("div", { role: "status", "aria-live": "polite" });

  const setRunning = (r: boolean) => {
    running = r;
    runBtn.disabled = r;
    analyzeBtn.disabled = r;
    cancelBtn.hidden = !r;
  };

  async function run() {
    if (running) return;
    const count = Math.min(MAX_COUNT, Math.max(1, Math.floor(Number((countInput as HTMLInputElement).value))));
    const errs = validateOptions({ ...state.picks, rules: state.rules, count }, !!history());
    clear(out);
    if (errs.length) {
      out.append(notice("error", "조건을 수정한 뒤 다시 실행해 주세요."));
      return;
    }
    cancel = false;
    setRunning(true);
    const gen = createGenerator({ count, ...state.picks, rules: state.rules, history: history(), maxAttempts: 3_000_000 });
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
      out.append(h("details", {}, h("summary", {}, "필터별 탈락 내역 (적용 순서상 처음 걸린 필터 기준)"), h("ul", {}, ...rej.map(([k, v]) => h("li", {}, `${FILTER_BY_KEY.get(k)?.label ?? k}: ${v.toLocaleString()}회`)))));
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
    const errs = validateOptions({ ...state.picks, rules: state.rules, count: 1 }, !!history());
    clear(out);
    if (errs.length) {
      out.append(notice("error", "조건을 수정한 뒤 다시 실행해 주세요."));
      return;
    }
    cancel = false;
    setRunning(true);
    progress.textContent = "전체 조합을 세는 중… (조건에 따라 수 초 걸릴 수 있습니다)";
    const r = await countSpace({ ...state.picks, rules: state.rules, history: history() }, { shouldStop: () => cancel });
    setRunning(false);
    progress.textContent = "";
    if (r.cancelled) {
      out.append(notice("warn", "취소했습니다. 부분 결과는 표시하지 않습니다."));
      return;
    }
    out.append(h("h3", {}, "정확한 조합 수 (추정이 아닌 전체 열거)"), h("p", {}, `후보 공간 ${r.total.toLocaleString()}개 중 모든 필터 통과 ${r.passed.toLocaleString()}개 (${r.total ? ((r.passed / r.total) * 100).toFixed(2) : "0"}%)`));
    if (r.cumulative.length) {
      const t = h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "필터(적용 순서)"), h("th", {}, "누적 남은 수"), h("th", {}, "단독 통과 수"))));
      const tb = h("tbody");
      r.cumulative.forEach((c) => tb.append(h("tr", {}, h("td", {}, FILTER_BY_KEY.get(c.key)?.label ?? c.key), h("td", {}, c.remaining.toLocaleString()), h("td", {}, (r.independent[c.key] ?? 0).toLocaleString()))));
      t.append(tb);
      out.append(h("div", { class: "scroll" }, t));
    }
    out.append(h("p", { class: "muted" }, "통과 조합 수는 당첨 확률과 무관합니다. 모든 조합의 당첨 확률은 같습니다."));
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
    h("h2", {}, "조합 만들기"),
    notice("info", DISCLAIMER),
    state.draws.state !== "ok" ? notice("warn", "당첨 이력 데이터가 없습니다. 과거 이력 필터와 결과 대조는 사용할 수 없습니다.") : "",
    h("section", {}, h("h3", {}, "1. 목표 회차"), h("label", { for: "round" }, "추첨 회차 "), roundInput),
    h("section", {}, h("h3", {}, "2. 번호 선택"), modeBar, h("p", { class: "muted" }, "고정수는 모든 조합에 포함, 제외수는 절대 포함하지 않으며, 후보는 그 안에서만 고릅니다. 고정수와 후보는 별개 개념입니다."), board),
    h("section", {}, h("h3", {}, "3. 필터"), presetBar, filterBox),
    summaryBox,
    problems,
    h("section", { class: "sticky" }, h("h3", {}, "4. 생성"), h("div", { class: "row" }, h("label", { for: "count" }, "개수"), ...[5, 10, 20, 50, 100].map((n) => h("button", { type: "button", onclick: () => ((countInput as HTMLInputElement).value = String(n)) }, String(n))), countInput, runBtn, analyzeBtn, cancelBtn), progress),
    out,
  );
  drawFilters();
  refresh();
}

function clearRoot(root: HTMLElement) {
  clear(root);
  return root;
}

