import { checkExpr, compileRules, evaluateCompiled, resolveDef, ruleAccepts } from "./filters";
import { MAX_NUM, PICK, comboKey, sortCombo } from "./metrics";
import type { Combo, FilterRule, GenerateOptions, GenerateResult, HistoryContext } from "./types";

export interface Problem {
  code: string;
  message: string;
}

const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_NUM;

/** 실행 전에 확정적으로 불가능한 조건을 찾는다. */
export function validateOptions(o: Pick<GenerateOptions, "fixed" | "exclude" | "candidates" | "rules" | "count">, hasHistory: boolean): Problem[] {
  const p: Problem[] = [];
  const bad = [...o.fixed, ...o.exclude, ...o.candidates].filter((n) => !inRange(n));
  if (bad.length) p.push({ code: "range", message: `1~45 정수만 입력할 수 있습니다: ${bad.join(", ")}` });
  if (new Set(o.fixed).size !== o.fixed.length) p.push({ code: "fixed-dup", message: "고정수에 중복이 있습니다." });
  if (o.fixed.length > PICK) p.push({ code: "fixed-many", message: `고정수는 최대 ${PICK}개입니다.` });
  const clash = o.fixed.filter((n) => o.exclude.includes(n));
  if (clash.length) p.push({ code: "fixed-excluded", message: `고정수와 제외수가 충돌합니다: ${clash.join(", ")}` });
  if (o.candidates.length > 0) {
    const outside = o.fixed.filter((n) => !o.candidates.includes(n));
    // 고정수는 후보 번호군과 별개 개념이므로 후보 밖이어도 허용한다. (경고 대상 아님)
    void outside;
  }
  const pool = poolOf(o.fixed, o.exclude, o.candidates);
  const need = PICK - o.fixed.length;
  if (o.fixed.length <= PICK && pool.length < need) {
    p.push({ code: "pool-small", message: `고를 수 있는 번호가 ${pool.length}개뿐이라 ${need}개를 채울 수 없습니다.` });
  }
  for (const r of o.rules) {
    if (r.enabled === false) continue;
    if (r.expr !== undefined) {
      const chk = checkExpr(r.expr);
      if (!chk.ok) {
        p.push({ code: "expr-syntax", message: `${r.label ?? "표현식"}: ${chk.error}` });
        continue;
      }
    }
    if (r.set && (r.set.some((n) => !inRange(n)) || new Set(r.set).size !== r.set.length || r.set.length === 0)) {
      p.push({ code: "set-invalid", message: `${r.label ?? "번호 집합"}: 1~45 사이 중복 없는 번호가 필요합니다.` });
      continue;
    }
    const def = resolveDef(r);
    if (!def) {
      p.push({ code: "unknown-rule", message: `알 수 없는 필터: ${r.key}` });
      continue;
    }
    if (r.min !== undefined && r.max !== undefined && r.min > r.max) p.push({ code: "range-inverted", message: `${def.label}: 최소가 최대보다 큽니다.` });
    if (def.needsHistory && !hasHistory) p.push({ code: "no-history", message: `${def.label}: 당첨 이력이 없어 적용할 수 없습니다.` });
    const [lo, hi] = def.domain;
    let possible = false;
    for (let v = lo; v <= hi && !possible; v++) possible = ruleAccepts(r, v);
    if (!possible) p.push({ code: "rule-impossible", message: `${def.label}: 가능한 값(${lo}~${hi})과 겹치지 않는 조건입니다.` });
  }
  if (!Number.isInteger(o.count) || o.count < 1) p.push({ code: "count", message: "생성 개수는 1 이상의 정수입니다." });
  return p;
}

export function poolOf(fixed: readonly number[], exclude: readonly number[], candidates: readonly number[]): number[] {
  const base = candidates.length > 0 ? candidates : Array.from({ length: MAX_NUM }, (_, i) => i + 1);
  const ex = new Set(exclude);
  const fx = new Set(fixed);
  return [...new Set(base)].filter((n) => !ex.has(n) && !fx.has(n));
}

export interface Progress {
  found: number;
  attempts: number;
}

/**
 * 거절 샘플링으로 조합을 만든다. 시도 상한에 도달하면 'attempt-limit'이며
 * 이는 "가능한 조합이 0개"라는 뜻이 아니다.
 */
export function generate(
  opts: GenerateOptions,
  control: { shouldStop?: () => boolean } = {},
): GenerateResult {
  const gen = createGenerator(opts);
  while (!gen.finished) gen.step(2000, control.shouldStop);
  return gen.result();
}

