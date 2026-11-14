import { describe, expect, it } from "vitest";
import { createEngine, replay, undo, type Action } from "../src/core";
import { loadDemoPack } from "./helpers";

const engine = createEngine(loadDemoPack());
const advance: Action = { type: "advanceTrack", trackId: "demo-track" };

describe("replay", () => {
  it("reproduces a golden demo game", () => {
    const result = replay(engine, 2024, [advance, advance]);
    expect(result).toEqual({
      ok: true,
      value: {
        ...engine.init(2024),
        tracks: { "demo-track": 2 },
      },
    });
  });

  it("reports the index of the first rejected action", () => {
    const actions: Action[] = [advance, { type: "advanceTrack", trackId: "missing" }, advance];
    expect(replay(engine, 1, actions)).toEqual({
      ok: false,
      error: { index: 1, error: { type: "unknownTrack", trackId: "missing" } },
    });
  });

  it("undo equals replay without the last action", () => {
    const actions = [advance, advance, advance];
    const remaining = actions.slice(0, -1);
    const expected = replay(engine, 7, remaining);
    if (!expected.ok) throw new Error("Replay failed");
    expect(undo(engine, 7, actions)).toEqual({
      ok: true,
      value: { state: expected.value, actions: remaining },
    });
  });
});
