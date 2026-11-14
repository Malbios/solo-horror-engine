import type { BoolExpr, NumberPair, NumExpr } from "./pack";
import { assertNever } from "./result";

export type ExpressionContext = { from: number; to: number; amount: number };

export type ExpressionScope = {
  counters: Readonly<Record<string, number>>;
  zones: Readonly<Record<string, readonly string[]>>;
  context: ExpressionContext;
};

export const EMPTY_CONTEXT: ExpressionContext = { from: 0, to: 0, amount: 0 };

function extreme(pick: (...values: number[]) => number, values: readonly number[]): number {
  return values.length === 0 ? 0 : pick(...values);
}

function evaluatePair(pair: NumberPair, scope: ExpressionScope): [number, number] {
  return [evaluateNumber(pair[0], scope), evaluateNumber(pair[1], scope)];
}

export function evaluateNumber(expr: NumExpr, scope: ExpressionScope): number {
  if (typeof expr === "number") return expr;
  if ("counter" in expr) return scope.counters[expr.counter] ?? 0;
  if ("zoneCount" in expr) return scope.zones[expr.zoneCount]?.length ?? 0;
  if ("context" in expr) return scope.context[expr.context];
  if ("add" in expr) {
    return expr.add.reduce<number>((total, part) => total + evaluateNumber(part, scope), 0);
  }
  if ("sub" in expr) {
    const [left, right] = evaluatePair(expr.sub, scope);
    return left - right;
  }
  if ("mul" in expr) {
    const [left, right] = evaluatePair(expr.mul, scope);
    return left * right;
  }
  if ("min" in expr) {
    return extreme(
      Math.min,
      expr.min.map((part) => evaluateNumber(part, scope)),
    );
  }
  if ("max" in expr) {
    return extreme(
      Math.max,
      expr.max.map((part) => evaluateNumber(part, scope)),
    );
  }
  return assertNever(expr);
}

export function evaluateBoolean(expr: BoolExpr, scope: ExpressionScope): boolean {
  if (typeof expr === "boolean") return expr;
  if ("and" in expr) return expr.and.every((part) => evaluateBoolean(part, scope));
  if ("or" in expr) return expr.or.some((part) => evaluateBoolean(part, scope));
  if ("not" in expr) return !evaluateBoolean(expr.not, scope);
  if ("eq" in expr) {
    const [left, right] = evaluatePair(expr.eq, scope);
    return left === right;
  }
  if ("ne" in expr) {
    const [left, right] = evaluatePair(expr.ne, scope);
    return left !== right;
  }
  if ("lt" in expr) {
    const [left, right] = evaluatePair(expr.lt, scope);
    return left < right;
  }
  if ("lte" in expr) {
    const [left, right] = evaluatePair(expr.lte, scope);
    return left <= right;
  }
  if ("gt" in expr) {
    const [left, right] = evaluatePair(expr.gt, scope);
    return left > right;
  }
  if ("gte" in expr) {
    const [left, right] = evaluatePair(expr.gte, scope);
    return left >= right;
  }
  return assertNever(expr);
}
