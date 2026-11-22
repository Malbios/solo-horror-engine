import {
  assertNever,
  type Action,
  type DecisionView,
  type GameEvent,
  type GameView,
  type UnitPlacement,
  type UnitState,
  type ViewCard,
} from "../core";

/** One moment of an automatic sequence, as the board should show it. */
export type Beat = {
  view: GameView;
  lines: string[];
  /** Spaces to point at: where a piece came from and went to, or where it was removed. */
  focus: string[];
  /** A card resolved in this beat, when the player can see which one it is. */
  card: ViewCard | null;
};

export type PlaybackStep = { events: readonly GameEvent[]; after: GameView };

export type PlaybackInput = {
  before: GameView;
  steps: readonly PlaybackStep[];
  /** The unit the player just moved or picked by hand; its first move is not played back. */
  ownMove: string | null;
  /**
   * The unit the option the player just chose is about; its removal is not played back when it comes
   * before anything else on the board.
   */
  ownRemoval: string | null;
  describe: (event: GameEvent, shown: GameView) => string | null;
  /** Helper piece kinds: kept on the board, but their moves and removals are not played back. */
  bookkeeping: (kind: string) => boolean;
};

/** The unit whose move the player chose with this action: the piece moved, or the piece picked (e.g. to follow). */
export function ownMoveOf(action: Action, pending: DecisionView | null): string | null {
  if (action.type === "moveTo" && pending?.kind === "moveUnit") return pending.unit;
  if (action.type === "pickUnit") return action.unit;
  return null;
}

/** The unit the option the player chose with this action is about, if any. */
export function ownRemovalOf(action: Action, pending: DecisionView | null): string | null {
  return action.type === "chooseOption" && pending?.kind === "chooseOption" ? pending.unit : null;
}

type Draft = { units: Record<string, UnitState>; counters: Record<string, number> };

const isRoundStart = (event: GameEvent): boolean =>
  event.type === "scopeEntered" && event.scope === "round";

/** Setup bookkeeping is left out: before round 1, only what follows the round start counts. */
export function shownEvents(events: readonly GameEvent[], before: GameView): readonly GameEvent[] {
  if (before.round > 0) return events;
  const roundStart = events.findIndex(isRoundStart);
  return roundStart === -1 ? [] : events.slice(roundStart);
}

function visibleCard(ref: string, shown: GameView): ViewCard | null {
  for (const cards of Object.values(shown.zones)) {
    const found = cards.find((card) => card.ref === ref);
    if (found !== undefined) return found.card === null ? null : found;
  }
  return null;
}

function placementAfterMove(unit: string, toSpace: string | null, final: GameView): UnitPlacement {
  const finalPlacement = final.units[unit]?.placement;
  if (finalPlacement?.type === "inside") return finalPlacement;
  return toSpace === null ? { type: "offMap" } : { type: "space", space: toSpace };
}

function movedUnit(
  draft: Draft,
  event: Extract<GameEvent, { type: "unitMoved" }>,
  final: GameView,
): UnitState {
  const known = draft.units[event.unit] ?? final.units[event.unit];
  const placement = placementAfterMove(event.unit, event.toSpace, final);
  return known === undefined
    ? { id: event.unit, kind: event.kind, attributes: {}, placement }
    : { ...known, placement };
}

/** Changes the draft for one event; returns true when the event is something to watch on the board. */
function apply(
  draft: Draft,
  event: GameEvent,
  final: GameView,
  bookkeeping: (kind: string) => boolean,
): boolean {
  switch (event.type) {
    case "unitMoved":
      draft.units = { ...draft.units, [event.unit]: movedUnit(draft, event, final) };
      return !bookkeeping(event.kind) && (event.fromSpace !== null || event.toSpace !== null);
    case "unitRemoved":
      draft.units = Object.fromEntries(
        Object.entries(draft.units).filter(([id]) => id !== event.unit),
      );
      return !bookkeeping(event.kind) && event.fromSpace !== null;
    case "unitKindChanged": {
      const unit = draft.units[event.unit];
      if (unit !== undefined)
        draft.units = { ...draft.units, [event.unit]: { ...unit, kind: event.to } };
      return false;
    }
    case "attributeChanged": {
      const unit = draft.units[event.unit];
      if (unit !== undefined) {
        const attributes = { ...unit.attributes, [event.attribute]: event.to };
        draft.units = { ...draft.units, [event.unit]: { ...unit, attributes } };
      }
      return false;
    }
    case "counterChanged":
      draft.counters = { ...draft.counters, [event.counter]: event.to };
      return false;
    case "moduleChosen":
    case "cardsMoved":
    case "scopeEntered":
    case "scopeExited":
    case "gameFinished":
    case "unitCreated":
    case "spaceCounterChanged":
    case "edgeChanged":
    case "diceRolled":
    case "abilityUsed":
    case "cardResolved":
    case "cardBought":
    case "cardCounterChanged":
    case "quantityDelivered":
      return false;
    default:
      return assertNever(event);
  }
}

