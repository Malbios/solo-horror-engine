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
import { shownEvents, withoutSilentTriggers } from "./playback";

export const LOG_LIMIT = 100;

export type LabelsFor = (shown: GameView) => Labels;

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
  const describe = (event: GameEvent) => describeEvent(event, shownAfter, labels);
  const lines = withoutSilentTriggers(
    shownEvents(viewEvents(events, after), shownBefore),
    describe,
  ).flatMap((event) => {
    const line = describe(event);
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
