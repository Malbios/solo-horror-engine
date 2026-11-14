import { describe, expect, it } from "vitest";
import { createEngine, replay, undo, type Action } from "../src/core";
import { loadDemoPack, randomPlaythrough } from "./helpers";

const engine = createEngine(loadDemoPack());

describe("replay", () => {
  it("rebuilds the final state from seed and actions", () => {
    const { states, actions } = randomPlaythrough(engine, 2024, 60);
    expect(replay(engine, 2024, actions)).toEqual({ ok: true, value: states[states.length - 1] });
  });

  it("reports the index of the first rejected action", () => {
    const actions: Action[] = [{ type: "pass" }, { type: "playCard", card: "missing:1" }];
    expect(replay(engine, 1, actions)).toEqual({
      ok: false,
      error: { index: 1, error: { type: "illegalAction", action: actions[1] } },
    });
  });

  it("undo equals replay without the last action", () => {
    const { actions } = randomPlaythrough(engine, 7, 10);
    const remaining = actions.slice(0, -1);
    const expected = replay(engine, 7, remaining);
    if (!expected.ok) throw new Error("Replay failed");
    expect(undo(engine, 7, actions)).toEqual({
      ok: true,
      value: { state: expected.value, actions: remaining },
    });
  });
});