/** Card movements and resolutions stay in the log; a resolved card is shown as the beat's card instead. */
const isBookkeeping = (event: GameEvent): boolean =>
  event.type === "cardsMoved" || event.type === "cardResolved";

function focusOf(event: GameEvent): string[] {
  if (event.type === "unitMoved") {
    return [event.fromSpace, event.toSpace].filter((space): space is string => space !== null);
  }
  if (event.type === "unitRemoved" && event.fromSpace !== null) return [event.fromSpace];
  return [];
}

/**
 * The beats of the steps just taken: a new beat at every piece moved or removed on the board and every
 * resolved card the player can see; other described events join the current beat as lines.
 */
export function playbackBeats({
  before,
  steps,
  ownMove,
  ownRemoval,
  describe,
  bookkeeping,
}: PlaybackInput): Beat[] {
  const final = steps.at(-1)?.after;
  if (final === undefined) return [];
  const draft: Draft = { units: before.units, counters: before.counters };
  const beats: Beat[] = [];
  let current: Beat | null = null;
  // Lines before the first beat (e.g. a roll that decides the move) open that beat.
  let leadingLines: string[] = [];
  let skipOwnMove = ownMove !== null;
  let boardChanged = false;
  const snapshot = (): GameView => ({
    ...final,
    units: draft.units,
    counters: draft.counters,
    pending: null,
  });

  for (const [index, step] of steps.entries()) {
    const stepBefore = index === 0 ? before : (steps[index - 1]?.after ?? before);
    for (const event of shownEvents(step.events, stepBefore)) {
      const onBoard = apply(draft, event, final, bookkeeping);
      const line = isBookkeeping(event) ? null : describe(event, step.after);
      const isOwn = skipOwnMove && event.type === "unitMoved" && event.unit === ownMove;
      if (isOwn) {
        skipOwnMove = false;
        continue;
      }
      const isOwnRemoval =
        !boardChanged && event.type === "unitRemoved" && event.unit === ownRemoval;
      if (onBoard) boardChanged = true;
      if (isOwnRemoval) continue;
      const card = event.type === "cardResolved" ? visibleCard(event.card, step.after) : null;
      if (onBoard || card !== null) {
        const lines = [...leadingLines, ...(line === null ? [] : [line])];
        leadingLines = [];
        current = { view: snapshot(), lines, focus: focusOf(event), card };
        beats.push(current);
      } else if (current !== null) {
        current.view = snapshot();
        if (line !== null) current.lines.push(line);
      } else if (line !== null) {
        leadingLines.push(line);
      }
    }
  }
  return beats;
}

const READING_BASE_MILLISECONDS = 1500;
const MILLISECONDS_PER_WORD = 300;
const MIN_READING_MILLISECONDS = 2000;
const MAX_READING_MILLISECONDS = 10000;

/**
 * How long a beat's texts (card name and lines) stay up: enough to read them at a calm pace. `factor`
 * scales every part (above 1 slower, below 1 faster).
 */
export function readingMilliseconds(texts: readonly string[], factor = 1): number {
  const words = texts.flatMap((text) => text.split(/\s+/).filter(Boolean)).length;
  const wanted = READING_BASE_MILLISECONDS + words * MILLISECONDS_PER_WORD;
  const clamped = Math.min(MAX_READING_MILLISECONDS, Math.max(MIN_READING_MILLISECONDS, wanted));
  return Math.round(clamped * factor);
}
