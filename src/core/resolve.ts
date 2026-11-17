import { cardDefinitionId } from "./cards";
import type { Rules } from "./compose";
import {
  EMPTY_CONTEXT,
  EMPTY_WORLD,
  evaluateBoolean,
  evaluateNumber,
  resolveSpace,
  resolveUnit,
  traversableFor,
  kindMatches,
  type ExpressionContext,
  type ExpressionScope,
  type World,
} from "./expressions";
import {
  containsOrIs,
  distancesTo,
  edgesBetween,
  neighbours,
  spaceOfUnit,
  type Traversable,
  type UnitPlacement,
} from "./graph";
import type {
  Action,
  AssignFrame,
  Decision,
  DeliverFrame,
  Die,
  EffectsFrame,
  FinishFrame,
  FollowFrame,
  Frame,
  GameEvent,
  GameState,
  MoveFrame,
  PayFrame,
  PickFrame,
  AbilityOffer,
  PlayWindowFrame,
  RerollFrame,
  ScopeFrame,
  SelectFrame,
  SetFaceFrame,
} from "./model";
import type {
  Ability,
  Card,
  CardFilter,
  Followers,
  CardPosition,
  Cost,
  Counter,
  DieType,
  Edge,
  Effect,
  EventPattern,
  Modifier,
  Order,
  Outcome,
  OutcomeRule,
  Pack,
  Placement,
  Scope,
  ScopeHooks,
  UnitSet,
  WindowBuy,
  WindowPlay,
} from "./pack";
import { offeredModules } from "./pack";
import { assertNever, type Result } from "./result";
import { nextInt, shuffle } from "./rng";

export const MAX_OPERATIONS_PER_CALL = 10_000;

const NO_HOOKS: ScopeHooks = { onEnter: [], onExit: [] };

const CHECK_SOURCE_PREFIX = "check:";

export class EngineFaultSignal extends Error {}

export type RulesLookup = (modules: readonly string[]) => Result<Rules, string>;

export type Resolver = {
  apply(action: Action): void;
  run(): void;
};

function fault(reason: string): never {
  throw new EngineFaultSignal(reason);
}

function clamp(value: number, min: number | null, max: number | null): number {
  const raised = min === null ? value : Math.max(min, value);
  return max === null ? raised : Math.min(max, raised);
}

function matchesPattern(
  pattern: EventPattern,
  event: GameEvent,
  kindCountsAs: ReadonlyMap<string, readonly string[]>,
): boolean {
  const kindFits = (wanted: string | null, actual: string | null) =>
    wanted === null || (actual !== null && kindMatches(kindCountsAs, actual, wanted));
  switch (pattern.event) {
    case "counterChanged":
      return event.type === "counterChanged" && event.counter === pattern.counter;
    case "cardsMoved":
      return (
        event.type === "cardsMoved" &&
        (pattern.from === null || pattern.from === event.from) &&
        (pattern.to === null || pattern.to === event.to)
      );
    case "scopeEntered":
    case "scopeExited":
      return (
        event.type === pattern.event &&
        event.scope === pattern.scope &&
        (pattern.id === null || pattern.id === event.id)
      );
    case "unitCreated":
      return event.type === "unitCreated" && kindFits(pattern.kind, event.kind);
    case "unitRemoved":
      return event.type === "unitRemoved" && kindFits(pattern.kind, event.kind);
    case "unitMoved":
      return (
        event.type === "unitMoved" &&
        kindFits(pattern.kind, event.kind) &&
        (pattern.toSpace === null || pattern.toSpace === event.toSpace)
      );
    case "attributeChanged":
      return (
        event.type === "attributeChanged" &&
        event.attribute === pattern.attribute &&
        kindFits(pattern.kind, event.kind)
      );
    case "spaceCounterChanged":
      return event.type === "spaceCounterChanged" && event.spaceCounter === pattern.spaceCounter;
    case "diceRolled":
      return event.type === "diceRolled" && (pattern.pool === null || pattern.pool === event.pool);
    case "quantityDelivered":
      return (
        event.type === "quantityDelivered" &&
        event.quantity === pattern.quantity &&
        kindFits(pattern.kind, event.kind)
      );
    default:
      return assertNever(pattern);
  }
}

/**
 * Drives one working copy of the state until a decision is pending or the game ends.
 * The working copy is mutated in place; callers pass a clone, never shared state.
 */
