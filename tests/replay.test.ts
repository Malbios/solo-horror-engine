import { describe, expect, it } from "vitest";
import { canUndo, createEngine, replay, undo, type Action } from "../src/core";
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

  it("undo equals replay without the last action when that action revealed nothing", () => {
    const { actions } = randomPlaythrough(engine, 7, 30);
    const undoable = actions.findIndex(
      (_, index) => index > 0 && canUndo(engine, 7, actions.slice(0, index + 1)),
    );
    if (undoable < 0) throw new Error("No undoable action in the playthrough");
    const log = actions.slice(0, undoable + 1);
    const remaining = log.slice(0, -1);
    const expected = replay(engine, 7, remaining);
    if (!expected.ok) throw new Error("Replay failed");
    expect(undo(engine, 7, log)).toEqual({
      ok: true,
      value: { state: expected.value, actions: remaining },
    });
  });
});
