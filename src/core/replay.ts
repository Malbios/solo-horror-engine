import type { Engine } from "./engine";
import type { Action, GameState, RuleError } from "./model";
import { err, ok, type Result } from "./result";

export type ReplayError = { index: number; error: RuleError };

export type UndoError = { type: "replayFailed"; failure: ReplayError } | { type: "undoBlocked" };

type Replayed = { state: GameState; lastWasBarrier: boolean };

function replayTracked(
  engine: Engine,
  seed: number,
  actions: readonly Action[],
): Result<Replayed, ReplayError> {
  let state = engine.init(seed);
  let lastWasBarrier = false;
  for (const [index, action] of actions.entries()) {
    const outcome = engine.step(state, action);
    if (!outcome.ok) {
      return err({ index, error: outcome.error });
    }
    state = outcome.value.state;
    lastWasBarrier = outcome.value.undoBarrier;
  }
  return ok({ state, lastWasBarrier });
}

export function replay(
  engine: Engine,
  seed: number,
  actions: readonly Action[],
): Result<GameState, ReplayError> {
  const replayed = replayTracked(engine, seed, actions);
  return replayed.ok ? ok(replayed.value.state) : replayed;
}

/** True when the last action can be taken back: it revealed nothing and drew no randomness. */
export function canUndo(engine: Engine, seed: number, actions: readonly Action[]): boolean {
  if (actions.length === 0) return false;
  const replayed = replayTracked(engine, seed, actions);
  return replayed.ok && !replayed.value.lastWasBarrier;
}

/** Replays all but the last action, refusing when the last action is an undo barrier. */
export function undo(
  engine: Engine,
  seed: number,
  actions: readonly Action[],
): Result<{ state: GameState; actions: Action[] }, UndoError> {
  const full = replayTracked(engine, seed, actions);
  if (!full.ok) return err({ type: "replayFailed", failure: full.error });
  if (actions.length === 0 || full.value.lastWasBarrier) return err({ type: "undoBlocked" });
  const remaining = actions.slice(0, -1);
  const replayed = replay(engine, seed, remaining);
  return replayed.ok
    ? ok({ state: replayed.value, actions: remaining })
    : err({ type: "replayFailed", failure: replayed.error });
}
