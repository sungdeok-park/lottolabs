import type { Combo } from "./types";

/**
 * 안전한 표현식 해석기. eval/Function을 쓰지 않고 허용된 문법만 파싱한다.
 *  값: 숫자, 지표 이름(예: sum, ac, odd), n1~n6(오름차순 번호)
 *  연산: + - * / %  < <= > >= == !=  && || !  ( )
 *  함수: min(a,b,..) max(a,b,..) abs(x) has(n)
 */
export class ExprError extends Error {}

type Node =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "un"; op: "-" | "!"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "call"; fn: string; args: Node[] };

export const MAX_EXPR_LENGTH = 300;
const MAX_DEPTH = 40;
const FUNCS: Record<string, { min: number; max: number }> = {
  min: { min: 1, max: 8 }, max: { min: 1, max: 8 }, abs: { min: 1, max: 1 }, has: { min: 1, max: 1 },
};
const PREC: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|&&|\|\||==|!=|<=|>=|[-+*/%<>!(),])/y;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i]!)) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new ExprError(`허용되지 않는 문자: '${src[i]}' (위치 ${i + 1})`);
    out.push(m[1]!);
    i = re.lastIndex;
  }
  return out;
}

export function parseExpr(src: string): Node {
  if (src.length > MAX_EXPR_LENGTH) throw new ExprError(`표현식은 ${MAX_EXPR_LENGTH}자 이하여야 합니다.`);
  const tk = tokenize(src);
  if (!tk.length) throw new ExprError("표현식이 비어 있습니다.");
  let p = 0;
  const peek = () => tk[p];
  const next = () => tk[p++];
  const expect = (s: string) => { if (next() !== s) throw new ExprError(`'${s}'가 필요합니다.`); };

  function primary(depth: number): Node {
    if (depth > MAX_DEPTH) throw new ExprError("표현식이 너무 깊습니다.");
    const t = next();
    if (t === undefined) throw new ExprError("표현식이 끝났지만 값이 더 필요합니다.");
    if (t === "(") { const e = expr(0, depth + 1); expect(")"); return e; }
    if (t === "-" || t === "!") return { t: "un", op: t, a: primary(depth + 1) };
    if (/^\d/.test(t)) return { t: "num", v: Number(t) };
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === "(") {
        const spec = FUNCS[t];
        if (!spec) throw new ExprError(`알 수 없는 함수: ${t}`);
        next();
        const args: Node[] = [];
        if (peek() !== ")") { do args.push(expr(0, depth + 1)); while (peek() === "," && next()); }
        expect(")");
        if (args.length < spec.min || args.length > spec.max) throw new ExprError(`${t}()의 인자 수가 올바르지 않습니다.`);
        return { t: "call", fn: t, args };
      }
      return { t: "var", name: t };
    }
    throw new ExprError(`예상하지 못한 토큰: ${t}`);
  }
  function expr(minPrec: number, depth: number): Node {
    let left = primary(depth);
    for (;;) {
      const op = peek();
      const pr = op ? PREC[op] : undefined;
      if (pr === undefined || pr <= minPrec) return left;
      next();
      left = { t: "bin", op: op!, a: left, b: expr(pr, depth + 1) };
    }
  }
  const root = expr(0, 0);
  if (p < tk.length) throw new ExprError(`남는 토큰: ${tk[p]}`);
  return root;
}

export function collectVars(n: Node, into = new Set<string>()): Set<string> {
  if (n.t === "var") into.add(n.name);
  else if (n.t === "un") collectVars(n.a, into);
  else if (n.t === "bin") { collectVars(n.a, into); collectVars(n.b, into); }
  else if (n.t === "call") n.args.forEach((a) => collectVars(a, into));
  return into;
}

export function evalExpr(n: Node, combo: Combo, resolve: (name: string) => number | undefined): number {
  const go = (x: Node): number => {
    switch (x.t) {
      case "num": return x.v;
      case "var": {
        const m = /^n([1-6])$/.exec(x.name);
        if (m) return [...combo].sort((a, b) => a - b)[Number(m[1]) - 1]!;
        const v = resolve(x.name);
        if (v === undefined) throw new ExprError(`알 수 없는 변수: ${x.name}`);
        return v;
      }
      case "un": return x.op === "-" ? -go(x.a) : go(x.a) ? 0 : 1;
      case "call": {
        const a = x.args.map(go);
        if (x.fn === "min") return Math.min(...a);
        if (x.fn === "max") return Math.max(...a);
        if (x.fn === "abs") return Math.abs(a[0]!);
        return combo.includes(a[0]!) ? 1 : 0;
      }
      case "bin": {
        if (x.op === "&&") return go(x.a) && go(x.b) ? 1 : 0;
        if (x.op === "||") return go(x.a) || go(x.b) ? 1 : 0;
        const l = go(x.a), r = go(x.b);
        switch (x.op) {
          case "+": return l + r;
          case "-": return l - r;
          case "*": return l * r;
          case "/": return r === 0 ? 0 : l / r;
          case "%": return r === 0 ? 0 : l % r;
          case "<": return l < r ? 1 : 0;
          case "<=": return l <= r ? 1 : 0;
          case ">": return l > r ? 1 : 0;
          case ">=": return l >= r ? 1 : 0;
          case "==": return l === r ? 1 : 0;
          default: return l !== r ? 1 : 0;
        }
      }
    }
  };
  return go(n);
}
