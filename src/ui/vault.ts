import { matchDraw } from "../core/match";
import { isValidCombo, sortCombo } from "../core/metrics";
import { encodeShare, formatCombo, mailtoLink, shareText } from "../core/share";
import { persist, state, type Batch } from "../state";
import { balls, copyText, download, fmtDate, notice, uid } from "./common";
import { clear, h } from "./dom";

const SERVICE = "로또 워크룸";

function drawFor(round: number) {
  return state.draws.draws.find((d) => d.round === round);
}

function shareUrl(b: Batch, combos = b.combos) {
  const frag = encodeShare({ round: b.round, combos: combos.map((c) => c.numbers).slice(0, 30) });
  return `${location.origin}${location.pathname}#/share/${frag}`;
}

function csv(b: Batch) {
  return ["회차,번호1,번호2,번호3,번호4,번호5,번호6", ...b.combos.map((c) => [b.round, ...sortCombo(c.numbers)].join(","))].join("\n");
}

export function renderVault(root: HTMLElement) {
  const list = h("div");
  const status = h("div", { role: "status" });
  const selected = new Set<string>(); // `${batchId}:${index}`

  const say = (kind: "ok" | "warn" | "error" | "info", msg: string) => {
    clear(status);
    status.append(notice(kind, msg));
  };

  const pick = (b: Batch) => {
    const chosen = b.combos.filter((_, i) => selected.has(`${b.id}:${i}`));
    return chosen.length ? chosen : b.combos;
  };

  async function osShare(b: Batch) {
    const combos = pick(b);
    const text = shareText(b.round, combos.map((c) => c.numbers), combos.length <= 30 ? shareUrl(b, combos) : location.origin + location.pathname);
    if (navigator.share) {
      try {
        await navigator.share({ title: `${SERVICE} 제${b.round}회`, text });
        say("info", "공유창을 열었습니다. 실제 전송 여부는 확인할 수 없습니다.");
      } catch {
        say("info", "공유를 취소했습니다.");
      }
    } else {
      say("warn", "이 브라우저는 공유창을 지원하지 않습니다. 복사 또는 파일 다운로드를 이용하세요.");
    }
  }

  function card(b: Batch) {
    const d = drawFor(b.round);
    const late = d && b.createdAt.slice(0, 10) > d.date;
    const counts: Record<string, number> = {};
    if (d) for (const c of b.combos) {
      const r = matchDraw(c.numbers, d).rank;
      if (r) counts[`${r}등`] = (counts[`${r}등`] ?? 0) + 1;
    }
    const el = h("section", { class: "batch" });
    el.append(
      h("div", { class: "row between" },
        h("h3", {}, `${b.name}`),
        h("span", { class: "muted" }, `${b.round}회 대상 · ${b.source === "imported" ? "가져옴" : "생성"} ${fmtDate(b.createdAt)}`)),
    );
    if (d) {
      el.append(notice(late ? "warn" : "info", `제${b.round}회 발표 번호: ${d.numbers.join(", ")} + 보너스 ${d.bonus}. ${late ? "이 묶음은 추첨 후 만들어졌으므로 사후 대조입니다. " : ""}결과: ${Object.entries(counts).map(([k, v]) => `${k} ${v}개`).join(", ") || "5등 이상 없음"}. (저장 번호이며 실제 구매 여부는 확인하지 않습니다.)`));
    } else {
      el.append(notice("info", state.draws.state === "ok" ? `제${b.round}회 결과 대기 중입니다.` : "당첨 이력 데이터가 없어 대조할 수 없습니다."));
    }
    const rowsEl = h("div", {});
    b.combos.forEach((c, i) => {
      const key = `${b.id}:${i}`;
      const m = d ? matchDraw(c.numbers, d) : null;
      rowsEl.append(h("div", { class: "combo-row" },
        h("input", { type: "checkbox", "aria-label": `${i + 1}번 조합 선택`, checked: selected.has(key), onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? selected.add(key) : selected.delete(key)) }),
        balls(c.numbers, d),
        h("span", { class: "r" }, m ? `${m.matched}개 일치${m.bonus ? " + 보너스" : ""}${m.rank ? ` → ${m.rank}등` : ""}` : "—")));
    });
    const body = (combos = pick(b)) => combos.map((c, i) => `${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i] ?? i + 1} ${formatCombo(c.numbers)}`).join("\n");
    el.append(
      rowsEl,
      h("div", { class: "toolbar" },
        h("button", { type: "button", class: "btn sm", onclick: async () => say((await copyText(shareText(b.round, pick(b).map((c) => c.numbers), location.origin + location.pathname))) ? "ok" : "error", "복사했습니다.") }, "복사"),
        h("button", { type: "button", class: "btn sm", onclick: () => void osShare(b) }, "다른 앱으로 공유"),
        h("button", { type: "button", class: "btn sm", title: "카카오 SDK 키·도메인 등록 전에는 일반 공유로 대체됩니다", onclick: () => { say("warn", "카카오톡 전용 공유는 Kakao Developers 앱 등록 후 사용할 수 있습니다. 일반 공유로 이어집니다."); void osShare(b); } }, "카카오톡"),
        h("a", { class: "btn sm", href: mailtoLink(`[${SERVICE}] 제${b.round}회 조합`, `${body()}\n\n조건 기반 생성 번호이며 당첨을 보장하지 않습니다.`) , onclick: () => say("info", "메일 작성 화면을 열었습니다. 전송은 메일 앱에서 직접 해야 합니다. 열리지 않으면 복사 또는 파일 다운로드를 이용하세요.") }, "메일 앱으로 보내기"),
        h("button", { type: "button", class: "btn sm", onclick: () => download(`lotto-${b.round}.csv`, csv(b), "text/csv") }, "CSV"),
        h("button", { type: "button", class: "btn sm", onclick: () => download(`lotto-${b.round}.txt`, body(b.combos), "text/plain") }, "TXT"),
        h("button", { type: "button", class: "btn sm", onclick: () => { void persist(); download(`lotto-${b.round}.json`, JSON.stringify(b, null, 2), "application/json"); } }, "JSON"),
        h("button", { type: "button", class: "btn sm danger", onclick: async () => {
          if (!confirm(`'${b.name}' 묶음(${b.combos.length}개)을 삭제할까요? 삭제 전에 JSON 백업을 권장합니다.`)) return;
          state.batches = state.batches.filter((x) => x.id !== b.id);
          await persist();
          draw();
        } }, "삭제")),
    );
    return el;
  }

  function draw() {
    clear(list);
    if (!state.batches.length) list.append(notice("info", "저장된 조합이 없습니다. '조합' 메뉴에서 만들거나 아래에서 가져오세요."));
    for (const b of state.batches) list.append(card(b));
  }

  // ---- 가져오기 / 백업 ----
  const roundIn = h("input", { type: "number", min: 1, id: "imp-round", value: String(state.targetRound || (state.draws.draws.at(-1)?.round ?? 0) + 1), "aria-label": "대상 회차" });
  const csvIn = h("textarea", { rows: 4, placeholder: "한 줄에 한 조합: 3,8,14,22,31,42 또는 03 08 14 22 31 42", "aria-label": "가져올 조합" });

  function importText() {
    const lines = (csvIn as HTMLTextAreaElement).value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const good = new Map<string, number[]>();
    let bad = 0;
    for (const l of lines) {
      const nums = (l.match(/\d+/g) ?? []).map(Number);
      const c = nums.length === 7 && nums[0]! > 45 ? nums.slice(1) : nums; // 앞에 회차가 붙은 CSV 허용
      if (!isValidCombo(c)) { bad++; continue; }
      good.set(sortCombo(c).join("-"), sortCombo(c));
    }
    const dup = lines.length - bad - good.size;
    if (!good.size) return say("error", `가져올 수 있는 조합이 없습니다. (잘못된 줄 ${bad}개)`);
    const round = Number((roundIn as HTMLInputElement).value);
    if (!Number.isInteger(round) || round < 1) return say("error", "대상 회차를 입력하세요.");
    if (!confirm(`${good.size}개를 제${round}회 새 묶음으로 가져올까요? (잘못된 줄 ${bad}개, 중복 ${dup}개는 제외)`)) return;
    state.batches.unshift({ id: uid(), name: `가져옴 ${fmtDate(new Date().toISOString())}`, round, createdAt: new Date().toISOString(), source: "imported", memo: "", combos: [...good.values()].map((numbers) => ({ numbers })) });
    void persist().then((ok) => { say(ok ? "ok" : "error", ok ? `${good.size}개를 가져왔습니다.` : "가져왔지만 저장에 실패했습니다. 백업을 받아 두세요."); draw(); });
  }

  const restoreIn = h("input", { type: "file", accept: "application/json", "aria-label": "백업 파일", onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.app !== "lotto-workroom" || !Array.isArray(j.batches)) throw new Error("형식 불일치");
      const ok = j.batches.every((b: Batch) => b && Array.isArray(b.combos) && b.combos.every((c) => isValidCombo(c.numbers)));
      if (!ok) throw new Error("조합 검증 실패");
      if (!confirm(`백업에서 묶음 ${j.batches.length}개를 복원합니다. 현재 묶음 ${state.batches.length}개는 id가 같은 것만 덮어쓰고 나머지는 유지됩니다. 계속할까요?`)) return;
      const map = new Map(state.batches.map((b) => [b.id, b]));
      for (const b of j.batches as Batch[]) map.set(b.id, b);
      state.batches = [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (Array.isArray(j.presets)) state.presets = j.presets;
      await persist();
      say("ok", "복원했습니다.");
      draw();
    } catch (err) {
      say("error", `복원하지 못했습니다: ${err instanceof Error ? err.message : err}`);
    }
  } });

  root.append(
    h("div", { class: "page-head" }, h("h2", {}, "조합번호 보관함")),
    notice("info", "이 기기의 브라우저에만 저장됩니다. 서버 백업이 아니며 브라우저 데이터를 지우면 사라집니다. 정기적으로 JSON 백업을 받아 두세요."),
    status,
    list,
    h("section", { class: "sect" }, h("h3", {}, "가져오기"), h("div", { class: "row" }, h("label", { for: "imp-round" }, "대상 회차"), roundIn), csvIn, h("button", { type: "button", class: "btn", onclick: importText }, "미리 확인 후 가져오기")),
    h("section", { class: "sect" }, h("h3", {}, "백업·복원"), h("div", { class: "row" },
      h("button", { type: "button", class: "btn sm", onclick: () => download(`lotto-workroom-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "lotto-workroom", version: 1, exportedAt: new Date().toISOString(), batches: state.batches, presets: state.presets }, null, 2), "application/json") }, "전체 백업(JSON) 받기"),
      h("label", {}, "복원 ", restoreIn))),
  );
  draw();
}
