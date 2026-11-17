import { cardDefinitionId } from "./cards";
import { distancesFrom, spaceOfUnit, tagsLeaving, type Traversable, type UnitState } from "./graph";
import type {
  BoolExpr,
  DieType,
  Edge,
  EdgeFilter,
  NumberPair,
  NumExpr,
  Space,
  SpaceRef,
  UnitRef,
  UnitSelector,
} from "./pack";
import { assertNever } from "./result";

export type ExpressionContext = {
  from: number;
  to: number;
  amount: number;
  self: string | null;
  candidate: string | null;
  /** The card being played, used or resolved ("this card"), as a card instance id. */
  card: string | null;
  args: Readonly<Record<string, number>>;
};

export type RolledDie = { die: string; face: string; role: string | null };

export type World = {
  units: Readonly<Record<string, UnitState>>;
  edges: Readonly<Record<string, Edge>>;
  spaceCounters: Readonly<Record<string, Readonly<Record<string, number>>>>;
  filters: ReadonlyMap<string, EdgeFilter>;
  spaces: ReadonlyMap<string, Space>;
  pools: Readonly<Record<string, readonly RolledDie[]>>;
  dice: ReadonlyMap<string, DieType>;
  faceUp: Readonly<Record<string, boolean>>;
  cardTags: ReadonlyMap<string, readonly string[]>;
  cardCounters: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Extra kinds each unit kind counts as. */
  kindCountsAs: ReadonlyMap<string, readonly string[]>;
};

/** True when a unit of `actual` kind matches `wanted` (null matches every kind). */
export function kindMatches(
  kindCountsAs: ReadonlyMap<string, readonly string[]>,
  actual: string,
  wanted: string | null,
): boolean {
  return wanted === null || actual === wanted || (kindCountsAs.get(actual) ?? []).includes(wanted);
}

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
  card: null,
  args: {},
};

export const EMPTY_WORLD: World = {
  units: {},
  edges: {},
  spaceCounters: {},
  filters: new Map(),
  spaces: new Map(),
  pools: {},
  dice: new Map(),
  faceUp: {},
  cardTags: new Map(),
  cardCounters: {},
  kindCountsAs: new Map(),
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
  return (edge, departure) => {
    const tags = tagsLeaving(edge, departure);
    return (
      filter.requireTags.every((tag) => tags.includes(tag)) &&
      !filter.excludeTags.some((tag) => tags.includes(tag)) &&
      (!filter.useGates || evaluateBoolean(edge.gate, scope))
    );
  };
}

/** The reachable unit of a kind nearest to (or farthest from) the origin; ties go to the lowest id. */
function extremeUnit(
  query: UnitSelector,
  farthest: boolean,
  scope: ExpressionScope,
): string | null {
  const origin = resolveSpace(query.origin, scope);
  if (origin === null) return null;
  const distances = distancesFrom(scope.world.edges, origin, traversableFor(query.filter, scope));
  let best: { id: string; distance: number } | null = null;
  for (const unit of Object.values(scope.world.units).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!kindMatches(scope.world.kindCountsAs, unit.kind, query.kind)) continue;
    const candidateScope = { ...scope, context: { ...scope.context, self: unit.id } };
    if (!evaluateBoolean(query.where, candidateScope)) continue;
    const space = spaceOfUnit(scope.world.units, unit.id);
    const distance = space === null ? undefined : distances.get(space);
    if (distance === undefined) continue;
    const better =
      best === null || (farthest ? distance > best.distance : distance < best.distance);
    if (better) best = { id: unit.id, distance };
  }
  return best?.id ?? null;
}

export function resolveUnit(ref: UnitRef, scope: ExpressionScope): string | null {
  if (ref === "self") {
    const self = scope.context.self;
    return self !== null && scope.world.units[self] !== undefined ? self : null;
  }
  if ("id" in ref) return scope.world.units[ref.id] === undefined ? null : ref.id;
  if ("closest" in ref) return extremeUnit(ref.closest, false, scope);
  return extremeUnit(ref.farthest, true, scope);
}

