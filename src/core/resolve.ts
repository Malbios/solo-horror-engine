import type { Rules } from "./compose";
import {
  EMPTY_CONTEXT,
  evaluateBoolean,
  evaluateNumber,
  type ExpressionContext,
  type ExpressionScope,
} from "./expressions";
import type {
  Action,
  Decision,
  EffectsFrame,
  FinishFrame,
  Frame,
  GameEvent,
  GameState,
  PlayWindowFrame,
  ScopeFrame,
} from "./model";
import type {
  Card,
  CardPosition,
  Effect,
  EventPattern,
  Outcome,
  OutcomeRule,
  Pack,
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

  function scopeOf(context: ExpressionContext): ExpressionScope {
    return { counters: work.counters, zones: work.zones, context };
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

  function writeCounter(counterId: string, requested: number): void {
    const definition =
      requireRules().counterById.get(counterId) ?? fault(`Unknown counter "${counterId}"`);
    const from = work.counters[counterId] ?? definition.start;
    const to = clamp(requested, definition.min, definition.max);
    work.counters[counterId] = to;
    const excess = requested - to;
    const boundEffects = excess > 0 ? definition.onOverflow : definition.onUnderflow;
    const repetitions = Math.abs(excess);
    if (boundEffects.length > 0 && repetitions > 0) {
      if (repetitions > MAX_OPERATIONS_PER_CALL) {
        fault(`Counter "${counterId}" exceeded its bounds by ${repetitions}`);
      }
      for (let repetition = 0; repetition < repetitions; repetition++) {
        pushEffects(boundEffects, EMPTY_CONTEXT, null);
      }
    }
    if (from !== to) {
      emit(
        { type: "counterChanged", counter: counterId, from, to },
        { from, to, amount: to - from },
      );
    }
  }

  function placeCards(zoneId: string, cards: readonly string[], position: CardPosition): void {
    const existing = zoneCards(zoneId);
    work.zones[zoneId] = position === "top" ? [...cards, ...existing] : [...existing, ...cards];
    const faceUp = requireRules().zones.find((zone) => zone.id === zoneId)?.face !== "down";
    for (const card of cards) work.faceUp[card] = faceUp;
  }

  function cardsMovedEvent(from: string | null, to: string, cards: string[]): void {
    emit({ type: "cardsMoved", from, to, cards }, { from: 0, to: 0, amount: cards.length });
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
        if (pending.kind === "playCard") work.stack.pop();
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
