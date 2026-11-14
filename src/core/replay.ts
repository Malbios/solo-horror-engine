import type { Engine } from "./engine";
import type { Action, GameState, RuleError } from "./model";
import { err, ok, type Result } from "./result";

export type ReplayError = { index: number; error: RuleError };

export function replay(
  engine: Engine,
  seed: number,
  actions: readonly Action[],
): Result<GameState, ReplayError> {
  let state = engine.init(seed);
  for (const [index, action] of actions.entries()) {
    const outcome = engine.step(state, action);
    if (!outcome.ok) {
      return err({ index, error: outcome.error });
    }
    state = outcome.value.state;
  }
  return ok(state);
}

export function undo(
  engine: Engine,
  seed: number,
  actions: readonly Action[],
): Result<{ state: GameState; actions: Action[] }, ReplayError> {
  const remaining = actions.slice(0, -1);
  const replayed = replay(engine, seed, remaining);
  return replayed.ok ? ok({ state: replayed.value, actions: remaining }) : replayed;
}
