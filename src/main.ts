import { init, loadDraws, loadOperator } from "./state";
import { clear, h } from "./ui/dom";
import { notice } from "./ui/common";
import { renderGenerate } from "./ui/generate";
import { renderVault } from "./ui/vault";
import { renderGuide, renderHome, renderShare } from "./ui/pages";
import { renderStats, renderWheel } from "./ui/tools";
import { renderExclusions } from "./ui/exclusions";
import { persistent } from "./storage";

const ROUTES = [
  ["#/", "홈"],
  ["#/generate", "조합 만들기"],
  ["#/exclusions", "제외수"],
  ["#/wheel", "휠링"],
  ["#/stats", "통계"],
  ["#/vault", "조합번호"],
  ["#/guide", "도움말"],
] as const;

function render() {
  const main = document.getElementById("main")!;
  const nav = document.getElementById("nav")!;
  const hash = location.hash || "#/";
  clear(main);
  clear(nav);
  const current = hash === "#/filters" ? "#/generate" : hash;
  for (const [href, label] of ROUTES) nav.append(h("a", { href, "aria-current": current === href ? "page" : undefined }, label));
  if (!persistent) main.append(notice("warn", "이 브라우저에서는 저장소를 사용할 수 없어 새로고침하면 데이터가 사라집니다. 시크릿 모드이거나 저장소가 차단된 상태일 수 있습니다."));
  if (hash.startsWith("#/share/")) renderShare(main, hash.slice("#/share/".length));
  else if (hash === "#/generate" || hash === "#/filters") renderGenerate(main);
  else if (hash === "#/exclusions") renderExclusions(main);
  else if (hash === "#/wheel") renderWheel(main);
  else if (hash === "#/stats") renderStats(main);
  else if (hash === "#/vault") renderVault(main);
  else if (hash === "#/guide") renderGuide(main);
  else renderHome(main);
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
  document.title = hash.startsWith("#/share/") ? "공유받은 번호 · 로또 워크룸" : "로또 워크룸";
}

/** 테마: 시스템 → 라이트 → 다크 순환. 선택은 이 브라우저에만 저장한다. */
function initTheme() {
  const btn = document.getElementById("theme")!;
  const KEY = "theme";
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = (v: string | null) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* 저장 불가는 무시 */ } };
  const apply = (v: string | null) => {
    if (v === "light" || v === "dark") document.documentElement.setAttribute("data-theme", v);
    else document.documentElement.removeAttribute("data-theme");
    const label = v === "light" ? "라이트" : v === "dark" ? "다크" : "시스템";
    btn.title = `테마: ${label}`;
    btn.setAttribute("aria-label", `테마 전환 (현재 ${label})`);
  };
  apply(read());
  btn.addEventListener("click", () => {
    const cur = read();
    const next = cur === null ? "light" : cur === "light" ? "dark" : null;
    write(next);
    apply(next);
  });
}

async function boot() {
  initTheme();
  await init();
  await Promise.all([loadDraws(import.meta.env.BASE_URL), loadOperator(import.meta.env.BASE_URL)]);
  window.addEventListener("hashchange", render);
  render();
}

void boot();
