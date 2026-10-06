// 해설·정책 페이지를 정적 HTML로 만들어 public/ 아래에 쓴다. (build 때 자동 실행)
// 환경변수 SITE_URL 이 있으면 sitemap.xml 도 만든다. (도메인 확정 전에는 만들지 않는다)
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { buildPages, buildRobots, buildSitemap } from "../content/pages";

const pub = new URL("../public/", import.meta.url);
for (const d of ["filters", "probability", "about", "privacy", "contact"]) rmSync(new URL(d, pub), { recursive: true, force: true });
const pages = buildPages();
for (const p of pages) {
  const file = new URL(p.path, pub);
  mkdirSync(dirname(file.pathname), { recursive: true });
  writeFileSync(file, p.html);
}
const site = process.env.SITE_URL;
writeFileSync(new URL("robots.txt", pub), buildRobots(site));
if (site) writeFileSync(new URL("sitemap.xml", pub), buildSitemap(pages, site));
console.log(`정적 페이지 ${pages.length}개 생성${site ? ", sitemap.xml 포함" : " (SITE_URL 없음: sitemap 생략)"}`);
