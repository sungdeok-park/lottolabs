import { currentExclusion, evaluationTargets, type ExclusionEntry } from "../core/operator";
import { nextRound, persist, state } from "../state";
import { balls, DISCLAIMER, notice } from "./common";
import { clear, h } from "./dom";

const fmtTime = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const sect = (title: string, ...kids: (Node | string)[]) => h("section", { class: "sect" }, h("h3", {}, title), ...kids);
const STATUS: Record<string, string> = { published: "게시", draft: "초안", withdrawn: "철회" };

export function renderExclusions(root: HTMLElement) {
  const round = state.targetRound > 0 ? state.targetRound : nextRound();
  const op = state.operator;
  const entries = op.exclusions?.entries ?? [];
  const cur = currentExclusion(entries, round);
  const status = h("div", { role: "status" });
  const preview = h("div");

  root.append(h("div", { class: "page-head" }, h("h2", {}, "운영자 제외수"),
    h("p", { class: "muted" }, "운영자가 추첨 전에 게시한 제외수입니다. 번호를 후보에서 빼는 도구일 뿐, 그 번호가 나오지 않는다고 보장하지 않습니다. " + DISCLAIMER)));
  if (op.error && !op.exclusions) root.append(notice("error", `제외수 파일을 불러오지 못했습니다. (${op.error})`));

  /* ---- 이번 회차 ---- */
  const now = sect(`제${round}회 제외수`);
  if (!cur) {
    now.append(notice("info", "미등록. 이 회차의 제외수가 아직 게시되지 않았습니다. 임의로 만든 번호는 표시하지 않습니다."));
    const pending = entries.filter((e) => e.targetRound === round && e.status === "withdrawn");
    if (pending.length) now.append(notice("warn", "게시되었다가 철회된 기록이 있습니다. 아래 변경 이력을 확인하세요."));
  } else {
    now.append(
      h("div", { class: "latest" },
        h("div", { class: "row", style: "align-items:baseline;gap:12px" }, h("strong", { class: "num", style: "font-size:1.25rem" }, `${cur.numbers.length}개 제외`), h("span", { class: "muted" }, `revision ${cur.revision} · ${fmtTime(cur.publishedAt)} 게시 · 방법 ${cur.methodVersion}`)),
        balls(cur.numbers),
        cur.description ? h("p", {}, cur.description) : "",
      ),
      h("div", { class: "toolbar", style: "margin-top:12px" },
        h("button", { type: "button", class: "btn primary", onclick: () => showPreview(cur) }, "내 제외수에 적용"),
        h("button", { type: "button", class: "btn", onclick: () => removeFromPicks(cur) }, "적용 해제"),
        h("a", { class: "btn quiet", href: "#/generate" }, "조합 만들기로 →")),
      preview, status,
    );
  }
  root.append(now);

  function showPreview(e: ExclusionEntry) {
    clear(preview);
    const p = state.picks;
    const fixedClash = e.numbers.filter((n) => p.fixed.includes(n));
    const already = e.numbers.filter((n) => p.exclude.includes(n));
    const adding = e.numbers.filter((n) => !p.exclude.includes(n) && !p.fixed.includes(n));
    preview.append(h("div", { class: "stack", style: "gap:8px;margin-top:12px" },
      h("strong", {}, "적용 전 확인"),
      h("p", {}, `새로 제외: ${adding.length ? adding.join(", ") : "없음"} · 이미 제외: ${already.length ? already.join(", ") : "없음"}`),
      fixedClash.length ? notice("warn", `고정수와 겹치는 번호(${fixedClash.join(", ")})는 제외하지 않고 건너뜁니다. 고정수를 먼저 풀어야 제외할 수 있습니다.`) : "",
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn primary", onclick: async () => {
          p.candidates = p.candidates.filter((n) => !adding.includes(n));
          p.exclude = [...p.exclude, ...adding].sort((a, b) => a - b);
          const ok = await persist();
          clear(preview); clear(status);
          status.append(notice(ok ? "ok" : "error", ok ? `제외수 ${adding.length}개를 적용했습니다. ` : "저장하지 못했습니다.", ok ? h("a", { href: "#/generate" }, "조합 만들기에서 확인") : ""));
        } }, "적용"),
        h("button", { type: "button", class: "btn quiet", onclick: () => clear(preview) }, "취소"))));
  }
  async function removeFromPicks(e: ExclusionEntry) {
    const had = e.numbers.filter((n) => state.picks.exclude.includes(n));
    state.picks.exclude = state.picks.exclude.filter((n) => !e.numbers.includes(n));
    const ok = await persist();
    clear(preview); clear(status);
    status.append(notice(ok ? "ok" : "error", ok ? `제외수 ${had.length}개를 풀었습니다. (직접 제외한 번호도 같은 번호면 함께 풀립니다)` : "저장하지 못했습니다."));
  }

  /* ---- 변경 이력 ---- */
  const hist = entries.filter((e) => e.targetRound === round).sort((a, b) => b.revision - a.revision);
  if (hist.length) {
    root.append(sect(`제${round}회 변경 이력`, h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "revision"), h("th", {}, "상태"), h("th", {}, "게시 시각"), h("th", { class: "n" }, "제외 개수"), h("th", {}, "방법"))),
      h("tbody", {}, ...hist.map((e) => h("tr", {}, h("td", { class: "num" }, String(e.revision)), h("td", {}, STATUS[e.status] ?? e.status), h("td", {}, fmtTime(e.publishedAt)), h("td", { class: "n" }, String(e.numbers.length)), h("td", {}, e.methodVersion))))))));
  }

  /* ---- 과거 성과(검증) ---- */
  const targets = state.draws.state === "ok" ? evaluationTargets(entries, state.draws.draws) : [];
  const post = entries.filter((e) => e.status === "published" && state.draws.draws.some((d) => d.round === e.targetRound) && !targets.some((t) => t.entry === e) && !targets.some((t) => t.entry.targetRound === e.targetRound && t.entry.revision > e.revision));
  const perf = sect("지난 회차 검증");
  if (!targets.length) perf.append(h("p", { class: "muted" }, entries.length ? "추첨이 끝난 회차의 사전 게시 기록이 아직 없습니다." : "아직 게시된 제외수가 없어 평가할 기록이 없습니다."));
  else {
    const hits = targets.reduce((a, t) => a + t.ev.mainHits, 0);
    const ex = targets.reduce((a, t) => a + t.ev.count, 0);
    const exp = targets.reduce((a, t) => a + t.ev.expectedMainHits, 0);
    perf.append(h("p", {}, `사전 게시 ${targets.length}개 회차에서 제외수 ${ex}개 중 ${hits}개가 실제 본번호로 나왔습니다. 같은 개수를 무작위로 골랐다면 평균 ${exp.toFixed(1)}개가 나올 것입니다.`),
      h("p", { class: "muted" }, "표본이 적으면 우연과 구분되지 않습니다. 회차가 충분히 쌓이기 전에는 성과로 해석하지 마세요."),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "회차"), h("th", { class: "n" }, "제외 개수"), h("th", {}, "실제 당첨번호"), h("th", { class: "n" }, "나온 제외수"), h("th", { class: "n" }, "무작위 기대"), h("th", {}, "보너스"))),
        h("tbody", {}, ...targets.map((t) => h("tr", {}, h("td", { class: "num" }, `${t.entry.targetRound}회`), h("td", { class: "n" }, String(t.ev.count)), h("td", {}, balls(t.draw.numbers, { numbers: t.entry.numbers, bonus: -1 })), h("td", { class: "n" }, String(t.ev.mainHits)), h("td", { class: "n" }, t.ev.expectedMainHits.toFixed(2)), h("td", {}, t.ev.bonusHit ? "나옴" : "—")))))));
  }
  if (post.length) perf.append(notice("warn", `추첨 후에 게시된 기록 ${post.length}개(${post.map((e) => `${e.targetRound}회 r${e.revision}`).join(", ")})는 사후 등록이라 평가에서 제외했습니다.`));
  root.append(perf);
}
