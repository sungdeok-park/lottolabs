import dist from "./distributions.json";
import { FILTERS, type FilterDef, type FilterGroup } from "../src/core/filters";
import { rankProbabilities } from "../src/core/probabilities";
import { TOTAL_COMBOS } from "../src/core/math";

export interface Page {
  path: string; // 예: "filters/sum/index.html"
  html: string;
  /** 사이트맵에 넣을 주소 (noindex 페이지는 null) */
  url: string | null;
}

const ISSUES_URL = "https://github.com/sungdeok-park/lottolabs/issues";
const SAMPLE = [3, 8, 14, 22, 31, 42];
const DISCLAIMER = "필터는 번호를 줄여 줄 뿐, 한 조합의 당첨 확률을 높이지 않습니다. 이 사이트는 당첨을 예측하거나 보장하지 않습니다.";

export const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmt = (n: number) => n.toLocaleString("ko-KR");
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(2)}%`;

interface Meta {
  title: string;
  description: string;
  path: string;
  body: string;
  noindex?: boolean;
}

function layout(m: Meta): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)} · 로또 워크룸</title>
<meta name="description" content="${esc(m.description)}">
${m.noindex ? '<meta name="robots" content="noindex">\n' : ""}<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Ccircle cx=%278%27 cy=%278%27 r=%277%27 fill=%27%231e4fd8%27/%3E%3C/svg%3E">
<link rel="stylesheet" href="/content.css">
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
<header>
  <a class="brand" href="/">로또 워크룸</a>
  <nav aria-label="주 메뉴">
    <a href="/">조합 도구</a>
    <a href="/filters/">필터 해설</a>
    <a href="/probability/">당첨 확률</a>
    <a href="/about/">소개</a>
  </nav>
</header>
<main id="main">
${m.body}
<p class="note">${esc(DISCLAIMER)}</p>
</main>
<footer>
  <a href="/about/">소개</a> · <a href="/privacy/">개인정보처리방침</a> · <a href="/contact/">문의</a>
  <p>복권 구매는 만 19세 이상만 가능하며, 과도한 구매는 삼가세요. 도박 문제로 도움이 필요하면 한국도박문제예방치유원 1336(국번 없이)으로 상담할 수 있습니다. 이 사이트는 복권 판매처가 아닙니다.</p>
</footer>
</body>
</html>
`;
}

const page = (m: Meta): Page => ({ path: m.path, html: layout(m), url: m.noindex ? null : "/" + m.path.replace(/index\.html$/, "") });

const GROUP_ORDER: FilterGroup[] = ["기본 분석", "번호 특성", "분포", "용지", "9궁", "과거 이력"];

function distribution(f: FilterDef): Record<string, number> | null {
  return (dist.filters as Record<string, Record<string, number>>)[f.key] ?? null;
}