export function createResolver(
  pack: Pack,
  lookupRules: RulesLookup,
  work: GameState,
  events: GameEvent[],
): Resolver {
  let operations = 0;
  let rules: Rules | null = work.stage === "choices" ? null : loadRules();

  function loadRules(): Rules {
    const composed = lookupRules(work.modules);
    return composed.ok ? composed.value : fault(composed.error);
  }

  let cardTagsCache: { rules: Rules; tags: ReadonlyMap<string, readonly string[]> } | null = null;

  function requireRules(): Rules {
    return rules ?? fault("Rules are not composed yet");
  }

  function worldView(): World {
    if (rules === null) return EMPTY_WORLD;
    return {
      units: work.units,
      edges: work.edges,
      spaceCounters: work.spaceCounters,
      filters: rules.edgeFilterById,
      spaces: rules.spaceById,
      pools: work.pools,
      dice: rules.dieById,
      faceUp: work.faceUp,
      cardTags: cardTagsOf(rules),
      cardCounters: work.cardCounters,
      kindCountsAs: kindCountsAsOf(rules),
    };
  }

  let kindCountsAsCache: {
    rules: Rules;
    kinds: ReadonlyMap<string, readonly string[]>;
  } | null = null;

  function kindCountsAsOf(composed: Rules): ReadonlyMap<string, readonly string[]> {
    if (kindCountsAsCache?.rules !== composed) {
      kindCountsAsCache = {
        rules: composed,
        kinds: new Map(composed.unitKinds.map((kind) => [kind.id, kind.countsAs])),
      };
    }
    return kindCountsAsCache.kinds;
  }

  function cardTagsOf(composed: Rules): ReadonlyMap<string, readonly string[]> {
    if (cardTagsCache?.rules !== composed) {
      cardTagsCache = {
        rules: composed,
        tags: new Map(composed.cards.map((card) => [card.id, card.tags])),
      };
    }
    return cardTagsCache.tags;
  }

  function scopeOf(context: ExpressionContext): ExpressionScope {
    return { counters: work.counters, zones: work.zones, world: worldView(), context };
  }

  function contextFor(self: string | null, from = 0, to = 0, amount = 0): ExpressionContext {
    return { from, to, amount, self, candidate: null, card: null, args: {} };
  }

  function cardContext(card: string): ExpressionContext {
    return { ...EMPTY_CONTEXT, card };
  }

  function zoneCards(zoneId: string): string[] {
    return work.zones[zoneId] ?? fault(`Unknown zone "${zoneId}"`);
  }

  function cardDefinition(cardInstance: string): Card {
    const id = cardDefinitionId(cardInstance);
    return requireRules().cardById.get(id) ?? fault(`Unknown card "${id}"`);
  }

  function pushEffects(
    effects: readonly Effect[],
    context: ExpressionContext,
    source: string | null,
  ): boolean {
    if (effects.length === 0) return false;
    work.stack.push({ kind: "effects", effects: [...effects], index: 0, context, source });
    return true;
  }

  function emit(event: GameEvent, context: ExpressionContext): void {
    events.push(event);
    if (rules === null) return;
    const kindCountsAs = kindCountsAsOf(rules);
    const scope = scopeOf(context);
    const fired = rules.triggers.filter(
      (trigger) =>
        matchesPattern(trigger.on, event, kindCountsAs) &&
        !(trigger.once && work.firedTriggers.includes(trigger.id)) &&
        evaluateBoolean(trigger.condition, scope),
    );
    for (const trigger of [...fired].reverse()) {
      if (trigger.once) work.firedTriggers.push(trigger.id);
      pushEffects(trigger.effects, context, null);
    }
  }

  function writeBounded(
    definition: Counter,
    from: number,
    requested: number,
    self: string | null,
    store: (value: number) => void,
    announce: (from: number, to: number) => void,
  ): void {
    const to = clamp(requested, definition.min, definition.max);
    store(to);
    const excess = requested - to;
    const boundEffects = excess > 0 ? definition.onOverflow : definition.onUnderflow;
    const repetitions = Math.abs(excess);
    if (boundEffects.length > 0 && repetitions > 0) {
      if (repetitions > MAX_OPERATIONS_PER_CALL) {
        fault(`Counter "${definition.id}" exceeded its bounds by ${repetitions}`);
      }
      for (let repetition = 0; repetition < repetitions; repetition++) {
        pushEffects(boundEffects, contextFor(self), null);
      }
    }
    if (from !== to) announce(from, to);
  }

  function writeCounter(counterId: string, requested: number): void {
    const definition =
      requireRules().counterById.get(counterId) ?? fault(`Unknown counter "${counterId}"`);
    writeBounded(
      definition,
      work.counters[counterId] ?? definition.start,
      requested,
      null,
      (value) => {
        work.counters[counterId] = value;
      },
      (from, to) => {
        emit(
          { type: "counterChanged", counter: counterId, from, to },
          contextFor(null, from, to, to - from),
        );
      },
    );
  }

  function writeAttribute(unitId: string, attribute: string, requested: number): void {
    const unit = work.units[unitId] ?? fault(`Unknown unit "${unitId}"`);
    const definition =
      requireRules()
        .unitKindById.get(unit.kind)
        ?.attributes.find((candidate) => candidate.id === attribute) ??
      fault(`Unit kind "${unit.kind}" has no attribute "${attribute}"`);
    writeBounded(
      definition,
      unit.attributes[attribute] ?? definition.start,
      requested,
      unitId,
      (value) => {
        unit.attributes[attribute] = value;
      },
      (from, to) => {
        emit(
          { type: "attributeChanged", unit: unitId, kind: unit.kind, attribute, from, to },
          contextFor(unitId, from, to, to - from),
        );
      },
    );
  }

  function writeSpaceCounter(spaceId: string, counterId: string, requested: number): void {
    const definition =
      requireRules().spaceCounterById.get(counterId) ??
      fault(`Unknown space counter "${counterId}"`);
    const values = work.spaceCounters[spaceId] ?? fault(`Unknown space "${spaceId}"`);
    writeBounded(
      definition,
      values[counterId] ?? definition.start,
      requested,
      null,
      (value) => {
        values[counterId] = value;
      },
      (from, to) => {
        emit(
          { type: "spaceCounterChanged", space: spaceId, spaceCounter: counterId, from, to },
          contextFor(null, from, to, to - from),
        );
      },
    );
  }

  function resolvePlacement(placement: Placement, scope: ExpressionScope): UnitPlacement | null {
    if ("onSpace" in placement) {
      const space = resolveSpace(placement.onSpace, scope);
      return space === null ? null : { type: "space", space };
    }
    if ("inside" in placement) {
      const unit = resolveUnit(placement.inside, scope);
      return unit === null ? null : { type: "inside", unit };
    }
    return { type: "offMap" };
  }

  function setPlacement(unitId: string, placement: UnitPlacement): void {
    const unit = work.units[unitId] ?? fault(`Unknown unit "${unitId}"`);
    if (placement.type === "inside" && containsOrIs(work.units, unitId, placement.unit)) {
      fault(`Unit "${unitId}" cannot be placed inside itself`);
    }
    const fromSpace = spaceOfUnit(work.units, unitId);
    unit.placement = placement;
    const toSpace = spaceOfUnit(work.units, unitId);
    if (fromSpace !== toSpace) {
      emit(
        { type: "unitMoved", unit: unitId, kind: unit.kind, fromSpace, toSpace },
        contextFor(unitId),
      );
    }
  }

  function createUnit(
    effect: Extract<Effect, { type: "createUnit" }>,
    scope: ExpressionScope,
  ): void {
    const kind =
      requireRules().unitKindById.get(effect.kind) ?? fault(`Unknown unit kind "${effect.kind}"`);
    const placement = resolvePlacement(effect.placement, scope);
    if (placement === null) return;
    if (effect.id === null) work.unitSerial += 1;
    const unitId = effect.id ?? `${kind.id}#${work.unitSerial}`;
    if (work.units[unitId] !== undefined || work.retiredUnits.includes(unitId)) {
      fault(`Unit id "${unitId}" is already in use or retired`);
    }
    work.units[unitId] = {
      id: unitId,
      kind: kind.id,
      placement: { type: "offMap" },
      attributes: Object.fromEntries(
        kind.attributes.map((attribute) => [attribute.id, attribute.start]),
      ),
    };
    setPlacement(unitId, placement);
    emit({ type: "unitCreated", unit: unitId, kind: kind.id }, contextFor(unitId));
  }

  function removeUnit(unitId: string): void {
    const unit = work.units[unitId] ?? fault(`Unknown unit "${unitId}"`);
    for (const inner of Object.values(work.units)) {
      if (inner.placement.type === "inside" && inner.placement.unit === unitId) {
        inner.placement = unit.placement;
      }
    }
    const fromSpace = spaceOfUnit(work.units, unitId);
    delete work.units[unitId];
    work.retiredUnits.push(unitId);
    emit(
      { type: "unitRemoved", unit: unitId, kind: unit.kind, fromSpace },
      { ...contextFor(null), candidate: fromSpace },
    );
  }

  function changeKind(unitId: string, kindId: string): void {
    const unit = work.units[unitId] ?? fault(`Unknown unit "${unitId}"`);
    const kind = requireRules().unitKindById.get(kindId) ?? fault(`Unknown unit kind "${kindId}"`);
    if (unit.kind === kind.id) return;
    const previous = unit.kind;
    unit.attributes = Object.fromEntries(
      kind.attributes.map((attribute) => [
        attribute.id,
        unit.attributes[attribute.id] ?? attribute.start,
      ]),
    );
    unit.kind = kind.id;
    emit(
      { type: "unitKindChanged", unit: unitId, from: previous, to: kind.id },
      contextFor(unitId),
    );
  }

  function candidateUnits(units: UnitSet, context: ExpressionContext): string[] {
    const space = units.at === null ? null : resolveSpace(units.at, scopeOf(context));
    if (units.at !== null && space === null) return [];
    return Object.keys(work.units)
      .sort()
      .filter(
        (unitId) =>
          kindMatches(kindCountsAsOf(requireRules()), work.units[unitId]?.kind ?? "", units.kind) &&
          (space === null || spaceOfUnit(work.units, unitId) === space) &&
          evaluateBoolean(units.where, scopeOf({ ...context, self: unitId })),
      );
  }

  function compareKeys(left: readonly number[], right: readonly number[]): number {
    for (let index = 0; index < left.length; index++) {
      const difference = (left[index] ?? 0) - (right[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  /** Groups candidates by equal sort keys, best group first; `bind` gives each candidate's context. */
  function orderedGroups(
    candidates: readonly string[],
    order: Order,
    bind: (candidate: string) => ExpressionContext,
  ): string[][] {
    const keyed = candidates.map((candidate) => {
      const scope = scopeOf(bind(candidate));
      const keys = order.sortBy.map(({ key, direction }) => {
        const value = evaluateNumber(key, scope);
        return direction === "asc" ? value : -value;
      });
      return { candidate, keys };
    });
    keyed.sort((a, b) => compareKeys(a.keys, b.keys));
    const groups: string[][] = [];
    let previous: number[] | null = null;
    for (const { candidate, keys } of keyed) {
      const current = groups[groups.length - 1];
      if (current !== undefined && previous !== null && compareKeys(previous, keys) === 0) {
        current.push(candidate);
      } else {
        groups.push([candidate]);
      }
      previous = keys;
    }
    return groups;
  }

  function selectSpaces(
    effect: Extract<Effect, { type: "selectSpaces" }>,
    context: ExpressionContext,
  ): void {
    const bind = (space: string) => ({ ...context, candidate: space });
    const candidates = requireRules()
      .spaces.map((space) => space.id)
      .sort()
      .filter((space) => evaluateBoolean(effect.where, scopeOf(bind(space))));
    const chosen: string[] = [];
    let wanted = evaluateNumber(effect.count, scopeOf(context));
    for (const group of orderedGroups(candidates, effect.order, bind)) {
      const pool = [...group];
      while (wanted > 0 && pool.length > 0) {
        const index = effect.order.tieBreak === "random" ? randomIndex(pool.length) : 0;
        chosen.push(...pool.splice(index, 1));
        wanted -= 1;
      }
      if (wanted <= 0) break;
    }
    for (const space of [...chosen].reverse()) pushEffects(effect.effects, bind(space), null);
  }

  function randomIndex(size: number): number {
    if (size <= 1) return 0;
    const [drawn, rng] = nextInt(work.rng, size);
    work.rng = rng;
    return drawn;
  }

  function startSelect(
    units: UnitSet,
    order: Order,
    limit: number | null,
    effects: Effect[],
    context: ExpressionContext,
  ): void {
    if (limit !== null && limit <= 0) return;
    const groups = orderedGroups(candidateUnits(units, context), order, (unitId) => ({
      ...context,
      self: unitId,
    }));
    if (groups.length === 0) return;
    work.stack.push({
      kind: "select",
      groups,
      remaining: limit,
      tieBreak: order.tieBreak,
      effects,
      context,
    });
  }

  function takePick(frame: SelectFrame, unitId: string): void {
    const group = frame.groups[0] ?? fault("No units left to pick");
    if (!group.includes(unitId)) fault(`Unit "${unitId}" is not among the tied units`);
    frame.groups[0] = group.filter((candidate) => candidate !== unitId);
    if (frame.remaining !== null) frame.remaining -= 1;
    pushEffects(frame.effects, { ...frame.context, self: unitId }, null);
  }

  function runSelect(frame: SelectFrame): void {
    frame.groups = frame.groups
      .map((group) => group.filter((unitId) => work.units[unitId] !== undefined))
      .filter((group) => group.length > 0);
    const group = frame.groups[0];
    if (group === undefined || frame.remaining === 0) {
      work.stack.pop();
      return;
    }
    if (group.length > 1 && frame.tieBreak === "decision") {
      work.pending = { kind: "pickUnit", options: [...group], canPass: false };
      return;
    }
    const index = frame.tieBreak === "random" ? randomIndex(group.length) : 0;
    takePick(frame, group[index] ?? fault("Random pick out of range"));
  }

  function startDelivery(
    effect: Extract<Effect, { type: "deliver" }>,
    context: ExpressionContext,
  ): void {
    const type =
      requireRules().quantityTypeById.get(effect.quantity) ??
      fault(`Unknown quantity type "${effect.quantity}"`);
    if ("attribute" in type.target && effect.recipient === null) {
      fault(`Quantity type "${type.id}" needs a recipient unit`);
    }
    const scope = scopeOf(context);
    const recipient = effect.recipient === null ? null : resolveUnit(effect.recipient, scope);
    if (effect.recipient !== null && recipient === null) return;
    work.stack.push({
      kind: "deliver",
      quantity: type.id,
      amount: evaluateNumber(effect.amount, scope),
      recipient,
      applied: [],
      declined: [],
      offering: false,
      context,
    });
  }

  function deliveryContext(frame: DeliverFrame): ExpressionContext {
    return { ...frame.context, self: frame.recipient, amount: frame.amount };
  }

  function applyModifier(frame: DeliverFrame, modifier: Modifier): void {
    const context = deliveryContext(frame);
    const scope = scopeOf(context);
    const action = modifier.action;
    frame.applied.push(modifier.id);
    if ("prevent" in action) {
      frame.amount = 0;
    } else if ("reduce" in action) {
      frame.amount = Math.max(0, frame.amount - evaluateNumber(action.reduce, scope));
    } else if ("increase" in action) {
      frame.amount += evaluateNumber(action.increase, scope);
    } else if ("convertTo" in action) {
      if (!requireRules().quantityTypeById.has(action.convertTo)) {
        fault(`Unknown quantity type "${action.convertTo}"`);
      }
      frame.quantity = action.convertTo;
    } else {
      work.stack.pop();
      pushEffects(action.substitute, context, null);
    }
    pushEffects(modifier.onApply, context, null);
  }

  function completeDelivery(frame: DeliverFrame): void {
    work.stack.pop();
    const type =
      requireRules().quantityTypeById.get(frame.quantity) ??
      fault(`Unknown quantity type "${frame.quantity}"`);
    const delta = type.direction === "increase" ? frame.amount : -frame.amount;
    if ("counter" in type.target) {
      const counterId = type.target.counter;
      writeCounter(counterId, (work.counters[counterId] ?? 0) + delta);
    } else {
      const unitId = frame.recipient ?? fault(`Quantity type "${type.id}" needs a recipient unit`);
      const attribute = type.target.attribute;
      writeAttribute(unitId, attribute, (work.units[unitId]?.attributes[attribute] ?? 0) + delta);
    }
    emit(
      {
        type: "quantityDelivered",
        quantity: type.id,
        unit: frame.recipient,
        kind: frame.recipient === null ? null : (work.units[frame.recipient]?.kind ?? null),
        amount: frame.amount,
      },
      deliveryContext(frame),
    );
  }

  function runDeliver(frame: DeliverFrame): void {
    const recipientGone = frame.recipient !== null && work.units[frame.recipient] === undefined;
    if (frame.amount <= 0 || recipientGone) {
      work.stack.pop();
      return;
    }
    const scope = scopeOf(deliveryContext(frame));
    const applicable = requireRules()
      .modifiers.filter(
        (modifier) =>
          modifier.quantity === frame.quantity &&
          !frame.applied.includes(modifier.id) &&
          !frame.declined.includes(modifier.id) &&
          evaluateBoolean(modifier.condition, scope),
      )
      .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
    const first = applicable[0];
    if (first === undefined) {
      completeDelivery(frame);
      return;
    }
    const tier = applicable.filter((modifier) => modifier.priority === first.priority);
    const mandatory = tier.find((modifier) => !modifier.optional);
    if (mandatory !== undefined) {
      applyModifier(frame, mandatory);
      return;
    }
    frame.offering = true;
    work.pending = {
      kind: "chooseOption",
      options: tier.map((modifier) => ({
        id: modifier.id,
        label: modifier.id,
        cost: [],
        effects: [],
      })),
      canPass: true,
      context: deliveryContext(frame),
    };
  }

  function dieType(dieId: string): DieType {
    return requireRules().dieById.get(dieId) ?? fault(`Unknown die "${dieId}"`);
  }

  function rollFace(dieId: string): string {
    const faces = dieType(dieId).faces;
    const [index, rng] = nextInt(work.rng, faces.length);
    work.rng = rng;
    return faces[index]?.id ?? fault(`Die "${dieId}" rolled outside its faces`);
  }

  function poolDice(poolId: string): Die[] {
    return work.pools[poolId] ?? [];
  }

  function announceRoll(poolId: string): void {
    emit(
      { type: "diceRolled", pool: poolId, dice: poolDice(poolId).map((die) => ({ ...die })) },
      contextFor(null),
    );
  }

  function rollIntoPool(poolId: string, dieId: string, count: number, replace: boolean): void {
    dieType(dieId);
    const existing = replace ? [] : poolDice(poolId);
    const highest = existing.reduce((top, die) => Math.max(top, Number(die.id.slice(1))), 0);
    const added = Array.from({ length: Math.max(0, count) }, (_, offset) => ({
      id: `d${highest + offset + 1}`,
      die: dieId,
      face: rollFace(dieId),
      role: null,
    }));
    work.pools[poolId] = [...existing, ...added];
    announceRoll(poolId);
  }

  function showsFace(die: Die, faces: readonly string[] | null): boolean {
    return faces === null || faces.includes(die.face);
  }

  function rerollMarked(poolId: string, marked: readonly string[]): void {
    for (const die of poolDice(poolId)) {
      if (marked.includes(die.id)) die.face = rollFace(die.die);
    }
    if (marked.length > 0) announceRoll(poolId);
  }

  function startReroll(
    effect: Extract<Effect, { type: "rerollDice" }>,
    scope: ExpressionScope,
  ): void {
    if (effect.mode === "all") {
      const marked = poolDice(effect.pool)
        .filter((die) => showsFace(die, effect.faces))
        .map((die) => die.id);
      rerollMarked(effect.pool, marked);
      return;
    }
    work.stack.push({
      kind: "reroll",
      pool: effect.pool,
      faces: effect.faces,
      marked: [],
      max: effect.max === null ? null : evaluateNumber(effect.max, scope),
    });
  }

  function finishReroll(frame: RerollFrame): void {
    work.stack.pop();
    rerollMarked(frame.pool, frame.marked);
  }

  function runReroll(frame: RerollFrame): void {
    const eligible = poolDice(frame.pool).filter(
      (die) => showsFace(die, frame.faces) && !frame.marked.includes(die.id),
    );
    const capReached = frame.max !== null && frame.marked.length >= frame.max;
    if (eligible.length === 0 || capReached) {
      finishReroll(frame);
      return;
    }
    work.pending = {
      kind: "pickDie",
      pool: frame.pool,
      dice: eligible.map((die) => die.id),
      canPass: true,
    };
  }

  /** True when choosing among these dice cannot change the outcome. */
  function interchangeable(dice: readonly Die[]): boolean {
    const [first, ...rest] = dice;
    return (
      first !== undefined &&
      rest.every(
        (die) => die.die === first.die && die.face === first.face && die.role === first.role,
      )
    );
  }

  function runSetFace(frame: SetFaceFrame): void {
    const eligible = poolDice(frame.pool).filter((die) => showsFace(die, frame.faces));
    if (frame.remaining <= 0 || eligible.length === 0) {
      work.stack.pop();
      return;
    }
    const [first] = eligible;
    if (first !== undefined && interchangeable(eligible)) {
      pickDie(first.id);
      return;
    }
    work.pending = {
      kind: "pickDie",
      pool: frame.pool,
      dice: eligible.map((die) => die.id),
      canPass: false,
    };
  }

  function startAssign(effect: Extract<Effect, { type: "assignDice" }>, scope: ExpressionScope) {
    for (const die of poolDice(effect.pool)) die.role = null;
    work.stack.push({
      kind: "assign",
      pool: effect.pool,
      roles: effect.roles.map(({ role, count }) => ({
        role,
        remaining: evaluateNumber(count, scope),
      })),
    });
  }

  function runAssign(frame: AssignFrame): void {
    const role = frame.roles.find((candidate) => candidate.remaining > 0);
    const unassigned = poolDice(frame.pool).filter((die) => die.role === null);
    if (role === undefined || unassigned.length === 0) {
      work.stack.pop();
      return;
    }
    const [first] = unassigned;
    if (first !== undefined && interchangeable(unassigned)) {
      pickDie(first.id);
      return;
    }
    work.pending = {
      kind: "pickDie",
      pool: frame.pool,
      dice: unassigned.map((die) => die.id),
      canPass: false,
    };
  }

  function pickDie(dieId: string): void {
    const frame = topFrame();
    if (frame === undefined) fault("No dice choice is in progress");
    const pool = "pool" in frame ? poolDice(frame.pool) : [];
    const die = pool.find((candidate) => candidate.id === dieId) ?? fault(`Unknown die "${dieId}"`);
    if (frame.kind === "reroll") {
      frame.marked.push(die.id);
    } else if (frame.kind === "setFace") {
      if (!dieType(die.die).faces.some((face) => face.id === frame.toFace)) {
        fault(`Die "${die.die}" has no face "${frame.toFace}"`);
      }
      die.face = frame.toFace;
      frame.remaining -= 1;
    } else if (frame.kind === "assign") {
      const role =
        frame.roles.find((candidate) => candidate.remaining > 0) ?? fault("No role to fill");
      die.role = role.role;
      role.remaining -= 1;
    } else {
      fault("No dice choice is in progress");
    }
  }

  function lookup(effect: Extract<Effect, { type: "lookup" }>, context: ExpressionContext): void {
    const value = evaluateNumber(effect.value, scopeOf(context));
    const entry = effect.entries.find(
      (candidate) => candidate.min <= value && value <= candidate.max,
    );
    pushEffects(entry?.effects ?? effect.otherwise, context, null);
  }

  function drawFromTable(
    effect: Extract<Effect, { type: "randomTable" }>,
    context: ExpressionContext,
  ): void {
    const scope = scopeOf(context);
    const eligible = effect.entries
      .map((entry) => ({ entry, weight: evaluateNumber(entry.weight, scope) }))
      .filter(({ entry, weight }) => weight > 0 && evaluateBoolean(entry.when, scope));
    const total = eligible.reduce((sum, { weight }) => sum + weight, 0);
    if (total === 0) {
      pushEffects(effect.ifNone, context, null);
      return;
    }
    const [drawn, rng] = nextInt(work.rng, total);
    work.rng = rng;
    let remaining = drawn;
    for (const { entry, weight } of eligible) {
      if (remaining < weight) {
        pushEffects(entry.effects, context, null);
        return;
      }
      remaining -= weight;
    }
    fault("Random table draw fell outside its weights");
  }

  function costCounter(cost: Cost, context: ExpressionContext) {
    const scope = scopeOf(context);
    if ("counter" in cost) {
      const definition =
        requireRules().counterById.get(cost.counter) ?? fault(`Unknown counter "${cost.counter}"`);
      return {
        definition,
        value: work.counters[cost.counter] ?? definition.start,
        amount: evaluateNumber(cost.amount, scope),
        unit: null,
      };
    }
    if ("attribute" in cost) {
      const unit = resolveUnit(cost.of, scope);
      if (unit === null) return null;
      const kind = work.units[unit]?.kind ?? "";
      const definition =
        requireRules()
          .unitKindById.get(kind)
          ?.attributes.find((attribute) => attribute.id === cost.attribute) ??
        fault(`Unit kind "${kind}" has no attribute "${cost.attribute}"`);
      return {
        definition,
        value: work.units[unit]?.attributes[cost.attribute] ?? definition.start,
        amount: evaluateNumber(cost.amount, scope),
        unit,
      };
    }
    return null;
  }

  function isPayable(costs: readonly Cost[], context: ExpressionContext): boolean {
    return costs.every((cost) => {
      if ("discard" in cost) {
        const count = evaluateNumber(cost.discard.count, scopeOf(context));
        return zoneCards(cost.discard.from).length >= count;
      }
      const owed = costCounter(cost, context);
      if (owed === null) return false;
      const { definition, value, amount } = owed;
      const left = value - amount;
      return (
        (definition.min === null || left >= definition.min) &&
        (amount === 0 || left >= costFloor(cost, context))
      );
    });
  }

  function costFloor(cost: Cost, context: ExpressionContext): number {
    if (!("counter" in cost) || cost.floor === null) return -Infinity;
    return evaluateNumber(cost.floor, scopeOf(context));
  }

  function startPayment(costs: Cost[], context: ExpressionContext): void {
    if (costs.length === 0) return;
    work.stack.push({ kind: "pay", costs, index: 0, discarding: null, context });
  }

  function runPay(frame: PayFrame): void {
    if (frame.discarding !== null) {
      const cards = zoneCards(frame.discarding.from);
      if (frame.discarding.remaining > 0 && cards.length > 0) {
        work.pending = { kind: "pickCard", cards: [...cards], canPass: false };
        return;
      }
      frame.discarding = null;
    }
    const cost = frame.costs[frame.index];
    if (cost === undefined) {
      work.stack.pop();
      return;
    }
    frame.index += 1;
    if ("discard" in cost) {
      frame.discarding = {
        from: cost.discard.from,
        to: cost.discard.to,
        remaining: evaluateNumber(cost.discard.count, scopeOf(frame.context)),
      };
      return;
    }
    const owed = costCounter(cost, frame.context);
    if (owed === null) return;
    if (owed.unit === null) {
      writeCounter(owed.definition.id, owed.value - owed.amount);
    } else {
      writeAttribute(owed.unit, owed.definition.id, owed.value - owed.amount);
    }
  }

  function discardPicked(frame: PayFrame, card: string): void {
    const discarding = frame.discarding ?? fault("No discard is in progress");
    const source = zoneCards(discarding.from);
    if (!source.includes(card)) fault(`Card "${card}" is not in zone "${discarding.from}"`);
    work.zones[discarding.from] = source.filter((candidate) => candidate !== card);
    placeCards(discarding.to, [card], "top");
    cardsMovedEvent(discarding.from, discarding.to, [card]);
    discarding.remaining -= 1;
  }

  function changeEdges(
    edgeId: string,
    change: "added" | "removed" | "retargeted",
    edge: Edge | null,
  ) {
    if (change === "added") {
      if (work.edges[edgeId] !== undefined) fault(`Edge "${edgeId}" already exists`);
    } else if (work.edges[edgeId] === undefined) {
      fault(`Unknown edge "${edgeId}"`);
    }
    if (edge === null) {
      delete work.edges[edgeId];
    } else {
      work.edges[edgeId] = edge;
    }
    emit({ type: "edgeChanged", edge: edgeId, change }, contextFor(null));
  }

  function startMove(
    frame: Omit<MoveFrame, "kind" | "unit" | "remaining" | "insteadFrom">,
    unitRef: Parameters<typeof resolveUnit>[0],
    steps: number,
    scope: ExpressionScope,
  ): void {
    const unit = resolveUnit(unitRef, scope);
    if (unit === null || steps <= 0) return;
    work.stack.push({ kind: "move", unit, remaining: steps, insteadFrom: null, ...frame });
  }

  function payableEdge(
    frame: MoveFrame,
    here: string,
    next: string,
    traversable: Traversable,
  ): Edge | null {
    const context = { ...frame.context, self: frame.unit };
    return (
      edgesBetween(work.edges, here, next, traversable).find((edge) =>
        isPayable(edge.cost, context),
      ) ?? null
    );
  }

  function followerCandidates(
    frame: MoveFrame,
    left: string,
    arrived: string,
    followers: Followers,
  ): string[] {
    return Object.values(work.units)
      .filter(
        (unit) =>
          unit.id !== frame.unit &&
          spaceOfUnit(work.units, unit.id) === left &&
          kindMatches(kindCountsAsOf(requireRules()), unit.kind, followers.units.kind) &&
          evaluateBoolean(
            followers.units.where,
            scopeOf({ ...frame.context, self: unit.id, candidate: arrived }),
          ),
      )
      .map((unit) => unit.id)
      .sort();
  }

  function startFollowing(frame: MoveFrame, left: string, arrived: string): void {
    const followers = frame.followers;
    if (followers === null) return;
    const moverScope = scopeOf({ ...frame.context, self: frame.unit, candidate: arrived });
    if (!evaluateBoolean(followers.when, moverScope)) return;
    const remaining = evaluateNumber(followers.max, moverScope);
    const candidates = followerCandidates(frame, left, arrived, followers);
    if (remaining <= 0 || candidates.length === 0) return;
    work.stack.push({ kind: "follow", to: arrived, candidates, remaining });
  }

  function runFollow(frame: FollowFrame): void {
    frame.candidates = frame.candidates.filter((unit) => work.units[unit] !== undefined);
    if (frame.remaining <= 0 || frame.candidates.length === 0) {
      work.stack.pop();
      return;
    }
    work.pending = { kind: "pickUnit", options: [...frame.candidates], canPass: true };
  }

  function takeFollower(frame: FollowFrame, unit: string): void {
    if (!frame.candidates.includes(unit)) fault(`Unit "${unit}" cannot follow`);
    frame.candidates = frame.candidates.filter((candidate) => candidate !== unit);
    frame.remaining -= 1;
    setPlacement(unit, { type: "space", space: frame.to });
  }

  function takeStep(frame: MoveFrame, space: string, edge: Edge): void {
    const left = spaceOfUnit(work.units, frame.unit);
    const free = evaluateBoolean(
      frame.freeWhen,
      scopeOf({ ...frame.context, self: frame.unit, candidate: space }),
    );
    if (!free) frame.remaining -= 1;
    setPlacement(frame.unit, { type: "space", space });
    if (evaluateBoolean(frame.stopWhen, scopeOf({ ...frame.context, self: frame.unit }))) {
      frame.remaining = 0;
    }
    if (left !== null) startFollowing(frame, left, space);
    startPayment(edge.cost, { ...frame.context, self: frame.unit });
  }

  function chosenStep(frame: MoveFrame, space: string): void {
    const here =
      spaceOfUnit(work.units, frame.unit) ?? fault(`Unit "${frame.unit}" is off the map`);
    const traversable = traversableFor(
      frame.filter,
      scopeOf({ ...frame.context, self: frame.unit }),
    );
    const edge =
      payableEdge(frame, here, space, traversable) ??
      fault(`No payable edge leads from "${here}" to "${space}"`);
    takeStep(frame, space, edge);
  }

  function runMove(frame: MoveFrame): void {
    const here = work.units[frame.unit] === undefined ? null : spaceOfUnit(work.units, frame.unit);
    if (frame.insteadFrom !== null) {
      const left = frame.insteadFrom;
      frame.insteadFrom = null;
      if (here !== null && here !== left) {
        startFollowing(frame, left, here);
        return;
      }
    }
    const scope = scopeOf({ ...frame.context, self: frame.unit });
    if (frame.remaining <= 0 || here === null || evaluateBoolean(frame.stopWhen, scope)) {
      work.stack.pop();
      return;
    }
    if (frame.instead !== null && evaluateBoolean(frame.instead.when, scope)) {
      frame.remaining -= 1;
      frame.insteadFrom = here;
      pushEffects(frame.instead.effects, { ...frame.context, self: frame.unit }, null);
      return;
    }
    const traversable = traversableFor(frame.filter, scope);
    if (frame.mode === "choose" || frame.mode === "forced") {
      const options = neighbours(work.edges, here, traversable).filter(
        (space) => payableEdge(frame, here, space, traversable) !== null,
      );
      const [only] = options;
      if (only === undefined) {
        work.stack.pop();
        return;
      }
      if (frame.mode === "forced" && options.length === 1) {
        chosenStep(frame, only);
        return;
      }
      work.pending = {
        kind: "moveUnit",
        unit: frame.unit,
        options,
        canPass: frame.mode === "choose",
      };
      return;
    }
    const target = frame.target === null ? null : resolveSpace(frame.target, scope);
    const towardTarget = target === null ? null : distancesTo(work.edges, target, traversable);
    const distance = towardTarget?.get(here);
    const closer =
      distance === undefined || distance === 0
        ? []
        : neighbours(work.edges, here, traversable).filter(
            (space) =>
              towardTarget?.get(space) === distance - 1 &&
              payableEdge(frame, here, space, traversable) !== null,
          );
    const order = frame.order ?? fault("Automatic movement needs an order");
    const best = orderedGroups(closer, order, (space) => ({
      ...frame.context,
      self: frame.unit,
      candidate: space,
    }))[0];
    if (best === undefined) {
      work.stack.pop();
      return;
    }
    if (best.length > 1 && order.tieBreak === "decision") {
      work.pending = { kind: "moveUnit", unit: frame.unit, options: best, canPass: false };
      return;
    }
    const next = best[order.tieBreak === "random" ? randomIndex(best.length) : 0];
    chosenStep(frame, next ?? fault("No next step to take"));
  }

  function revealCardPart(zoneId: string, partId: string): void {
    const [top] = zoneCards(zoneId);
    if (top === undefined) return;
    const part = cardDefinition(top).parts.find((candidate) => candidate.id === partId);
    const revealed = work.revealedParts[top] ?? [];
    if (part === undefined || revealed.some((entry) => entry.part === partId)) return;
    work.revealedParts[top] = [...revealed, { part: part.id, text: part.text }];
    pushEffects(part.effects, cardContext(top), null);
  }

  function resolveTopCard(effect: Extract<Effect, { type: "resolveCard" }>): void {
    const [top] = zoneCards(effect.zone);
    if (top === undefined) {
      pushEffects(effect.ifEmpty, EMPTY_CONTEXT, null);
      return;
    }
    if (effect.to !== null) moveTopCards(effect.zone, effect.to, 1, "top");
    const lyingIn = effect.to ?? effect.zone;
    const zone =
      requireRules().zones.find((candidate) => candidate.id === lyingIn) ??
      fault(`Unknown zone "${lyingIn}"`);
    emit({ type: "cardResolved", card: top }, EMPTY_CONTEXT);
    if (work.faceUp[top] === true) pushEffects(cardDefinition(top).effects, cardContext(top), null);
    else pushEffects(zone.backEffects, EMPTY_CONTEXT, null);
  }

  function placeCards(zoneId: string, cards: readonly string[], position: CardPosition): void {
    const existing = zoneCards(zoneId);
    work.zones[zoneId] = position === "top" ? [...cards, ...existing] : [...existing, ...cards];
    const faceUp = requireRules().zones.find((zone) => zone.id === zoneId)?.face !== "down";
    for (const card of cards) setCardFace(card, faceUp);
  }

  function mintHandle(card: string): void {
    work.handleSerial += 1;
    work.handles[card] = `h${work.handleSerial}`;
  }

  function setCardFace(card: string, faceUp: boolean): void {
    const wasFaceUp = work.faceUp[card] === true;
    work.faceUp[card] = faceUp;
    if (faceUp) {
      delete work.handles[card];
      return;
    }
    if (wasFaceUp) work.known[card] = true;
    if (wasFaceUp || work.handles[card] === undefined) mintHandle(card);
  }

  function topCards(zoneId: string, count: number): string[] {
    return zoneCards(zoneId).slice(0, Math.max(0, count));
  }

  function peek(zoneId: string, count: number): void {
    for (const card of topCards(zoneId, count)) work.known[card] = true;
  }

  function turnCards(zoneId: string, count: number, faceUp: boolean): void {
    for (const card of topCards(zoneId, count)) setCardFace(card, faceUp);
  }

  function cardsMovedEvent(from: string | null, to: string, cards: string[]): void {
    emit({ type: "cardsMoved", from, to, cards }, contextFor(null, 0, 0, cards.length));
  }

  function moveTopCards(from: string, to: string, count: number, position: CardPosition): void {
    const source = zoneCards(from);
    const moving = source.slice(0, Math.max(0, count));
    if (moving.length === 0) return;
    work.zones[from] = source.slice(moving.length);
    placeCards(to, moving, position);
    cardsMovedEvent(from, to, moving);
  }

  function createCards(cardId: string, zoneId: string): void {
    const definition = requireRules().cardById.get(cardId) ?? fault(`Unknown card "${cardId}"`);
    const serial = work.cardSerials[cardId] ?? 0;
    const created = Array.from(
      { length: definition.copies },
      (_, offset) => `${cardId}:${serial + offset + 1}`,
    );
    work.cardSerials[cardId] = serial + definition.copies;
    if (definition.counters.length > 0) {
      for (const card of created) {
        work.cardCounters[card] = Object.fromEntries(
          definition.counters.map((counter) => [counter.id, counter.start]),
        );
      }
    }
    placeCards(zoneId, created, "bottom");
    cardsMovedEvent(null, zoneId, created);
  }

  function shuffleZone(zoneId: string): void {
    const [shuffled, rng] = shuffle(work.rng, zoneCards(zoneId));
    work.zones[zoneId] = shuffled;
    work.rng = rng;
    for (const card of shuffled) {
      if (work.faceUp[card] === true) continue;
      delete work.known[card];
      delete work.revealedParts[card];
      mintHandle(card);
    }
  }

  function offerChoice(effect: Extract<Effect, { type: "choose" }>, context: ExpressionContext) {
    const scope = scopeOf(context);
    const options = effect.options.filter(
      (option) => evaluateBoolean(option.when, scope) && isPayable(option.cost, context),
    );
    if (options.length === 0) return;
    work.pending = {
      kind: "chooseOption",
      options: options.map(({ id, label, cost, effects }) => ({ id, label, cost, effects })),
      canPass: effect.optional,
      context,
    };
  }

  function endScope(scope: Scope): void {
    let targetIndex = -1;
    work.stack.forEach((frame, index) => {
      if (frame.kind === "scope" && frame.scope === scope) targetIndex = index;
    });
    const target = work.stack[targetIndex];
    if (target?.kind !== "scope") return;
    const innerScopes = work.stack
      .slice(targetIndex + 1)
      .filter((frame): frame is ScopeFrame => frame.kind === "scope" && frame.status !== "enter");
    for (const frame of [target, ...innerScopes]) {
      if (frame.status !== "closing") frame.status = "exit";
    }
    work.stack = [...work.stack.slice(0, targetIndex + 1), ...innerScopes];
  }

  function beginEnd(endConditionId: string): void {
    const end =
      requireRules().endConditionById.get(endConditionId) ??
      fault(`Unknown end condition "${endConditionId}"`);
    work.pending = null;
    work.stack = [{ kind: "finish", endCondition: end.id }];
    pushEffects(end.sequence, EMPTY_CONTEXT, null);
  }

  function resolveOutcome(rule: OutcomeRule): Outcome {
    if (typeof rule === "string") return rule;
    return evaluateBoolean(rule.when, scopeOf(EMPTY_CONTEXT)) ? rule.then : rule.else;
  }

  function finish(frame: FinishFrame): void {
    const end =
      requireRules().endConditionById.get(frame.endCondition) ??
      fault(`Unknown end condition "${frame.endCondition}"`);
    const result = resolveOutcome(end.outcome);
    work.status = "finished";
    work.outcome = { result, endCondition: end.id };
    work.stack = [];
    work.pending = null;
    events.push({ type: "gameFinished", outcome: result, endCondition: end.id });
  }

  function executeEffect(effect: Effect, context: ExpressionContext): void {
    const scope = scopeOf(context);
    switch (effect.type) {
      case "changeCounter": {
        const current = work.counters[effect.counter] ?? 0;
        writeCounter(effect.counter, current + evaluateNumber(effect.amount, scope));
        return;
      }
      case "setCounter":
        writeCounter(effect.counter, evaluateNumber(effect.value, scope));
        return;
      case "moveCards":
        moveTopCards(effect.from, effect.to, evaluateNumber(effect.count, scope), effect.position);
        return;
      case "createCards":
        createCards(effect.card, effect.zone);
        return;
      case "shuffle":
        shuffleZone(effect.zone);
        return;
      case "peek":
        peek(effect.zone, evaluateNumber(effect.count, scope));
        return;
      case "turnCards":
        turnCards(effect.zone, evaluateNumber(effect.count, scope), effect.face === "up");
        return;
      case "if":
        pushEffects(
          evaluateBoolean(effect.condition, scope) ? effect.then : effect.else,
          context,
          null,
        );
        return;
      case "choose":
        offerChoice(effect, context);
        return;
      case "playWindow":
        work.stack.push({
          kind: "playWindow",
          play: effect.play,
          discard: effect.discard,
          buy: effect.buy,
          abilitiesFrom: effect.abilitiesFrom,
          repeat: effect.repeat,
          until: effect.until,
        });
        return;
      case "resolveCard":
        resolveTopCard(effect);
        return;
      case "revealCardPart":
        revealCardPart(effect.zone, effect.part);
        return;
      case "endScope":
        endScope(effect.scope);
        return;
      case "endGame":
        beginEnd(effect.endCondition);
        return;
      case "createUnit":
        createUnit(effect, scope);
        return;
      case "removeUnit": {
        const unit = resolveUnit(effect.unit, scope);
        if (unit !== null) removeUnit(unit);
        return;
      }
      case "changeKind": {
        const unit = resolveUnit(effect.unit, scope);
        if (unit !== null) changeKind(unit, effect.kind);
        return;
      }
      case "placeUnit": {
        const unit = resolveUnit(effect.unit, scope);
        const placement = resolvePlacement(effect.placement, scope);
        if (unit !== null && placement !== null) setPlacement(unit, placement);
        return;
      }
      case "moveToward":
        startMove(
          {
            filter: effect.filter,
            mode: "toward",
            target: effect.target,
            stopWhen: effect.stopWhen,
            freeWhen: effect.freeWhen,
            instead: null,
            order: effect.order,
            followers: effect.followers,
            context,
          },
          effect.unit,
          evaluateNumber(effect.steps, scope),
          scope,
        );
        return;
      case "stepMove":
        startMove(
          {
            filter: effect.filter,
            mode: effect.forced ? "forced" : "choose",
            target: null,
            stopWhen: effect.stopWhen,
            freeWhen: effect.freeWhen,
            instead: effect.instead,
            order: null,
            followers: effect.followers,
            context,
          },
          effect.unit,
          evaluateNumber(effect.steps, scope),
          scope,
        );
        return;
      case "changeAttribute":
      case "setAttribute": {
        const unit = resolveUnit(effect.unit, scope);
        if (unit === null) return;
        const current = work.units[unit]?.attributes[effect.attribute] ?? 0;
        writeAttribute(
          unit,
          effect.attribute,
          effect.type === "changeAttribute"
            ? current + evaluateNumber(effect.amount, scope)
            : evaluateNumber(effect.value, scope),
        );
        return;
      }
      case "changeSpaceCounter":
      case "setSpaceCounter": {
        const space = resolveSpace(effect.at, scope);
        if (space === null) return;
        const current = work.spaceCounters[space]?.[effect.spaceCounter] ?? 0;
        writeSpaceCounter(
          space,
          effect.spaceCounter,
          effect.type === "changeSpaceCounter"
            ? current + evaluateNumber(effect.amount, scope)
            : evaluateNumber(effect.value, scope),
        );
        return;
      }
      case "forEachUnit":
        startSelect(effect.units, effect.order, null, effect.effects, context);
        return;
      case "selectSpaces":
        selectSpaces(effect, context);
        return;
      case "selectUnits":
        startSelect(
          effect.units,
          effect.order,
          evaluateNumber(effect.count, scope),
          effect.effects,
          context,
        );
        return;
      case "deliver":
        startDelivery(effect, context);
        return;
      case "rollDice":
      case "addDice":
        rollIntoPool(
          effect.pool,
          effect.die,
          evaluateNumber(effect.count, scope),
          effect.type === "rollDice",
        );
        return;
      case "rerollDice":
        startReroll(effect, scope);
        return;
      case "setDieFace":
        work.stack.push({
          kind: "setFace",
          pool: effect.pool,
          faces: effect.faces,
          toFace: effect.toFace,
          remaining: evaluateNumber(effect.count, scope),
        });
        return;
      case "assignDice":
        startAssign(effect, scope);
        return;
      case "lookup":
        lookup(effect, context);
        return;
      case "randomTable":
        drawFromTable(effect, context);
        return;
      case "addEdge":
        changeEdges(effect.edge.id, "added", effect.edge);
        return;
      case "removeEdge":
        changeEdges(effect.edge, "removed", null);
        return;
      case "retargetEdge": {
        const edge = work.edges[effect.edge] ?? fault(`Unknown edge "${effect.edge}"`);
        changeEdges(effect.edge, "retargeted", { ...edge, toSpace: effect.toSpace });
        return;
      }
      case "changeCardCounter": {
        const card = context.card;
        if (card !== null)
          changeCardCounter(card, effect.cardCounter, evaluateNumber(effect.amount, scope));
        return;
      }
      case "moveThisCard": {
        const card = context.card;
        const from = card === null ? null : zoneHolding(card);
        if (card !== null && from !== null) moveOneCard(card, from, effect.to, effect.position);
        return;
      }
      case "pickCards":
        work.stack.push({
          kind: "pick",
          from: effect.from,
          to: effect.to,
          remaining: evaluateNumber(effect.count, scope),
          cards: effect.cards,
          optional: effect.optional,
          position: effect.position,
        });
        return;
      case "forEachCard": {
        const cards = zoneCards(effect.zone).filter(
          (card) => work.faceUp[card] === true && passesFilter(card, effect.cards),
        );
        for (const card of [...cards].reverse()) {
          pushEffects(effect.effects, { ...context, card }, null);
        }
        return;
      }
      case "call": {
        const procedure =
          requireRules().procedureById.get(effect.procedure) ??
          fault(`Unknown procedure "${effect.procedure}"`);
        const args = Object.fromEntries(
          Object.entries(effect.args).map(([name, value]) => [name, evaluateNumber(value, scope)]),
        );
        pushEffects(procedure.effects, { ...context, args }, null);
        return;
      }
      default:
        assertNever(effect);
    }
  }

  function hooksOf(frame: ScopeFrame): ScopeHooks {
    switch (frame.scope) {
      case "round":
        return requireRules().round;
      case "phase":
        return requireRules().phaseById.get(frame.id) ?? fault(`Unknown phase "${frame.id}"`);
      case "step":
        return NO_HOOKS;
      default:
        return assertNever(frame.scope);
    }
  }

  function childIds(frame: ScopeFrame): string[] {
    if (frame.scope === "round") return requireRules().phases.map((phase) => phase.id);
    const phase = requireRules().phaseById.get(frame.id) ?? fault(`Unknown phase "${frame.id}"`);
    return phase.steps.map((step) => step.id);
  }

  function stepEffects(frame: ScopeFrame): Effect[] {
    const phase =
      requireRules().phaseById.get(frame.phaseId ?? "") ??
      fault(`Unknown phase "${frame.phaseId ?? ""}"`);
    const step =
      phase.steps.find((candidate) => candidate.id === frame.id) ??
      fault(`Unknown step "${frame.id}"`);
    return step.effects;
  }

  function advanceScopeBody(frame: ScopeFrame): void {
    if (frame.scope === "step") {
      if (frame.child === 0) {
        frame.child = 1;
        pushEffects(stepEffects(frame), EMPTY_CONTEXT, null);
      } else {
        frame.status = "exit";
      }
      return;
    }
    const childId = childIds(frame)[frame.child];
    if (childId === undefined) {
      frame.status = "exit";
      return;
    }
    frame.child += 1;
    work.stack.push({
      kind: "scope",
      scope: frame.scope === "round" ? "phase" : "step",
      id: childId,
      phaseId: frame.scope === "phase" ? frame.id : null,
      child: 0,
      status: "enter",
    });
  }

  function resetCounters(scope: Scope): void {
    for (const counter of requireRules().counters) {
      if (counter.resetScope === scope && work.counters[counter.id] !== counter.start) {
        writeCounter(counter.id, counter.start);
      }
    }
  }

  function runScope(frame: ScopeFrame): void {
    switch (frame.status) {
      case "enter":
        frame.status = "body";
        emit({ type: "scopeEntered", scope: frame.scope, id: frame.id }, EMPTY_CONTEXT);
        pushEffects(hooksOf(frame).onEnter, EMPTY_CONTEXT, null);
        return;
      case "body":
        advanceScopeBody(frame);
        return;
      case "exit":
        frame.status = "closing";
        pushEffects(hooksOf(frame).onExit, EMPTY_CONTEXT, null);
        return;
      case "closing":
        work.stack.pop();
        resetCounters(frame.scope);
        clearAbilityUses(frame.scope);
        emit({ type: "scopeExited", scope: frame.scope, id: frame.id }, EMPTY_CONTEXT);
        return;
      default:
        assertNever(frame.status);
    }
  }

  function passesFilter(card: string, filter: CardFilter): boolean {
    const tags = cardDefinition(card).tags;
    return (
      filter.requireTags.every((tag) => tags.includes(tag)) &&
      !filter.excludeTags.some((tag) => tags.includes(tag))
    );
  }

  function abilityKey(card: string, ability: string): string {
    return `${card}/${ability}`;
  }

  function hasUsesLeft(card: string, ability: Ability): boolean {
    return (
      ability.limit === null ||
      (work.abilityUses[abilityKey(card, ability.id)] ?? 0) < ability.limit.uses
    );
  }

  function abilityOffers(zones: readonly string[]): AbilityOffer[] {
    return zones.flatMap((zone) =>
      zoneCards(zone)
        .filter((card) => work.faceUp[card] === true)
        .flatMap((card) => {
          const context = cardContext(card);
          const scope = scopeOf(context);
          return cardDefinition(card)
            .abilities.filter(
              (ability) =>
                hasUsesLeft(card, ability) &&
                evaluateBoolean(ability.when, scope) &&
                isPayable(ability.cost, context),
            )
            .map((ability) => ({ card, ability: ability.id }));
        }),
    );
  }

  function openPlayWindow(frame: PlayWindowFrame): void {
    if (evaluateBoolean(frame.until, scopeOf(EMPTY_CONTEXT))) {
      work.stack.pop();
      return;
    }
    const discard = frame.discard === null ? [] : [...zoneCards(frame.discard.from)];
    work.pending = {
      kind: "window",
      play: playOffers(frame.play),
      discard,
      buy: buyOffers(frame.buy),
      buyFrom: frame.buy?.from ?? null,
      buyFree: frame.buy?.free ?? false,
      abilities: abilityOffers(frame.abilitiesFrom),
    };
  }

  function playOffers(play: WindowPlay | null): string[] {
    if (play === null) return [];
    return zoneCards(play.from).filter((card) => {
      const definition = cardDefinition(card);
      const context = cardContext(card);
      return (
        passesFilter(card, play.cards) &&
        evaluateBoolean(definition.playable, scopeOf(context)) &&
        isPayable(definition.cost, context)
      );
    });
  }

  function buyOffers(buy: WindowBuy | null): string[] {
    if (buy === null || !evaluateBoolean(buy.when, scopeOf(EMPTY_CONTEXT))) return [];
    return zoneCards(buy.from).filter(
      (card) =>
        passesFilter(card, buy.cards) &&
        (buy.free || isPayable(cardDefinition(card).buyCost, EMPTY_CONTEXT)),
    );
  }

  function runEffectsFrame(frame: EffectsFrame): void {
    const effect = frame.effects[frame.index];
    if (effect === undefined) {
      work.stack.pop();
      return;
    }
    frame.index += 1;
    executeEffect(effect, frame.context);
  }

  function runFrame(frame: Frame): void {
    switch (frame.kind) {
      case "effects":
        runEffectsFrame(frame);
        return;
      case "scope":
        runScope(frame);
        return;
      case "playWindow":
        openPlayWindow(frame);
        return;
      case "finish":
        finish(frame);
        return;
      case "move":
        runMove(frame);
        return;
      case "follow":
        runFollow(frame);
        return;
      case "select":
        runSelect(frame);
        return;
      case "deliver":
        runDeliver(frame);
        return;
      case "pay":
        runPay(frame);
        return;
      case "reroll":
        runReroll(frame);
        return;
      case "setFace":
        runSetFace(frame);
        return;
      case "assign":
        runAssign(frame);
        return;
      case "pick":
        runPick(frame);
        return;
      default:
        assertNever(frame);
    }
  }

  function runStateChecks(): boolean {
    if (rules === null || work.stage !== "rounds") return false;
    if (work.stack.some((frame) => frame.kind === "finish")) return false;
    const scope = scopeOf(EMPTY_CONTEXT);
    const checkResolving = work.stack.some(
      (frame) => frame.kind === "effects" && frame.source?.startsWith(CHECK_SOURCE_PREFIX),
    );
    if (!checkResolving) {
      for (const check of rules.checks) {
        if (
          evaluateBoolean(check.condition, scope) &&
          pushEffects(check.effects, EMPTY_CONTEXT, `${CHECK_SOURCE_PREFIX}${check.id}`)
        ) {
          return true;
        }
      }
    }
    const end = rules.endConditions.find((candidate) =>
      evaluateBoolean(candidate.condition, scope),
    );
    if (end === undefined) return false;
    beginEnd(end.id);
    return true;
  }

  function startSetup(): void {
    const composed = loadRules();
    rules = composed;
    work.counters = Object.fromEntries(
      composed.counters.map((counter) => [counter.id, counter.start]),
    );
    work.zones = Object.fromEntries(composed.zones.map((zone) => [zone.id, [] as string[]]));
    work.units = {};
    work.edges = Object.fromEntries(composed.edges.map((edge) => [edge.id, edge]));
    work.spaceCounters = Object.fromEntries(
      composed.spaces.map((space) => [
        space.id,
        Object.fromEntries(composed.spaceCounters.map((counter) => [counter.id, counter.start])),
      ]),
    );
    work.stage = "setup";
    pushEffects(composed.setupEnd, EMPTY_CONTEXT, null);
    pushEffects(composed.setup, EMPTY_CONTEXT, null);
  }

  function advanceChoices(): void {
    const choice = pack.choices[work.choiceIndex];
    if (choice === undefined) {
      startSetup();
      return;
    }
    const offered = offeredModules(pack, choice);
    const remaining = offered.filter((moduleId) => !work.modules.includes(moduleId));
    const picked = offered.length - remaining.length;
    if (picked >= choice.max || remaining.length === 0) {
      work.choiceIndex += 1;
      return;
    }
    const decision: Decision = {
      kind: "pickModule",
      choice: choice.id,
      options: remaining,
      canPass: picked >= choice.min,
    };
    work.pending = decision;
  }

  function advanceStage(): void {
    switch (work.stage) {
      case "choices":
        advanceChoices();
        return;
      case "setup":
        work.stage = "rounds";
        return;
      case "rounds":
        work.round += 1;
        work.stack.push({
          kind: "scope",
          scope: "round",
          id: "round",
          phaseId: null,
          child: 0,
          status: "enter",
        });
        return;
      default:
        assertNever(work.stage);
    }
  }

  function moveOneCard(
    card: string,
    from: string,
    to: string,
    position: CardPosition = "top",
  ): void {
    const source = zoneCards(from);
    if (!source.includes(card)) fault(`Card "${card}" is not in zone "${from}"`);
    work.zones[from] = source.filter((candidate) => candidate !== card);
    placeCards(to, [card], position);
    cardsMovedEvent(from, to, [card]);
  }

  function zoneHolding(card: string): string | null {
    return Object.keys(work.zones).find((zone) => work.zones[zone]?.includes(card)) ?? null;
  }

  function pickableCards(frame: PickFrame): string[] {
    return zoneCards(frame.from).filter(
      (card) => work.faceUp[card] === true && passesFilter(card, frame.cards),
    );
  }

  function runPick(frame: PickFrame): void {
    const cards = frame.remaining > 0 ? pickableCards(frame) : [];
    if (cards.length === 0) {
      work.stack.pop();
      return;
    }
    work.pending = { kind: "pickCard", cards, canPass: frame.optional };
  }

  function takePickedCard(frame: PickFrame, card: string): void {
    if (!pickableCards(frame).includes(card)) fault(`Card "${card}" cannot be picked`);
    moveOneCard(card, frame.from, frame.to, frame.position);
    frame.remaining -= 1;
  }

  function changeCardCounter(card: string, counterId: string, amount: number): void {
    const definition =
      cardDefinition(card).counters.find((counter) => counter.id === counterId) ??
      fault(`Card "${card}" has no counter "${counterId}"`);
    const from = work.cardCounters[card]?.[counterId] ?? definition.start;
    const to = Math.min(
      definition.max ?? Infinity,
      Math.max(definition.min ?? -Infinity, from + amount),
    );
    if (to === from) return;
    work.cardCounters[card] = { ...work.cardCounters[card], [counterId]: to };
    emit({ type: "cardCounterChanged", card, counter: counterId, from, to }, cardContext(card));
  }

  function playCard(window: PlayWindowFrame, card: string): void {
    const play = window.play ?? fault("This window offers no plays");
    moveOneCard(card, play.from, play.to);
    const definition = cardDefinition(card);
    pushEffects(definition.effects, cardContext(card), null);
    startPayment(definition.cost, cardContext(card));
  }

  function buyCard(window: PlayWindowFrame, card: string): void {
    const buy = window.buy ?? fault("This window offers no purchases");
    moveOneCard(card, buy.from, buy.to);
    emit({ type: "cardBought", card }, EMPTY_CONTEXT);
    if (!buy.free) startPayment(cardDefinition(card).buyCost, EMPTY_CONTEXT);
  }

  function discardCard(window: PlayWindowFrame, card: string): void {
    const discard = window.discard ?? fault("This window offers no discard");
    moveOneCard(card, discard.from, discard.to);
    pushEffects(discard.effects, EMPTY_CONTEXT, null);
  }

  function useAbility(card: string, abilityId: string): void {
    const ability =
      cardDefinition(card).abilities.find((candidate) => candidate.id === abilityId) ??
      fault(`Card "${card}" has no ability "${abilityId}"`);
    const key = abilityKey(card, abilityId);
    if (ability.limit !== null) work.abilityUses[key] = (work.abilityUses[key] ?? 0) + 1;
    emit({ type: "abilityUsed", card, ability: abilityId }, EMPTY_CONTEXT);
    pushEffects(ability.effects, cardContext(card), null);
    startPayment(ability.cost, cardContext(card));
  }

  function openWindow(): PlayWindowFrame {
    const window = topFrame();
    if (window?.kind !== "playWindow") fault("No play window is open");
    if (!window.repeat) work.stack.pop();
    return window;
  }

  function limitScopeOf(key: string): Scope | "game" | null {
    const [card = "", abilityId] = key.split("/");
    const ability = cardDefinition(card).abilities.find((candidate) => candidate.id === abilityId);
    return ability?.limit?.per ?? null;
  }

  function clearAbilityUses(scope: Scope): void {
    work.abilityUses = Object.fromEntries(
      Object.entries(work.abilityUses).filter(([key]) => limitScopeOf(key) !== scope),
    );
  }

  function topFrame(): Frame | undefined {
    return work.stack[work.stack.length - 1];
  }

  function offeringDelivery(): DeliverFrame | null {
    const frame = topFrame();
    return frame?.kind === "deliver" && frame.offering ? frame : null;
  }

  function apply(action: Action): void {
    const pending = work.pending ?? fault("No decision is pending");
    work.pending = null;
    switch (action.type) {
      case "pickModule":
        work.modules.push(action.module);
        emit({ type: "moduleChosen", module: action.module }, EMPTY_CONTEXT);
        return;
      case "pass": {
        if (pending.kind === "pickModule") work.choiceIndex += 1;
        if (pending.kind === "window" || pending.kind === "moveUnit") work.stack.pop();
        if (pending.kind === "pickUnit" && topFrame()?.kind === "follow") work.stack.pop();
        if (pending.kind === "pickCard" && topFrame()?.kind === "pick") work.stack.pop();
        const rerolling = topFrame();
        if (pending.kind === "pickDie" && rerolling?.kind === "reroll") finishReroll(rerolling);
        const delivery = offeringDelivery();
        if (pending.kind === "chooseOption" && delivery !== null) {
          delivery.offering = false;
          delivery.declined.push(...pending.options.map((option) => option.id));
        }
        return;
      }
      case "chooseOption": {
        if (pending.kind !== "chooseOption") fault("No option choice is pending");
        const option =
          pending.options.find((candidate) => candidate.id === action.option) ??
          fault(`Unknown option "${action.option}"`);
        const delivery = offeringDelivery();
        if (delivery !== null) {
          delivery.offering = false;
          const modifier =
            requireRules().modifiers.find((candidate) => candidate.id === option.id) ??
            fault(`Unknown modifier "${option.id}"`);
          applyModifier(delivery, modifier);
          return;
        }
        pushEffects(option.effects, pending.context, null);
        startPayment(option.cost, pending.context);
        return;
      }
      case "pickUnit": {
        const frame = topFrame();
        if (frame?.kind === "follow") {
          takeFollower(frame, action.unit);
          return;
        }
        if (frame?.kind !== "select") fault("No unit selection is in progress");
        takePick(frame, action.unit);
        return;
      }
      case "pickDie":
        pickDie(action.die);
        return;
      case "pickCard": {
        const frame = topFrame();
        if (frame?.kind === "pick") {
          takePickedCard(frame, action.card);
          return;
        }
        if (frame?.kind !== "pay") fault("No discard is in progress");
        discardPicked(frame, action.card);
        return;
      }
      case "playCard":
        playCard(openWindow(), action.card);
        return;
      case "discardCard":
        discardCard(openWindow(), action.card);
        return;
      case "buyCard":
        buyCard(openWindow(), action.card);
        return;
      case "useAbility":
        openWindow();
        useAbility(action.card, action.ability);
        return;
      case "moveTo": {
        const frame = work.stack[work.stack.length - 1];
        if (frame?.kind !== "move") fault("No movement is in progress");
        chosenStep(frame, action.space);
        return;
      }
      default:
        assertNever(action);
    }
  }

  function run(): void {
    while (work.status === "awaitingDecision" && work.pending === null) {
      operations += 1;
      if (operations > MAX_OPERATIONS_PER_CALL) {
        fault("Resolution did not settle within the operation limit");
      }
      if (runStateChecks()) continue;
      const frame = work.stack[work.stack.length - 1];
      if (frame === undefined) {
        advanceStage();
      } else {
        runFrame(frame);
      }
    }
  }

  return { apply, run };
}
