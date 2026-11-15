import { composeRules, type Rules } from "./compose";
import type { Action, GameEvent, GameState, RuleError, StepOutcome } from "./model";
import type { Pack } from "./pack";
import { createResolver, EngineFaultSignal, type Resolver } from "./resolve";
import { assertNever, err, ok, type Result } from "./result";
import { seedRng } from "./rng";

export type Engine = {
  init(seed: number): GameState;
  step(state: GameState, action: Action): Result<StepOutcome, RuleError>;
  legalActions(state: GameState): Action[];
};

function createInitialState(pack: Pack, seed: number): GameState {
  return {
    packId: pack.meta.id,
    status: "awaitingDecision",
    outcome: null,
    fault: null,
    rng: seedRng(seed),
    stage: "choices",
    choiceIndex: 0,
    modules: [],
    round: 0,
    counters: {},
    zones: {},
    faceUp: {},
    handles: {},
    handleSerial: 0,
    known: {},
    cardSerials: {},
    units: {},
    unitSerial: 0,
    retiredUnits: [],
    edges: {},
    spaceCounters: {},
    pools: {},
    firedTriggers: [],
    abilityUses: {},
    stack: [],
    pending: null,
  };
}

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** Maps a card handle in a submitted action back to the card it stands for. */
function resolveActionRefs(state: GameState, action: Action): Action {
  if (!("card" in action)) return action;
  const match = Object.entries(state.handles).find(([, handle]) => handle === action.card);
  return match === undefined ? action : { ...action, card: match[0] };
}

function identifiedCards(state: GameState): Set<string> {
  return new Set(
    [...Object.keys(state.faceUp), ...Object.keys(state.known)].filter(
      (card) => state.faceUp[card] === true || state.known[card] === true,
    ),
  );
}

/** True when a step drew randomness or let the player identify a card they could not before. */
function isUndoBarrier(before: GameState, after: GameState): boolean {
  if (JSON.stringify(before.rng) !== JSON.stringify(after.rng)) return true;
  const identifiedBefore = identifiedCards(before);
  return [...identifiedCards(after)].some(
    (card) => card in before.faceUp && !identifiedBefore.has(card),
  );
}

function withPass(actions: Action[], canPass: boolean): Action[] {
  return canPass ? [...actions, { type: "pass" }] : actions;
}

export function legalActions(state: GameState): Action[] {
  const pending = state.status === "awaitingDecision" ? state.pending : null;
  if (pending === null) return [];
  switch (pending.kind) {
    case "pickModule":
      return withPass(
        pending.options.map((module): Action => ({ type: "pickModule", module })),
        pending.canPass,
      );
    case "chooseOption":
      return withPass(
        pending.options.map((option): Action => ({ type: "chooseOption", option: option.id })),
        pending.canPass,
      );
    case "window":
      return withPass(
        [
          ...pending.play.map((card): Action => ({ type: "playCard", card })),
          ...pending.discard.map((card): Action => ({ type: "discardCard", card })),
          ...pending.abilities.map((offer): Action => ({ type: "useAbility", ...offer })),
        ],
        true,
      );
    case "moveUnit":
      return withPass(
        pending.options.map((space): Action => ({ type: "moveTo", space })),
        pending.canPass,
      );
    case "pickUnit":
      return withPass(
        pending.options.map((unit): Action => ({ type: "pickUnit", unit })),
        pending.canPass,
      );
    case "pickCard":
      return pending.cards.map((card): Action => ({ type: "pickCard", card }));
    case "pickDie":
      return withPass(
        pending.dice.map((die): Action => ({ type: "pickDie", die })),
        pending.canPass,
      );
    default:
      return assertNever(pending);
  }
}

function sameAction(legal: Action, candidate: Action): boolean {
  switch (legal.type) {
    case "pickModule":
      return candidate.type === "pickModule" && candidate.module === legal.module;
    case "chooseOption":
      return candidate.type === "chooseOption" && candidate.option === legal.option;
    case "playCard":
      return candidate.type === "playCard" && candidate.card === legal.card;
    case "discardCard":
      return candidate.type === "discardCard" && candidate.card === legal.card;
    case "useAbility":
      return (
        candidate.type === "useAbility" &&
        candidate.card === legal.card &&
        candidate.ability === legal.ability
      );
    case "moveTo":
      return candidate.type === "moveTo" && candidate.space === legal.space;
    case "pickUnit":
      return candidate.type === "pickUnit" && candidate.unit === legal.unit;
    case "pickCard":
      return candidate.type === "pickCard" && candidate.card === legal.card;
    case "pickDie":
      return candidate.type === "pickDie" && candidate.die === legal.die;
    case "pass":
      return candidate.type === "pass";
    default:
      return assertNever(legal);
  }
}

export function createEngine(pack: Pack): Engine {
  const rulesCache = new Map<string, Result<Rules, string>>();

  function lookupRules(modules: readonly string[]): Result<Rules, string> {
    const key = modules.join("\n");
    const cached = rulesCache.get(key);
    if (cached !== undefined) return cached;
    const composed = composeRules(pack, modules);
    rulesCache.set(key, composed);
    return composed;
  }

  function settle(
    work: GameState,
    events: GameEvent[],
    drive: (resolver: Resolver) => void,
  ): string | null {
    try {
      drive(createResolver(pack, lookupRules, work, events));
      return null;
    } catch (error) {
      if (error instanceof EngineFaultSignal) return error.message;
      throw error;
    }
  }

  function init(seed: number): GameState {
    const work = createInitialState(pack, seed);
    const fault = settle(work, [], (resolver) => resolver.run());
    return fault === null ? work : { ...work, status: "faulted", fault, pending: null };
  }

  function step(state: GameState, action: Action): Result<StepOutcome, RuleError> {
    if (state.status === "finished") return err({ type: "gameFinished" });
    if (state.status === "faulted") {
      return err({ type: "engineFault", reason: state.fault ?? "Game is faulted" });
    }
    if (state.pending === null) return err({ type: "notPending" });
    const resolved = resolveActionRefs(state, action);
    if (!legalActions(state).some((legal) => sameAction(legal, resolved))) {
      return err({ type: "illegalAction", action });
    }
    const work = cloneState(state);
    const events: GameEvent[] = [];
    const fault = settle(work, events, (resolver) => {
      resolver.apply(resolved);
      resolver.run();
    });
    return fault === null
      ? ok({ state: work, events, undoBarrier: isUndoBarrier(state, work) })
      : err({ type: "engineFault", reason: fault });
  }

  return { init, step, legalActions };
}