function filterPage(f: FilterDef): Page {
  const d = distribution(f);
  const ex = f.needsHistory ? null : f.compute(SAMPLE);
  const rows = d ? Object.entries(d).map(([v, c]) => ({ v: Number(v), c })) : [];
  const max = Math.max(1, ...rows.map((r) => r.c));
  const mode = rows.length ? rows.reduce((a, b) => (b.c > a.c ? b : a)) : null;
  const table = d
    ? `<h2>전체 ${fmt(TOTAL_COMBOS)}개 조합에서의 분포</h2>
<p>1~45에서 6개를 고르는 모든 조합(${fmt(TOTAL_COMBOS)}개)을 하나씩 계산해 값별로 센 결과입니다. 과거 당첨번호나 추정이 아니라 수학적으로 정해진 값입니다.</p>
<table class="dist">
<caption>${esc(f.label)} 값별 조합 수</caption>
<thead><tr><th scope="col">값</th><th scope="col">조합 수</th><th scope="col">비율</th><th scope="col"><span class="sr">비율 막대</span></th></tr></thead>
<tbody>
${rows.map((r) => `<tr><th scope="row">${r.v}</th><td>${fmt(r.c)}</td><td>${pct(r.c, TOTAL_COMBOS)}</td><td><span class="bar" style="width:${Math.max(1, (r.c / max) * 100).toFixed(1)}%"></span></td></tr>`).join("\n")}
</tbody>
</table>
<p>가장 많은 값은 <strong>${mode!.v}</strong>(${pct(mode!.c, TOTAL_COMBOS)})입니다. 조합 수가 많은 값이 당첨 확률이 높다는 뜻은 아닙니다. 모든 조합의 당첨 확률은 같고, 이 표는 "이 조건을 만족하는 조합이 얼마나 많은가"만 보여줍니다.</p>`
    : `<p>이 필터는 직전 회차 등 과거 당첨 이력을 사용하므로 값의 분포가 회차마다 달라집니다. 조합 도구에서 당첨 이력과 함께 사용하세요.</p>`;
  const body = `<nav class="crumbs" aria-label="현재 위치"><a href="/">홈</a> › <a href="/filters/">필터 해설</a> › ${esc(f.label)}</nav>
<h1>${esc(f.label)}</h1>
<p class="lead">${esc(f.description)}</p>
<dl class="facts">
<dt>분류</dt><dd>${esc(f.group)}</dd>
<dt>가능한 값</dt><dd>${f.domain[0]} ~ ${f.domain[1]}</dd>
${ex !== null ? `<dt>예시</dt><dd>${SAMPLE.map((n) => String(n).padStart(2, "0")).join(" ")} → ${esc(f.label)} = <strong>${ex}</strong></dd>` : ""}
</dl>
${table}
<p><a class="button" href="/">이 필터로 조합 만들기</a></p>`;
  return page({
    title: `${f.label} 필터 해설`,
    description: `${f.label}: ${f.description}. 전체 ${fmt(TOTAL_COMBOS)}개 조합에서의 값별 분포를 계산해 보여줍니다.`,
    path: `filters/${f.key}/index.html`,
    body,
    noindex: !!f.needsHistory, // 이력 의존 필터는 설명만 있어 내용이 얇으므로 색인하지 않는다
  });
}

function filtersIndex(): Page {
  const groups = GROUP_ORDER.map((g) => {
    const list = FILTERS.filter((f) => f.group === g);
    return `<h2>${esc(g)} <small>(${list.length}개)</small></h2>
<ul class="grid">
${list.map((f) => `<li><a href="/filters/${f.key}/">${esc(f.label)}</a><span>${esc(f.description)}</span></li>`).join("\n")}
</ul>`;
  }).join("\n");
  return page({
    title: "필터 해설",
    description: `로또 6/45 조합 필터 ${FILTERS.length}종의 정의와 계산 방법, 전체 ${fmt(TOTAL_COMBOS)}개 조합에서의 분포를 정리했습니다.`,
    path: "filters/index.html",
    body: `<h1>필터 해설</h1>
<p class="lead">총합, AC, 홀짝, 용지 라인, 9궁 등 로또 조합 필터의 정의와 계산 방법입니다. 각 필터 페이지에서 전체 ${fmt(TOTAL_COMBOS)}개 조합이 어떻게 분포하는지 확인할 수 있습니다. 회귀 필터는 <a href="/filters/regression/">회귀 필터 해설</a>을 보세요.</p>
${groups}`,
  });
}

function regressionPage(): Page {
  return page({
    title: "회귀 필터 해설",
    description: "N회귀는 목표 회차에서 N회 전 당첨 본번호와 겹치는 번호의 개수입니다. 계산 방법과 1~200회귀 사용법을 설명합니다.",
    path: "filters/regression/index.html",
    body: `<nav class="crumbs" aria-label="현재 위치"><a href="/">홈</a> › <a href="/filters/">필터 해설</a> › 회귀</nav>
<h1>회귀 필터 해설</h1>
<p class="lead">N회귀는 노리는 회차에서 <strong>N회 전</strong> 당첨 본번호와 겹치는 번호가 몇 개인지를 세는 필터입니다. 보너스 번호는 세지 않습니다.</p>
<h2>계산 방법</h2>
<ol>
<li>조합이 노리는 회차를 T라고 합니다.</li>
<li>T−N회의 당첨 본번호 6개를 가져옵니다.</li>
<li>내 조합의 6개 번호 중 그 6개와 같은 번호의 개수가 N회귀 값(0~6)입니다.</li>
</ol>
<h2>설명용 예시</h2>
<p>아래 숫자는 계산 방법을 보여주기 위해 임의로 정한 값이며 실제 당첨번호가 아닙니다.</p>
<ul>
<li>T−3회 당첨 본번호가 03 08 14 22 31 42 이고 내 조합이 03 08 19 27 33 40 이면, 3회귀 값은 2입니다(03, 08이 겹침).</li>
<li>1회귀는 직전 회차와 겹치는 개수이므로 이월수와 같습니다.</li>
</ul>
<h2>범위 정하기</h2>
<p>회귀마다 허용하는 최소~최대 값을 정해 조합을 걸러냅니다. 조합 도구는 1~200회귀를 모두 동시에 켤 수 있고, "최근 10회 기준 일괄 적용"으로 최근 10개 표본의 최솟값·최댓값을 자동으로 채웁니다. 많은 회귀를 한꺼번에 켜면 조건이 엄격해져 남는 조합이 매우 적어질 수 있습니다.</p>
<p><a class="button" href="/">조합 도구에서 회귀 필터 쓰기</a></p>`,
  });
}

