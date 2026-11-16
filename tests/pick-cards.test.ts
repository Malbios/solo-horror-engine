import { describe, expect, it } from "vitest";
import { createEngine, view } from "../src/core";
import { act, fixturePack, PAUSE_PHASE } from "./helpers";

const cards = ["acorn", "berry", "cone"].map((id) => ({
  id,
  name: id,
  tags: id === "cone" ? ["prickly"] : [],
}));

function engineWith(pick: object, setup: object[] = []) {
  return createEngine(
    fixturePack({
      zones: [{ id: "heap" }, { id: "basket" }, { id: "under", face: "down" }],
      cards,
      setup: [
        { type: "createCards", card: "acorn", zone: "heap" },
        { type: "createCards", card: "berry", zone: "heap" },
        { type: "createCards", card: "cone", zone: "heap" },
        ...setup,
      ],
      phases: [
        { id: "go", steps: [{ id: "go", effects: [{ type: "pickCards", ...pick }] }] },
        PAUSE_PHASE,
      ],
    }),
  );
}

describe("picking cards", () => {
  it("asks once per card among face-up cards passing the filter, without a pass", () => {
    const engine = engineWith({
      from: "heap",
      to: "basket",
      count: 2,
      cards: { excludeTags: ["prickly"] },
    });
    let state = engine.init(1);
    expect(state.pending).toEqual({
      kind: "pickCard",
      cards: ["acorn:1", "berry:1"],
      canPass: false,
    });
    state = act(engine, state, { type: "pickCard", card: "berry:1" });
    expect(state.pending).toEqual({ kind: "pickCard", cards: ["acorn:1"], canPass: false });
    state = act(engine, state, { type: "pickCard", card: "acorn:1" });
    expect(state.zones["basket"]).toEqual(["acorn:1", "berry:1"]);
    expect(state.zones["heap"]).toEqual(["cone:1"]);
  });

  it("may be passed when optional and puts cards where asked", () => {
    const engine = engineWith({
      from: "heap",
      to: "basket",
      count: 3,
      optional: true,
      position: "bottom",
    });
    let state = engine.init(1);
    expect(engine.legalActions(state)).toContainEqual({ type: "pass" });
    expect(view(state).pending).toMatchObject({ kind: "pickCard", canPass: true });
    state = act(engine, state, { type: "pickCard", card: "cone:1" });
    state = act(engine, state, { type: "pickCard", card: "acorn:1" });
    state = act(engine, state, { type: "pass" });
    expect(state.zones["basket"]).toEqual(["cone:1", "acorn:1"]);
    expect(state.pending?.kind).toBe("chooseOption");
  });

  it("never offers face-down cards and skips when none are left", () => {
    const engine = engineWith({ from: "under", to: "basket" }, [
      { type: "moveCards", from: "heap", to: "under", count: 3 },
    ]);
    const state = engine.init(1);
    expect(state.pending?.kind).toBe("chooseOption");
    expect(state.zones["basket"]).toEqual([]);
  });
});
