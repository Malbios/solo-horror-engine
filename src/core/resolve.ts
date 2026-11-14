import type { Rules } from "./compose";
import {
  EMPTY_CONTEXT,
  EMPTY_WORLD,
  evaluateBoolean,
  evaluateNumber,
  resolveSpace,
  resolveUnit,
  traversableFor,
  type ExpressionContext,
  type ExpressionScope,
  type World,
} from "./expressions";
import { containsOrIs, distancesTo, neighbours, spaceOfUnit, type UnitPlacement } from "./graph";
import type {
  Action,
  Decision,
  EffectsFrame,
  FinishFrame,
  Frame,
  GameEvent,
  GameState,
  MoveFrame,
  PlayWindowFrame,
  ScopeFrame,
} from "./model";
import type {
  Card,
  CardPosition,
  Counter,
  Edge,
  Effect,
  EventPattern,
  Outcome,
  OutcomeRule,
  Pack,
  Placement,
  Scope,
  ScopeHooks,
} from "./pack";
import { assertNever, type Result } from "./result";
import { shuffle } from "./rng";

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

function matchesPattern(pattern: EventPattern, event: GameEvent): boolean {
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
      return event.type === "unitCreated" && (pattern.kind === null || pattern.kind === event.kind);
    case "unitRemoved":
      return event.type === "unitRemoved" && (pattern.kind === null || pattern.kind === event.kind);
    case "unitMoved":
      return (
        event.type === "unitMoved" &&
        (pattern.kind === null || pattern.kind === event.kind) &&
        (pattern.toSpace === null || pattern.toSpace === event.toSpace)
      );
    case "attributeChanged":
      return (
        event.type === "attributeChanged" &&
        event.attribute === pattern.attribute &&
        (pattern.kind === null || pattern.kind === event.kind)
      );
    case "spaceCounterChanged":
      return event.type === "spaceCounterChanged" && event.spaceCounter === pattern.spaceCounter;
    default:
      return assertNever(pattern);
  }
}

