import { init, loadDraws, state } from "./state";
import { clear, h } from "./ui/dom";
import { notice } from "./ui/common";
import { renderGenerate } from "./ui/generate";
import { renderVault } from "./ui/vault";
import { renderGuide, renderHome, renderShare } from "./ui/pages";
import { persistent } from "./storage";

const ROUTES = [
  ["#/", "홈"],
  ["#/generate", "조합"],
  ["#/vault", "조합번호"],
  ["#/guide", "도움말"],
] as const;

function render() {
  const main = document.getElementById("main")!;
  const nav = document.getElementById("nav")!;
  const hash = location.hash || "#/";
  clear(main);
  clear(nav);
  for (const [href, label] of ROUTES) nav.append(h("a", { href, "aria-current": hash === href ? "page" : undefined }, label));
  if (!persistent) main.append(notice("warn", "이 브라우저에서는 저장소를 사용할 수 없어 새로고침하면 데이터가 사라집니다. 시크릿 모드이거나 저장소가 차단된 상태일 수 있습니다."));
  if (hash.startsWith("#/share/")) renderShare(main, hash.slice("#/share/".length));
  else if (hash === "#/generate" || hash === "#/filters") renderGenerate(main);
  else if (hash === "#/vault") renderVault(main);
  else if (hash === "#/guide") renderGuide(main);
  else renderHome(main);
  main.focus({ preventScroll: true });
  document.title = hash.startsWith("#/share/") ? "공유받은 번호 · 로또 워크룸" : "로또 워크룸";
}

async function boot() {
  await init();
  await loadDraws(import.meta.env.BASE_URL);
  window.addEventListener("hashchange", render);
  render();
  void state;
}

void boot();
