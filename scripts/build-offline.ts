// 더블클릭만으로 열리는 단일 HTML 파일(dist-offline/lotto-workroom.html)을 만든다.
//  - 서버 없이 file:// 로 열 수 있도록 스크립트·스타일·당첨 이력을 모두 파일 안에 넣는다.
//  - Web Worker 없이 메인 스레드에서 계산한다.
//  - 해설 페이지(/filters/ 등)는 포함하지 않는다. (정적 사이트 빌드에만 있음)
// 실행: npm run build:offline
import { build } from "vite";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const out = new URL("../dist-offline/", import.meta.url);
rmSync(out, { recursive: true, force: true });
await build({
  configFile: false,
  base: "./",
  publicDir: false,
  logLevel: "warn",
  define: { "import.meta.env.VITE_NO_WORKER": JSON.stringify("1") },
  build: {
    outDir: "dist-offline",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: false,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
});

let html = readFileSync(new URL("index.html", out), "utf8");
const read = (p: string) => readFileSync(new URL(p.replace(/^\.\//, ""), out), "utf8");
const css: string[] = [];
html = html.replace(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>/g, (_m, p) => { css.push(read(p)); return ""; });
let js = "";
html = html.replace(/<script type="module"[^>]*src="(\.\/assets\/[^"]+\.js)"[^>]*><\/script>/g, (_m, p) => { js += read(p) + "\n"; return ""; });
if (!css.length || !js) throw new Error("빌드 결과에서 스타일 또는 스크립트를 찾지 못했습니다.");
const draws = readFileSync(new URL("../public/data/draws.json", import.meta.url), "utf8");
const operator = { exclusions: JSON.parse(readFileSync(new URL("../public/data/exclusions.json", import.meta.url), "utf8")), recommended: JSON.parse(readFileSync(new URL("../public/data/operator-filters.json", import.meta.url), "utf8")) };
const safe = (s: string) => s.replace(/<\/(script|style)/gi, "<\\/$1");
html = html.replace("</head>", `<style>${safe(css.join("\n"))}</style>\n</head>`);
html = html.replace("</body>", `<script>window.__DRAWS__=${safe(JSON.stringify(JSON.parse(draws)))};window.__OPERATOR__=${safe(JSON.stringify(operator))};</script>\n<script>${safe(js)}</script>\n</body>`);
// 단일 파일에서는 해설 페이지가 없으므로 상대 링크를 숨기지 않고 그대로 두되, 앱 안 링크(#/…)만 동작한다.
mkdirSync(out, { recursive: true });
writeFileSync(new URL("lotto-workroom.html", out), html);
// 정리: 단일 파일 외 산출물 제거
for (const f of ["index.html"]) rmSync(new URL(f, out), { force: true });
rmSync(new URL("assets", out), { recursive: true, force: true });
console.log(`dist-offline/lotto-workroom.html 생성 (${(html.length / 1024).toFixed(0)} KB)`);
