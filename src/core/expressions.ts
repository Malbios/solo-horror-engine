import { distancesFrom, spaceOfUnit, type Traversable, type UnitState } from "./graph";
import type {
  BoolExpr,
  Edge,
  EdgeFilter,
  NumberPair,
  NumExpr,
  Space,
  SpaceRef,
  UnitRef,
} from "./pack";
import { assertNever } from "./result";

export type ExpressionContext = {
  from: number;
  to: number;
  amount: number;
  self: string | null;
  candidate: string | null;
};

export type World = {
  units: Readonly<Record<string, UnitState>>;
  edges: Readonly<Record<string, Edge>>;
  spaceCounters: Readonly<Record<string, Readonly<Record<string, number>>>>;
  filters: ReadonlyMap<string, EdgeFilter>;
  spaces: ReadonlyMap<string, Space>;
};

export type ExpressionScope = {
  counters: Readonly<Record<string, number>>;
  zones: Readonly<Record<string, readonly string[]>>;
  world: World;
  context: ExpressionContext;
};

export const EMPTY_CONTEXT: ExpressionContext = {
  from: 0,
  to: 0,
  amount: 0,
  self: null,
  candidate: null,
};

export const EMPTY_WORLD: World = {
  units: {},
  edges: {},
  spaceCounters: {},
  filters: new Map(),
  spaces: new Map(),
};

function extreme(pick: (...values: number[]) => number, values: readonly number[]): number {
  return values.length === 0 ? 0 : pick(...values);
}

function evaluatePair(pair: NumberPair, scope: ExpressionScope): [number, number] {
  return [evaluateNumber(pair[0], scope), evaluateNumber(pair[1], scope)];
}

/** Edge predicate for a named filter; gates are evaluated now, against the current state. */
export function traversableFor(filterId: string, scope: ExpressionScope): Traversable {
  const filter = scope.world.filters.get(filterId);
  if (filter === undefined) return () => false;
  return (edge) =>
    filter.requireTags.every((tag) => edge.tags.includes(tag)) &&
    !filter.excludeTags.some((tag) => edge.tags.includes(tag)) &&
    (!filter.useGates || evaluateBoolean(edge.gate, scope));
}

function closestUnit(
  kind: string,
  origin: string,
  filterId: string,
  scope: ExpressionScope,
): string | null {
  const distances = distancesFrom(scope.world.edges, origin, traversableFor(filterId, scope));
  let best: { id: string; distance: number } | null = null;
  for (const unit of Object.values(scope.world.units).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (unit.kind !== kind) continue;
    const space = spaceOfUnit(scope.world.units, unit.id);
    const distance = space === null ? undefined : distances.get(space);
    if (distance !== undefined && (best === null || distance < best.distance)) {
      best = { id: unit.id, distance };
    }
  }
  return best?.id ?? null;
}

export function resolveUnit(ref: UnitRef, scope: ExpressionScope): string | null {
  if (ref === "self") {
    const self = scope.context.self;
    return self !== null && scope.world.units[self] !== undefined ? self : null;
  }
  if ("id" in ref) return scope.world.units[ref.id] === undefined ? null : ref.id;
  const origin = resolveSpace(ref.closest.origin, scope);
  return origin === null ? null : closestUnit(ref.closest.kind, origin, ref.closest.filter, scope);
}

export function resolveSpace(ref: SpaceRef, scope: ExpressionScope): string | null {
  if (ref === "candidate") return scope.context.candidate;
  if ("space" in ref) return ref.space;
  const unit = resolveUnit(ref.locationOf, scope);
  const space = unit === null ? null : spaceOfUnit(scope.world.units, unit);
  if (space !== null) return space;
  return ref.fallback === null ? null : resolveSpace(ref.fallback, scope);
}

function countUnits(kind: string | null, at: SpaceRef | null, scope: ExpressionScope): number {
  const space = at === null ? null : resolveSpace(at, scope);
  if (at !== null && space === null) return 0;
  return Object.values(scope.world.units).filter(
    (unit) =>
      (kind === null || unit.kind === kind) &&
      (space === null || spaceOfUnit(scope.world.units, unit.id) === space),
  ).length;
}

function distance(
  query: Extract<NumExpr, { distance: unknown }>["distance"],
  scope: ExpressionScope,
): number {
  const origin = resolveSpace(query.origin, scope);
  const destination = resolveSpace(query.destination, scope);
  const steps =
    origin === null || destination === null
      ? undefined
      : distancesFrom(scope.world.edges, origin, traversableFor(query.filter, scope)).get(
          destination,
        );
  return steps ?? evaluateNumber(query.ifUnreachable, scope);
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
  if ("attribute" in expr) {
    const unit = resolveUnit(expr.of, scope);
    return unit === null ? 0 : (scope.world.units[unit]?.attributes[expr.attribute] ?? 0);
  }
  if ("spaceCounter" in expr) {
    const space = resolveSpace(expr.at, scope);
    return space === null ? 0 : (scope.world.spaceCounters[space]?.[expr.spaceCounter] ?? 0);
  }
  if ("countUnits" in expr) return countUnits(expr.countUnits.kind, expr.countUnits.at, scope);
  if ("distance" in expr) return distance(expr.distance, scope);
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
  if ("unitExists" in expr) return resolveUnit(expr.unitExists, scope) !== null;
  if ("spaceHasTag" in expr) {
    const space = resolveSpace(expr.spaceHasTag.at, scope);
    return (
      space !== null &&
      (scope.world.spaces.get(space)?.tags.includes(expr.spaceHasTag.tag) ?? false)
    );
  }
  if ("unitIsKind" in expr) {
    const unit = resolveUnit(expr.unitIsKind.unit, scope);
    return unit !== null && scope.world.units[unit]?.kind === expr.unitIsKind.kind;
  }
  if ("sameSpace" in expr) {
    const [first, second] = expr.sameSpace.map((ref) => {
      const unit = resolveUnit(ref, scope);
      return unit === null ? null : spaceOfUnit(scope.world.units, unit);
    });
    return first !== null && first !== undefined && first === second;
  }
  return assertNever(expr);
}