function probabilityPage(): Page {
  const rows = rankProbabilities();
  return page({
    title: "로또 6/45 당첨 확률",
    description: `로또 6/45는 서로 다른 ${fmt(TOTAL_COMBOS)}개 조합이 모두 같은 확률로 뽑힙니다. 1~5등 확률과 계산 과정을 설명합니다.`,
    path: "probability/index.html",
    body: `<h1>로또 6/45 당첨 확률</h1>
<p class="lead">1~45에서 6개를 고르는 방법은 모두 ${fmt(TOTAL_COMBOS)}가지이고, 공정한 추첨에서는 각각 같은 확률로 뽑힙니다.</p>
<h2>등수별 확률</h2>
<table class="dist">
<caption>한 장이 각 등수에 해당할 확률</caption>
<thead><tr><th scope="col">등수</th><th scope="col">조건</th><th scope="col">경우의 수</th><th scope="col">확률</th></tr></thead>
<tbody>
${rows.map((r) => `<tr><th scope="row">${r.rank}등</th><td>${esc(r.label)}</td><td>${fmt(r.ways)}</td><td>1 / ${fmt(Math.round(r.oneIn))}</td></tr>`).join("\n")}
</tbody>
</table>
<h2>계산 과정</h2>
<ul>
<li>전체: C(45,6) = ${fmt(TOTAL_COMBOS)}</li>
<li>1등: 6개 모두 일치 = 1</li>
<li>2등: 본번호 5개 + 보너스 = C(6,5) × 1 = 6</li>
<li>3등: 본번호 5개(보너스 제외) = C(6,5) × 38 = 228</li>
<li>4등: 4개 일치 = C(6,4) × C(39,2) = 11,115</li>
<li>5등: 3개 일치 = C(6,3) × C(39,3) = 182,780</li>
</ul>
<p>보너스 번호는 본번호와 겹치지 않는 39개 중 하나로 정해지므로, 5개를 맞히고 남은 한 칸이 보너스 번호일 때만 2등입니다.</p>
<h2>필터를 쓰면 확률이 달라질까요?</h2>
<p>아닙니다. 필터는 후보 조합의 수를 줄일 뿐, 남은 조합 하나하나의 확률은 ${fmt(TOTAL_COMBOS)}분의 1로 같습니다. 어떤 조합이 "자주 나오는 패턴"에 속하더라도, 그 조합이 뽑힐 확률이 높아지지는 않습니다. 다만 다른 사람과 같은 번호를 고를 가능성에는 차이가 있을 수 있습니다.</p>`,
  });
}

