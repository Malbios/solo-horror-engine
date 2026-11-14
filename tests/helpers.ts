import demoPackData from "../content/demo/pack.json";
import { parsePack } from "../src/content";
import { nextInt, seedRng, type Action, type Engine, type GameState, type Pack } from "../src/core";

export function buildPack(input: unknown): Pack {
  const parsed = parsePack(input);
  if (!parsed.ok) {
    throw new Error(`Pack invalid: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.value;
}

export function loadDemoPack(): Pack {
  return buildPack(demoPackData);
}

export function fixturePack(base: object, extra: object = {}): Pack {
  return buildPack({
    meta: { id: "fixture", version: "1.0.0", schemaVersion: 2, name: "Fixture" },
    base,
    ...extra,
  });
}

export const PAUSE_PHASE = {
  id: "pause",
  steps: [
    {
      id: "wait",
      effects: [{ type: "choose", options: [{ id: "continue", label: "Continue" }] }],
    },
  ],
};

export const CONTINUE: Action = { type: "chooseOption", option: "continue" };

export function act(engine: Engine, state: GameState, action: Action): GameState {
  const outcome = engine.step(state, action);
  if (!outcome.ok) {
    throw new Error(`Rejected ${JSON.stringify(action)}: ${JSON.stringify(outcome.error)}`);
  }
  return outcome.value.state;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Plays random legal actions from a seeded generator until the game ends or the limit is hit. */
export function randomPlaythrough(
  engine: Engine,
  seed: number,
  maxActions: number,
): { states: GameState[]; actions: Action[] } {
  let state = engine.init(seed);
  let picker = seedRng(seed ^ 0x5bd1e995);
  const states = [state];
  const actions: Action[] = [];
  while (state.status === "awaitingDecision" && actions.length < maxActions) {
    const legal = engine.legalActions(state);
    const [index, advanced] = nextInt(picker, legal.length);
    picker = advanced;
    const action = legal[index];
    if (action === undefined) throw new Error("No legal action");
    state = act(engine, state, action);
    actions.push(action);
    states.push(state);
  }
  return { states, actions };
}