function cardDefinitionId(cardInstance: string): string {
  return cardInstance.slice(0, cardInstance.lastIndexOf(":"));
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
    };
  }

  function scopeOf(context: ExpressionContext): ExpressionScope {
    return { counters: work.counters, zones: work.zones, world: worldView(), context };
  }

  function contextFor(self: string | null, from = 0, to = 0, amount = 0): ExpressionContext {
    return { from, to, amount, self };
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
    const scope = scopeOf(context);
    const fired = rules.triggers.filter(
      (trigger) =>
        matchesPattern(trigger.on, event) &&
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
    delete work.units[unitId];
    work.retiredUnits.push(unitId);
    emit({ type: "unitRemoved", unit: unitId, kind: unit.kind }, contextFor(null));
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

  function forEachUnit(
    effect: Extract<Effect, { type: "forEachUnit" }>,
    context: ExpressionContext,
  ): void {
    const scope = scopeOf(context);
    const space = effect.at === null ? null : resolveSpace(effect.at, scope);
    if (effect.at !== null && space === null) return;
    const selected = Object.keys(work.units)
      .sort()
      .filter(
        (unitId) =>
          (effect.kind === null || work.units[unitId]?.kind === effect.kind) &&
          (space === null || spaceOfUnit(work.units, unitId) === space),
      );
    for (const unitId of [...selected].reverse()) {
      pushEffects(effect.effects, { ...context, self: unitId }, null);
    }
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
    frame: Omit<MoveFrame, "kind" | "unit" | "remaining">,
    unitRef: Parameters<typeof resolveUnit>[0],
    steps: number,
    scope: ExpressionScope,
  ): void {
    const unit = resolveUnit(unitRef, scope);
    if (unit === null || steps <= 0) return;
    work.stack.push({ kind: "move", unit, remaining: steps, ...frame });
  }

  function takeStep(frame: MoveFrame, space: string): void {
    frame.remaining -= 1;
    setPlacement(frame.unit, { type: "space", space });
    if (evaluateBoolean(frame.stopWhen, scopeOf({ ...frame.context, self: frame.unit }))) {
      frame.remaining = 0;
    }
  }

  function runMove(frame: MoveFrame): void {
    const here = work.units[frame.unit] === undefined ? null : spaceOfUnit(work.units, frame.unit);
    if (frame.remaining <= 0 || here === null) {
      work.stack.pop();
      return;
    }
    const scope = scopeOf({ ...frame.context, self: frame.unit });
    const traversable = traversableFor(frame.filter, scope);
    if (frame.mode === "choose") {
      const options = neighbours(work.edges, here, traversable);
      if (options.length === 0) {
        work.stack.pop();
        return;
      }
      work.pending = { kind: "moveUnit", unit: frame.unit, options };
      return;
    }
    const target = frame.target === null ? null : resolveSpace(frame.target, scope);
    const towardTarget = target === null ? null : distancesTo(work.edges, target, traversable);
    const distance = towardTarget?.get(here);
    const next =
      distance === undefined || distance === 0
        ? undefined
        : neighbours(work.edges, here, traversable).find(
            (space) => towardTarget?.get(space) === distance - 1,
          );
    if (next === undefined) {
      work.stack.pop();
      return;
    }
    takeStep(frame, next);
  }

  function placeCards(zoneId: string, cards: readonly string[], position: CardPosition): void {
    const existing = zoneCards(zoneId);
    work.zones[zoneId] = position === "top" ? [...cards, ...existing] : [...existing, ...cards];
    const faceUp = requireRules().zones.find((zone) => zone.id === zoneId)?.face !== "down";
    for (const card of cards) work.faceUp[card] = faceUp;
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
    placeCards(zoneId, created, "bottom");
    cardsMovedEvent(null, zoneId, created);
  }

  function shuffleZone(zoneId: string): void {
    const [shuffled, rng] = shuffle(work.rng, zoneCards(zoneId));
    work.zones[zoneId] = shuffled;
    work.rng = rng;
  }

  function offerChoice(effect: Extract<Effect, { type: "choose" }>, context: ExpressionContext) {
    const scope = scopeOf(context);
    const options = effect.options.filter((option) => evaluateBoolean(option.when, scope));
    if (options.length === 0) return;
    work.pending = {
      kind: "chooseOption",
      options: options.map(({ id, label, effects }) => ({ id, label, effects })),
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
        work.stack.push({ kind: "playWindow", from: effect.from, to: effect.to });
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
            context,
          },
          effect.unit,
          evaluateNumber(effect.steps, scope),
          scope,
        );
        return;
      case "stepMove":
        startMove(
          { filter: effect.filter, mode: "choose", target: null, stopWhen: false, context },
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
        forEachUnit(effect, context);
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
        emit({ type: "scopeExited", scope: frame.scope, id: frame.id }, EMPTY_CONTEXT);
        return;
      default:
        assertNever(frame.status);
    }
  }

  function openPlayWindow(frame: PlayWindowFrame): void {
    const scope = scopeOf(EMPTY_CONTEXT);
    const cards = zoneCards(frame.from).filter((card) =>
      evaluateBoolean(cardDefinition(card).playable, scope),
    );
    work.pending = { kind: "playCard", cards };
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
      default:
        assertNever(frame);
    }
  }

  function runStateChecks(): boolean {
    if (rules === null || work.stage !== "rounds") return false;
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
    if (work.stack.some((frame) => frame.kind === "finish")) return false;
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
    pushEffects(composed.setup, EMPTY_CONTEXT, null);
  }

  function advanceChoices(): void {
    const choice = pack.choices[work.choiceIndex];
    if (choice === undefined) {
      startSetup();
      return;
    }
    const remaining = choice.options.filter((moduleId) => !work.modules.includes(moduleId));
    const picked = choice.options.length - remaining.length;
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

  function playCard(window: PlayWindowFrame, card: string): void {
    const source = zoneCards(window.from);
    if (!source.includes(card)) fault(`Card "${card}" is not in zone "${window.from}"`);
    work.zones[window.from] = source.filter((candidate) => candidate !== card);
    placeCards(window.to, [card], "top");
    cardsMovedEvent(window.from, window.to, [card]);
    pushEffects(cardDefinition(card).effects, EMPTY_CONTEXT, null);
  }

  function apply(action: Action): void {
    const pending = work.pending ?? fault("No decision is pending");
    work.pending = null;
    switch (action.type) {
      case "pickModule":
        work.modules.push(action.module);
        emit({ type: "moduleChosen", module: action.module }, EMPTY_CONTEXT);
        return;
      case "pass":
        if (pending.kind === "pickModule") work.choiceIndex += 1;
        if (pending.kind === "playCard" || pending.kind === "moveUnit") work.stack.pop();
        return;
      case "chooseOption": {
        if (pending.kind !== "chooseOption") fault("No option choice is pending");
        const option =
          pending.options.find((candidate) => candidate.id === action.option) ??
          fault(`Unknown option "${action.option}"`);
        pushEffects(option.effects, pending.context, null);
        return;
      }
      case "playCard": {
        const window = work.stack[work.stack.length - 1];
        if (window?.kind !== "playWindow") fault("No play window is open");
        playCard(window, action.card);
        return;
      }
      case "moveTo": {
        const frame = work.stack[work.stack.length - 1];
        if (frame?.kind !== "move") fault("No movement is in progress");
        takeStep(frame, action.space);
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