function aboutPage(): Page {
  return page({
    title: "소개",
    description: "로또 워크룸은 조건으로 로또 6/45 조합을 만들고 저장·공유한 뒤 추첨 결과를 확인하는 무료 도구입니다.",
    path: "about/index.html",
    body: `<h1>소개</h1>
<p class="lead">로또 워크룸은 내가 정한 조건으로 로또 6/45 조합을 만들고, 저장·공유한 뒤 추첨 결과까지 이어서 확인하는 무료 웹 도구입니다.</p>
<h2>무엇을 할 수 있나요</h2>
<ul>
<li>고정수·제외수·후보 번호를 정하고, ${FILTERS.length}종의 필터와 1~200회귀로 조합을 걸러 냅니다.</li>
<li>필터를 걸 때마다 남는 조합 수를 정확히 세어 보여주고, 어느 필터가 가장 많이 막는지 진단합니다.</li>
<li>만든 조합을 브라우저에 보관하고, 추첨 결과와 자동으로 대조합니다.</li>
</ul>
<h2>이 사이트가 하지 않는 일</h2>
<ul>
<li>당첨 번호를 예측하거나 당첨을 보장하지 않습니다. 모든 조합의 당첨 확률은 같습니다.</li>
<li>복권을 판매하지 않으며, 회원가입이나 결제를 요구하지 않습니다.</li>
</ul>
<h2>운영</h2>
<p>무료로 이용할 수 있으며, 운영 비용은 광고 수익으로 충당할 계획입니다. 광고를 도입하면 <a href="/privacy/">개인정보처리방침</a>에 먼저 알립니다. 서비스 관련 문의와 오류 제보는 <a href="/contact/">문의</a> 페이지를 이용하세요.</p>`,
  });
}

function privacyPage(): Page {
  return page({
    title: "개인정보처리방침",
    description: "로또 워크룸이 어떤 정보를 어디에 저장하는지, 광고와 쿠키는 어떻게 다루는지 설명합니다.",
    path: "privacy/index.html",
    body: `<h1>개인정보처리방침</h1>
<p class="lead">로또 워크룸은 회원가입이 없고, 이용자가 만든 조합과 설정을 서버로 보내지 않습니다.</p>
<h2>저장하는 정보</h2>
<ul>
<li>조합, 필터 설정, 프리셋은 <strong>이용자의 브라우저(IndexedDB)에만</strong> 저장됩니다. 서버로 전송하지 않으며, 브라우저 데이터를 지우면 사라집니다. 보관함의 백업(JSON) 기능으로 직접 내려받아 두세요.</li>
<li>공유 링크의 번호는 주소의 # 뒤 부분에 담깁니다. 이 부분은 서버로 전송되지 않지만, 링크를 가진 사람은 번호를 볼 수 있습니다.</li>
<li>이름, 이메일, 전화번호 등 개인정보를 수집하지 않습니다.</li>
</ul>
<h2>광고와 쿠키</h2>
<p>현재 이 사이트는 광고를 게재하지 않습니다. 앞으로 구글 애드센스 등 광고를 도입하면 Google과 제3자 광고 공급업체가 쿠키 등을 사용해 광고를 게재할 수 있으며, 이용자는 Google 광고 설정에서 맞춤 광고를 끌 수 있습니다. 광고를 도입하기 전에 이 문서를 먼저 갱신하고, 필요한 동의 절차를 안내합니다.</p>
<h2>문의</h2>
<p>이 방침에 대한 문의는 <a href="/contact/">문의</a> 페이지를 이용하세요.</p>
<p class="muted">최종 갱신: 2026-10-06</p>`,
  });
}

function contactPage(): Page {
  return page({
    title: "문의",
    description: "로또 워크룸 오류 제보와 문의 방법입니다.",
    path: "contact/index.html",
    body: `<h1>문의</h1>
<p class="lead">오류 제보, 필터 정의에 대한 의견, 기타 문의는 아래 공개 이슈 페이지로 남겨 주세요.</p>
<p><a class="button" href="${ISSUES_URL}" rel="noopener">GitHub 이슈 남기기</a></p>
<p class="muted">공개 게시판이므로 개인정보나 보관 중인 번호는 올리지 마세요.</p>`,
  });
}

export function buildPages(): Page[] {
  return [
    filtersIndex(),
    regressionPage(),
    ...FILTERS.map(filterPage),
    probabilityPage(),
    aboutPage(),
    privacyPage(),
    contactPage(),
  ];
}

export function buildRobots(siteUrl?: string): string {
  return ["User-agent: *", "Allow: /", "Disallow: /#/share/", ...(siteUrl ? [`Sitemap: ${siteUrl.replace(/\/$/, "")}/sitemap.xml`] : []), ""].join("\n");
}

export function buildSitemap(pages: Page[], siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");
  const urls = ["/", ...pages.map((p) => p.url).filter((u): u is string => !!u)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(base + u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}
