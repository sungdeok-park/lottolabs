import { forEachCombo, type EnumControl } from "./enumerate";
import { compileRules, ruleAccepts } from "./filters";
import type { FilterRule, HistoryContext } from "./types";

export interface RuleDiagnosis {
  key: string;
  /** 이 규칙 하나만 어겨서 걸러진 조합 수 = 이 규칙만 끄면 되살아나는 조합 수 */
  blockedAlone: number;
}

export interface Diagnosis {
  total: number;
  passed: number;
  /** 어긴 규칙 수별 조합 수: [0개, 1개, 2개 이상] */
  failedHistogram: [number, number, number];
  rules: RuleDiagnosis[];
  cancelled: boolean;
}

/**
 * 필터 진단. 한 번의 전체 열거로 "어떤 규칙이 단독으로 가장 많이 막고 있는지"를 구한다.
 * 규칙을 2개 이상 어긴 조합은 일찍 멈추고 세지 않으므로, 개별 통과 수는 countSpace의 independent를 쓴다.
 */
export async function diagnose(
  o: { fixed: number[]; exclude: number[]; candidates: number[]; rules: FilterRule[]; history?: HistoryContext },
  control: EnumControl = {},
): Promise<Diagnosis> {
  const compiled = compileRules(o.rules);
  const blocked = compiled.map(() => 0);
  const hist: [number, number, number] = [0, 0, 0];
  let total = 0;
  const done = await forEachCombo(o, (c) => {
    total++;
    let fails = 0;
    let which = -1;
    for (let i = 0; i < compiled.length; i++) {
      const { rule, def } = compiled[i]!;
      if (!ruleAccepts(rule, def.compute(c, o.history))) {
        fails++;
        which = i;
        if (fails >= 2) break;
      }
    }
    hist[Math.min(fails, 2)]!++;
    if (fails === 1) blocked[which]!++;
  }, control);
  return {
    total,
    passed: hist[0],
    failedHistogram: hist,
    rules: compiled.map((c, i) => ({ key: c.rule.key, blockedAlone: blocked[i]! })).sort((a, b) => b.blockedAlone - a.blockedAlone),
    cancelled: !done,
  };
}