export function resolveSpace(ref: SpaceRef, scope: ExpressionScope): string | null {
  if (ref === "candidate") return scope.context.candidate;
  if ("space" in ref) return ref.space;
  const unit = resolveUnit(ref.locationOf, scope);
  const space = unit === null ? null : spaceOfUnit(scope.world.units, unit);
  if (space !== null) return space;
  return ref.fallback === null ? null : resolveSpace(ref.fallback, scope);
}

function faceSymbols(rolled: RolledDie, scope: ExpressionScope): Record<string, number> {
  const faces = scope.world.dice.get(rolled.die)?.faces ?? [];
  return faces.find((face) => face.id === rolled.face)?.symbols ?? {};
}

function diceCount(
  query: Extract<NumExpr, { diceCount: unknown }>["diceCount"],
  scope: ExpressionScope,
): number {
  const dice = (scope.world.pools[query.pool] ?? []).filter(
    (rolled) => query.role === null || rolled.role === query.role,
  );
  if (query.symbol === null) return dice.length;
  const symbol = query.symbol;
  return dice.reduce((total, rolled) => total + (faceSymbols(rolled, scope)[symbol] ?? 0), 0);
}

function countUnits(kind: string | null, at: SpaceRef | null, scope: ExpressionScope): number {
  const space = at === null ? null : resolveSpace(at, scope);
  if (at !== null && space === null) return 0;
  return Object.values(scope.world.units).filter(
    (unit) =>
      kindMatches(scope.world.kindCountsAs, unit.kind, kind) &&
      (space === null || spaceOfUnit(scope.world.units, unit.id) === space),
  ).length;
}

function countCards(
  query: Extract<NumExpr, { countCards: unknown }>["countCards"],
  scope: ExpressionScope,
): number {
  return (scope.zones[query.zone] ?? []).filter((card) => {
    if (scope.world.faceUp[card] !== true) return false;
    const definition = cardDefinitionId(card);
    if (query.card !== null && definition !== query.card) return false;
    return query.tag === null || (scope.world.cardTags.get(definition) ?? []).includes(query.tag);
  }).length;
}

function thisCardMatches(
  query: Extract<BoolExpr, { thisCard: unknown }>["thisCard"],
  scope: ExpressionScope,
): boolean {
  const card = scope.context.card;
  if (card === null) return false;
  const inZone = query.zone === null || (scope.zones[query.zone] ?? []).includes(card);
  const tagged =
    query.tag === null ||
    (scope.world.cardTags.get(cardDefinitionId(card)) ?? []).includes(query.tag);
  return inZone && tagged;
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
  if ("arg" in expr) return scope.context.args[expr.arg] ?? 0;
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
  if ("diceCount" in expr) return diceCount(expr.diceCount, scope);
  if ("countUnits" in expr) return countUnits(expr.countUnits.kind, expr.countUnits.at, scope);
  if ("distance" in expr) return distance(expr.distance, scope);
  if ("countCards" in expr) return countCards(expr.countCards, scope);
  if ("cardCounter" in expr) {
    const card = scope.context.card;
    return card === null ? 0 : (scope.world.cardCounters[card]?.[expr.cardCounter] ?? 0);
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
    const kind = unit === null ? undefined : scope.world.units[unit]?.kind;
    return kind !== undefined && kindMatches(scope.world.kindCountsAs, kind, expr.unitIsKind.kind);
  }
  if ("sameSpace" in expr) {
    const [first, second] = expr.sameSpace.map((ref) => {
      const unit = resolveUnit(ref, scope);
      return unit === null ? null : spaceOfUnit(scope.world.units, unit);
    });
    return first !== null && first !== undefined && first === second;
  }
  if ("thisCard" in expr) return thisCardMatches(expr.thisCard, scope);
  if ("topFaceUp" in expr) {
    const top = scope.zones[expr.topFaceUp]?.[0];
    return top !== undefined && scope.world.faceUp[top] === true;
  }
  return assertNever(expr);
}
