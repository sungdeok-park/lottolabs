import { decodeShare } from "../core/share";
import { FILTERS } from "../core/filters";
import { matchDraw } from "../core/match";
import { persist, state } from "../state";
import { balls, DISCLAIMER, fmtDate, notice, uid } from "./common";
import { h } from "./dom";

const sect = (title: string, ...kids: (Node | string)[]) => h("section", { class: "sect" }, h("h3", {}, title), ...kids);

export function renderHome(root: HTMLElement) {
  const ds = state.draws;
  const latest = ds.draws.at(-1);
  const left = h("div", { class: "stack" });
  const right = h("div", { class: "stack" });

  const drawSection = sect("최신 당첨번호");
  if (ds.state === "loading") drawSection.append("불러오는 중…");
  if (ds.state === "error") drawSection.append(notice("error", `당첨 이력을 불러오지 못했습니다. (${ds.message})`));
  if (ds.state === "empty") drawSection.append(notice("info", "아직 등록된 당첨 이력이 없습니다. 이력이 들어오면 여기에 최신 회차가 표시됩니다."));
  if (latest) {
    drawSection.append(h("div", { class: "latest" },
      h("div", { class: "row", style: "align-items:baseline;gap:12px" }, h("span", { class: "round" }, `제${latest.round}회`), h("span", { class: "muted" }, latest.date)),
      h("div", { class: "row", style: "gap:4px" }, balls(latest.numbers, undefined, "lg"), h("span", { class: "plus" }, "+"), balls([latest.bonus], undefined, "lg")),
      h("p", { class: "muted" }, `출처 ${ds.source ?? "미기재"} · 갱신 ${ds.updatedAt ?? "미기재"}`)));
  }
  left.append(drawSection);

  const results = sect("내 최근 결과");
  if (latest) {
    const bs = state.batches.filter((b) => b.round === latest.round);
    if (!bs.length) results.append(h("p", { class: "muted" }, `제${latest.round}회를 대상으로 저장한 조합이 없습니다.`));
    for (const b of bs) {
      const dist: Record<string, number> = {};
      for (const c of b.combos) {
        const r = matchDraw(c.numbers, latest).rank;
        dist[r ? `${r}등` : "낙첨"] = (dist[r ? `${r}등` : "낙첨"] ?? 0) + 1;
      }
      const late = b.createdAt.slice(0, 10) > latest.date;
      results.append(h("p", {}, h("strong", {}, b.name), h("span", { class: "muted" }, `  ${Object.entries(dist).map(([k, v]) => `${k} ${v}`).join(" · ")}${late ? " (사후 대조)" : ""}`)));
    }
  } else results.append(h("p", { class: "muted" }, "당첨 이력이 없어 대조할 수 없습니다."));
  left.append(results);

  const on = state.rules.filter((r) => r.enabled !== false);
  right.append(
    sect("내 필터", h("p", {}, on.length ? `켜진 필터 ${on.length}개` : "켜진 필터 없음 (제한 없음)"), h("p", {}, h("a", { class: "btn", href: "#/generate" }, "조합 만들기 →"))),
    sect("내 조합", state.batches.length ? h("ul", { class: "rows" }, ...state.batches.slice(0, 4).map((b) => h("li", { style: "padding:8px 0" }, h("span", { class: "num" }, `${b.round}회`), h("span", { class: "muted" }, `  ${b.combos.length}개 · ${fmtDate(b.createdAt)}`)))) : h("p", { class: "muted" }, "저장된 조합이 없습니다."), h("p", {}, h("a", { href: "#/vault" }, "보관함 열기 →"))),
    sect("운영자 제외수", notice("info", "미등록. 아직 발표된 제외수가 없습니다.")),
  );
  root.append(h("div", { class: "page-head" }, h("h2", {}, "홈"), h("p", { class: "muted" }, DISCLAIMER)), h("div", { class: "home-grid" }, left, right));
}

export function renderShare(root: HTMLElement, payload: string) {
  root.append(h("div", { class: "page-head" }, h("h2", {}, "공유받은 번호")));
  const r = decodeShare(payload);
  if (!r.ok) {
    root.append(notice("error", `열 수 없는 공유 링크입니다. ${r.error}`));
    return;
  }
  const { round, combos } = r.payload;
  const draw = state.draws.draws.find((d) => d.round === round);
  const status = h("div");
  root.append(
    notice("info", "링크를 가진 사람이면 누구나 볼 수 있는 번호이며, 발신자가 추첨 전에 만든 것인지는 확인할 수 없습니다."),
    h("section", { class: "sect" }, h("h3", {}, `제${round}회 · 조합 ${combos.length}개`), ...combos.map((c) => h("div", { class: "combo-row", style: "grid-template-columns:minmax(0,1fr)" }, balls(c, draw)))),
    draw ? notice("info", `제${round}회는 이미 발표되었습니다. 가져오면 사후 대조로 표시됩니다.`) : "",
    h("p", {}, h("button", { type: "button", class: "btn primary", onclick: async () => {
      if (!confirm(`${combos.length}개를 내 보관함의 새 묶음으로 가져올까요?`)) return;
      state.batches.unshift({ id: uid(), name: `공유받음 ${fmtDate(new Date().toISOString())}`, round, createdAt: new Date().toISOString(), source: "imported", memo: "", combos: combos.map((numbers) => ({ numbers })) });
      const ok = await persist();
      status.append(ok ? notice("ok", "가져왔습니다. ", h("a", { href: "#/vault" }, "보관함 열기")) : notice("error", "저장하지 못했습니다."));
    } }, "내 보관함에 가져오기")),
    status,
  );
}

export function renderGuide(root: HTMLElement) {
  const groups = [...new Set(FILTERS.map((f) => f.group))];
  root.append(
    h("div", { class: "page-head" }, h("h2", {}, "도움말 · 용어"), h("p", { class: "muted" }, DISCLAIMER)),
    h("div", { class: "stack", style: "max-width:78ch" },
      sect("기본 정의", h("ul", {},
        h("li", {}, "저번호 1~23, 고번호 24~45 (고저 필터 기준)"),
        h("li", {}, "AC: 여섯 수의 모든 쌍(15개) 차이 중 서로 다른 값의 수 − 5"),
        h("li", {}, "연속쌍: 차가 1인 이웃 쌍의 수 / 연번: 가장 긴 연속 묶음의 길이"),
        h("li", {}, "이월수: 직전 회차 본번호와 겹치는 번호 / 이웃수: 직전 번호 ±1"),
        h("li", {}, "등수: 6개=1등, 5개+보너스=2등, 5개=3등, 4개=4등, 3개=5등 (보너스는 본번호 일치에 더하지 않음)"),
        h("li", {}, "이 서비스의 정의는 다른 사이트와 다를 수 있습니다. 필터 정의는 아래 목록이 기준입니다."))),
      ...groups.map((g) => sect(g, h("ul", { class: "rows" }, ...FILTERS.filter((f) => f.group === g).map((f) => h("li", { style: "padding:8px 0" }, h("a", { href: `/filters/${f.key}/` }, h("strong", {}, f.label)), h("span", { class: "muted" }, `  ${f.description}`)))))),
      sect("더 알아보기", h("p", {}, h("a", { href: "/filters/" }, "필터별 상세 해설과 전체 조합 분포"), " · ", h("a", { href: "/probability/" }, "등수별 당첨 확률 계산"))),
      sect("저장 안내", h("p", {}, "번호는 이 브라우저의 IndexedDB에 저장됩니다. 계정이나 서버 백업이 없으므로 JSON 백업을 받아 두세요.")),
    ),
  );
}
