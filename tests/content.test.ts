import { describe, expect, it } from "vitest";
import dist from "../content/distributions.json";
import { buildPages, buildRobots, buildSitemap, esc } from "../content/pages";
import { FILTERS } from "../src/core/filters";
import { binom, TOTAL_COMBOS } from "../src/core/math";

const d = dist.filters as Record<string, Record<string, number>>;
const pages = buildPages();

describe("분포 데이터 (전체 8,145,060 조합 열거 결과)", () => {
  it("이력이 필요 없는 모든 필터의 합계가 전체 조합 수와 같다", () => {
    for (const f of FILTERS.filter((x) => !x.needsHistory)) {
      const row = d[f.key];
      expect(row, f.key).toBeDefined();
      expect(Object.values(row!).reduce((a, b) => a + b, 0), f.key).toBe(TOTAL_COMBOS);
      // 값이 선언한 범위 안에 있다
      for (const v of Object.keys(row!)) expect(Number(v) >= f.domain[0] && Number(v) <= f.domain[1], `${f.key}=${v}`).toBe(true);
    }
  });
  it("조합론 공식과 일치한다", () => {
    for (let k = 0; k <= 6; k++) {
      expect(d.odd![k]).toBe(binom(23, k) * binom(22, 6 - k));
      expect(d.high![k]).toBe(binom(22, k) * binom(23, 6 - k) ); // 고번호(24~45) 22개, 저번호(1~23) 23개
      expect(d.band1![k] ?? 0).toBe(binom(10, k) * binom(35, 6 - k));
      expect(d.gung1![k] ?? 0).toBe(binom(5, k) * binom(40, 6 - k));
    }
    expect(d.sum!["21"]).toBe(1); // 1+2+3+4+5+6
    expect(d.sum!["255"]).toBe(1); // 40+41+42+43+44+45
    expect(d.prime![3]).toBe(binom(14, 3) * binom(31, 3));
    expect(d.ac![0]).toBe(180);
  });
});

describe("정적 페이지", () => {
  it("필터마다 페이지가 있고 경로가 겹치지 않는다", () => {
    expect(pages).toHaveLength(FILTERS.length + 6);
    expect(new Set(pages.map((p) => p.path)).size).toBe(pages.length);
    for (const f of FILTERS) expect(pages.some((p) => p.path === `filters/${f.key}/index.html`), f.key).toBe(true);
  });
  it("이력 의존 필터는 noindex, 분포가 있는 필터는 색인 대상", () => {
    for (const f of FILTERS) {
      const p = pages.find((x) => x.path === `filters/${f.key}/index.html`)!;
      expect(p.html.includes('name="robots" content="noindex"'), f.key).toBe(!!f.needsHistory);
      expect(p.url === null, f.key).toBe(!!f.needsHistory);
    }
  });
  it("깨진 값이 없고 필수 문구가 있다", () => {
    for (const p of pages) {
      expect(p.html, p.path).not.toMatch(/undefined|NaN|\[object/);
      expect(p.html, p.path).toContain("당첨을 예측하거나 보장하지 않습니다");
      expect(p.html, p.path).toContain('<html lang="ko">');
      expect(p.html, p.path).toMatch(/<title>.+<\/title>/);
      expect(p.html, p.path).toMatch(/<meta name="description" content=".{10,}">/);
      expect(p.html.match(/<h1>/g), p.path).toHaveLength(1);
    }
  });
  it("내부 링크가 모두 실제 페이지를 가리킨다", () => {
    const known = new Set(["/", "/content.css", ...pages.map((p) => "/" + p.path.replace(/index\.html$/, ""))]);
    for (const p of pages) {
      for (const m of p.html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)) expect(known.has(m[1]!), `${p.path} → ${m[1]}`).toBe(true);
    }
  });
  it("필수 안내 페이지: 개인정보·문의·소개·확률", () => {
    for (const path of ["privacy", "contact", "about", "probability"]) expect(pages.some((p) => p.path === `${path}/index.html`)).toBe(true);
    const priv = pages.find((p) => p.path === "privacy/index.html")!.html;
    expect(priv).toContain("서버로 전송하지 않으며");
    expect(priv).toContain("광고를 게재하지 않습니다");
  });
  it("확률 표가 계산값과 같다", () => {
    const html = pages.find((p) => p.path === "probability/index.html")!.html;
    for (const n of ["11,115", "182,780", "228", "8,145,060"]) expect(html).toContain(n);
  });
  it("HTML 이스케이프", () => {
    expect(esc(`<script>"a"&'b'</script>`)).toBe("&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;");
  });
});

describe("robots·sitemap", () => {
  it("공유 주소는 색인에서 제외하고, SITE_URL이 있을 때만 사이트맵을 연결한다", () => {
    expect(buildRobots()).toContain("Disallow: /#/share/");
    expect(buildRobots()).not.toContain("Sitemap");
    expect(buildRobots("https://example.test/")).toContain("Sitemap: https://example.test/sitemap.xml");
  });
  it("사이트맵에는 noindex 페이지가 없다", () => {
    const xml = buildSitemap(pages, "https://example.test");
    expect(xml).toContain("<loc>https://example.test/</loc>");
    expect(xml).toContain("<loc>https://example.test/filters/sum/</loc>");
    expect(xml).not.toContain("/filters/carry/");
    expect((xml.match(/<loc>/g) ?? []).length).toBe(1 + pages.filter((p) => p.url).length);
  });
});
