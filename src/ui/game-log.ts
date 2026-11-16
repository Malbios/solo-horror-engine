import {
  err,
  ok,
  view,
  viewEvents,
  type Action,
  type Engine,
  type GameEvent,
  type GameState,
  type GameView,
  type ReplayError,
  type Result,
} from "../core";
import { describeAction, describeEvent, type Labels } from "./labels";
import type { LogEntry } from "./panels";

export const LOG_LIMIT = 100;

export type LabelsFor = (shown: GameView) => Labels;

const isRoundStart = (event: GameEvent): boolean =>
  event.type === "scopeEntered" && event.scope === "round";

/** Setup bookkeeping is left out: from an action taken during setup, only the first round onward. */
function shownEvents(events: readonly GameEvent[], before: GameView): readonly GameEvent[] {
  if (before.round > 0) return events;
  const roundStart = events.findIndex(isRoundStart);
  return roundStart === -1 ? [] : events.slice(roundStart);
}

export function logEntry(
  action: Action,
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
  labelsFor: LabelsFor,
): LogEntry {
  const shownBefore = view(before);
  const title = describeAction(action, shownBefore, labelsFor(shownBefore));
  const shownAfter = view(after);
  const labels = labelsFor(shownAfter);
  const lines = shownEvents(viewEvents(events, after), shownBefore).flatMap((event) => {
    const line = describeEvent(event, shownAfter, labels);
    return line === null ? [] : [line];
  });
  return { title, lines };
}

export function withEntry(log: readonly LogEntry[], entry: LogEntry): LogEntry[] {
  return [...log, entry].slice(-LOG_LIMIT);
}

/** Replays the saved actions like `replay`, also writing the log entry each action would have made. */
export function replayWithLog(
  engine: Engine,
  seed: number,
  actions: readonly Action[],
  labelsFor: LabelsFor,
): Result<{ state: GameState; log: LogEntry[] }, ReplayError> {
  let state = engine.init(seed);
  let log: LogEntry[] = [];
  for (const [index, action] of actions.entries()) {
    const outcome = engine.step(state, action);
    if (!outcome.ok) return err({ index, error: outcome.error });
    log = withEntry(
      log,
      logEntry(action, state, outcome.value.state, outcome.value.events, labelsFor),
    );
    state = outcome.value.state;
  }
  return ok({ state, log });
}