export function createGenerator(opts: GenerateOptions) {
  const rng = opts.rng ?? Math.random;
  const pool = poolOf(opts.fixed, opts.exclude, opts.candidates);
  const need = PICK - opts.fixed.length;
  const compiled = compileRules(opts.rules);
  const seen = new Set<string>();
  const combos: Combo[] = [];
  const rejected: Record<string, number> = {};
  let attempts = 0;
  let reason: GenerateResult["reason"] | null = null;
  const buf = pool.slice();

  const draw = (): Combo => {
    // 부분 Fisher-Yates
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (buf.length - i));
      [buf[i], buf[j]] = [buf[j]!, buf[i]!];
    }
    return sortCombo([...opts.fixed, ...buf.slice(0, need)]);
  };

  return {
    get finished() {
      return reason !== null;
    },
    step(budget: number, shouldStop?: () => boolean) {
      if (reason) return;
      if (need < 0 || pool.length < need) {
        reason = "attempt-limit";
        return;
      }
      for (let i = 0; i < budget; i++) {
        if (shouldStop?.()) {
          reason = "cancelled";
          return;
        }
        if (combos.length >= opts.count) {
          reason = "done";
          return;
        }
        if (attempts >= opts.maxAttempts) {
          reason = "attempt-limit";
          return;
        }
        attempts++;
        const c = draw();
        const key = comboKey(c);
        if (seen.has(key)) continue;
        const failed = evaluateCompiled(c, compiled, opts.history);
        if (failed) {
          rejected[failed.key] = (rejected[failed.key] ?? 0) + 1;
          continue;
        }
        seen.add(key);
        combos.push(c);
      }
      if (combos.length >= opts.count) reason = "done";
    },
    progress: (): Progress => ({ found: combos.length, attempts }),
    result: (): GenerateResult => ({ combos, attempts, reason: reason ?? "cancelled", rejectedByRule: rejected }),
  };
}

export interface CountResult {
  total: number;
  passed: number;
  /** 필터를 하나씩 순서대로 적용했을 때 남는 개수 */
  cumulative: { key: string; remaining: number }[];
  /** 각 필터 단독으로 통과한 개수 */
  independent: Record<string, number>;
  cancelled: boolean;
}

/** 정확한 전체 열거. 풀이 크면 시간이 걸리므로 yieldEvery마다 await 한다. */
export async function countSpace(
  o: { fixed: number[]; exclude: number[]; candidates: number[]; rules: FilterRule[]; history?: HistoryContext },
  control: { shouldStop?: () => boolean; yieldEvery?: number } = {},
): Promise<CountResult> {
  const pool = poolOf(o.fixed, o.exclude, o.candidates);
  const need = PICK - o.fixed.length;
  const compiled = compileRules(o.rules);
  const rules = compiled.map((x) => x.rule);
  const cum = rules.map(() => 0);
  const indep: Record<string, number> = Object.fromEntries(rules.map((r) => [r.key, 0]));
  const res: CountResult = { total: 0, passed: 0, cumulative: [], independent: indep, cancelled: false };
  const yieldEvery = control.yieldEvery ?? 200_000;
  if (need < 0 || pool.length < need) {
    res.cumulative = rules.map((r) => ({ key: r.key, remaining: 0 }));
    return res;
  }
  const idx = Array.from({ length: need }, (_, i) => i);
  const k = need;
  let tick = 0;
  const visit = () => {
    const c = sortCombo([...o.fixed, ...idx.map((i) => pool[i]!)]);
    res.total++;
    let alive = true;
    for (let r = 0; r < rules.length; r++) {
      const { rule, def } = compiled[r]!;
      const ok = ruleAccepts(rule, def.compute(c, o.history));
      if (ok) indep[rule.key]!++;
      else alive = false;
      if (alive) cum[r]!++;
    }
    if (alive) res.passed++;
  };
  if (k === 0) visit();
  else {
    for (;;) {
      visit();
      if (++tick % yieldEvery === 0) {
        if (control.shouldStop?.()) {
          res.cancelled = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      let i = k - 1;
      while (i >= 0 && idx[i] === pool.length - k + i) i--;
      if (i < 0) break;
      idx[i]!++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
    }
  }
  res.cumulative = rules.map((r, i) => ({ key: r.key, remaining: cum[i]! }));
  return res;
}
