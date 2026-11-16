import { describe, expect, it } from "vitest";
import { createEngine, viewActions, type Action, type GameView } from "../src/core";
import { logEntry, replayWithLog } from "../src/ui/game-log";
import { createLabels, displayRules, moduleInfo } from "../src/ui/labels";
import { loadDemoPack } from "./helpers";

const SEED = 7;
const STEPS = 6;

function setup() {
  const pack = loadDemoPack();
  const engine = createEngine(pack);
  const labelsFor = (shown: GameView) =>
    createLabels(displayRules(pack, shown.modules), shown, moduleInfo(pack));
  return { engine, labelsFor };
}

describe("replayWithLog", () => {
  it("writes the same entries as taking the actions one by one", () => {
    const { engine, labelsFor } = setup();
    let state = engine.init(SEED);
    const actions: Action[] = [];
    const live = [];
    for (let index = 0; index < STEPS; index += 1) {
      const action = viewActions(state)[0];
      if (action === undefined) break;
      const outcome = engine.step(state, action);
      if (!outcome.ok) throw new Error("demo action refused");
      live.push(logEntry(action, state, outcome.value.state, outcome.value.events, labelsFor));
      actions.push(action);
      state = outcome.value.state;
    }
    const replayed = replayWithLog(engine, SEED, actions, labelsFor);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.value.log).toEqual(live);
    expect(replayed.value.log).toHaveLength(actions.length);
    expect(replayed.value.state).toEqual(state);
  });

  it("names the action that no longer replays", () => {
    const { engine, labelsFor } = setup();
    const unknownModule: Action = { type: "pickModule", module: "no-such-module" };
    const refused = replayWithLog(engine, SEED, [unknownModule], labelsFor);
    expect(refused.ok ? null : refused.error.index).toBe(0);
  });
});
