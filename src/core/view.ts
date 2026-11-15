import { cardDefinitionId } from "./cards";
import { legalActions } from "./engine";
import type { UnitState } from "./graph";
import type {
  AbilityOffer,
  Action,
  Decision,
  Die,
  GameEvent,
  GameOutcome,
  GameState,
  GameStatus,
  RuleError,
  Stage,
} from "./model";
import type { Cost, Edge } from "./pack";
import { assertNever } from "./result";

/** A card as the player sees it: `ref` is a handle while face down, `card` is null while unknown. */
export type ViewCard = { ref: string; card: string | null };

export type OptionChoiceView = { id: string; label: string; cost: Cost[] };

export type DecisionView =
  | Exclude<Decision, { kind: "chooseOption" } | { kind: "window" } | { kind: "pickCard" }>
  | { kind: "chooseOption"; options: OptionChoiceView[]; canPass: boolean }
  | { kind: "window"; play: ViewCard[]; discard: ViewCard[]; abilities: AbilityOffer[] }
  | { kind: "pickCard"; cards: ViewCard[] };

export type GameView = {
  packId: string;
  status: GameStatus;
  outcome: GameOutcome | null;
  fault: string | null;
  stage: Stage;
  modules: string[];
  round: number;
  counters: Record<string, number>;
  zones: Record<string, ViewCard[]>;
  units: Record<string, UnitState>;
  edges: Record<string, Edge>;
  spaceCounters: Record<string, Record<string, number>>;
  pools: Record<string, Die[]>;
  pending: DecisionView | null;
};

function isFaceUp(state: GameState, card: string): boolean {
  return state.faceUp[card] === true;
}

function isIdentified(state: GameState, card: string): boolean {
  return isFaceUp(state, card) || state.known[card] === true;
}

export function cardRef(state: GameState, card: string): string {
  return isFaceUp(state, card) ? card : (state.handles[card] ?? card);
}

function viewCard(state: GameState, card: string): ViewCard {
  return {
    ref: cardRef(state, card),
    card: isIdentified(state, card) ? cardDefinitionId(card) : null,
  };
}

function hiddenCards(state: GameState): string[] {
  return Object.keys(state.handles).filter((card) => !isFaceUp(state, card));
}

function redact(text: string, state: GameState): string {
  return hiddenCards(state).reduce(
    (redacted, card) => redacted.split(card).join(cardRef(state, card)),
    text,
  );
}

function viewDecision(state: GameState, pending: Decision): DecisionView {
  switch (pending.kind) {
    case "chooseOption":
      return {
        kind: "chooseOption",
        options: pending.options.map(({ id, label, cost }) => ({ id, label, cost })),
        canPass: pending.canPass,
      };
    case "window":
      return {
        kind: "window",
        play: pending.play.map((card) => viewCard(state, card)),
        discard: pending.discard.map((card) => viewCard(state, card)),
        abilities: pending.abilities,
      };
    case "pickCard":
      return { kind: pending.kind, cards: pending.cards.map((card) => viewCard(state, card)) };
    case "pickModule":
    case "moveUnit":
    case "pickUnit":
    case "pickDie":
      return pending;
    default:
      return assertNever(pending);
  }
}

/** Everything the player may see. Hidden cards appear only as handles. */
export function view(state: GameState): GameView {
  return {
    packId: state.packId,
    status: state.status,
    outcome: state.outcome,
    fault: state.fault === null ? null : redact(state.fault, state),
    stage: state.stage,
    modules: state.modules,
    round: state.round,
    counters: state.counters,
    zones: Object.fromEntries(
      Object.entries(state.zones).map(([zone, cards]) => [
        zone,
        cards.map((card) => viewCard(state, card)),
      ]),
    ),
    units: state.units,
    edges: state.edges,
    spaceCounters: state.spaceCounters,
    pools: state.pools,
    pending:
      state.status === "awaitingDecision" && state.pending !== null
        ? viewDecision(state, state.pending)
        : null,
  };
}

function viewAction(state: GameState, action: Action): Action {
  return "card" in action ? { ...action, card: cardRef(state, action.card) } : action;
}

function lookKey(state: GameState, action: Action): string | null {
  if (!("card" in action) || !isIdentified(state, action.card)) return null;
  const ability = action.type === "useAbility" ? `:${action.ability}` : "";
  return `${action.type}:${cardDefinitionId(action.card)}${ability}`;
}

/** Legal actions as the player sees them; options that look identical are offered once. */
export function viewActions(state: GameState): Action[] {
  const seen = new Set<string>();
  const offered: Action[] = [];
  for (const action of legalActions(state)) {
    const key = lookKey(state, action);
    if (key !== null && seen.has(key)) continue;
    if (key !== null) seen.add(key);
    offered.push(viewAction(state, action));
  }
  return offered;
}

/** Events as the player sees them, judged against the state after the step. */
export function viewEvents(events: readonly GameEvent[], after: GameState): GameEvent[] {
  return events.map((event) => {
    if (event.type === "cardsMoved") {
      return { ...event, cards: event.cards.map((card) => cardRef(after, card)) };
    }
    if (event.type === "abilityUsed") return { ...event, card: cardRef(after, event.card) };
    return event;
  });
}

export function viewError(error: RuleError, state: GameState): RuleError {
  switch (error.type) {
    case "engineFault":
      return { ...error, reason: redact(error.reason, state) };
    case "illegalAction":
      return { ...error, action: viewAction(state, error.action) };
    case "gameFinished":
    case "notPending":
      return error;
    default:
      return assertNever(error);
  }
}
