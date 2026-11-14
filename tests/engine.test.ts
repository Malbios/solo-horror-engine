import { describe, expect, it } from "vitest";
import { createEngine, type Action } from "../src/core";
import { act, deepFreeze, loadDemoPack, randomPlaythrough } from "./helpers";

const engine = createEngine(loadDemoPack());

describe("engine on the demo pack", () => {
  it("matches the initial state snapshot", () => {
    expect(engine.init(1)).toMatchSnapshot();
  });

  it("starts with the module choice", () => {
    expect(engine.legalActions(engine.init(1))).toEqual([
      { type: "pickModule", module: "bonus-cards" },
      { type: "pass" },
    ]);
  });

  it("builds and shuffles the deck after the module choice", () => {
    const state = act(engine, engine.init(1), { type: "pass" });
    const allCards = [...(state.zones["draw"] ?? []), ...(state.zones["hand"] ?? [])];
    expect(allCards).toHaveLength(7);
    expect(state.zones["hand"]).toHaveLength(3);
  });

  it("yields identical states for the same seed and actions", () => {
    const first = randomPlaythrough(engine, 42, 200);
    const second = randomPlaythrough(engine, 42, 200);
    expect(second.states).toEqual(first.states);
  });

  it("uses the seed to order the deck", () => {
    const hands = new Set(
      [1, 2, 3, 4, 5].map((seed) =>
        JSON.stringify(act(engine, engine.init(seed), { type: "pass" }).zones),
      ),
    );
    expect(hands.size).toBeGreaterThan(1);
  });

  it("finishes random playthroughs", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { states } = randomPlaythrough(engine, seed, 500);
      const last = states[states.length - 1];
      expect(last?.status).toBe("finished");
      expect(last?.outcome?.result).toMatch(/^(win|loss)$/);
    }
  });

  it("keeps every state JSON-serialisable", () => {
    for (const state of randomPlaythrough(engine, 9, 200).states) {
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });

  it("accepts every legal action and rejects others without changing state", () => {
    const { states } = randomPlaythrough(engine, 11, 200);
    const illegal: Action = { type: "playCard", card: "missing:1" };
    for (const state of states) {
      deepFreeze(state);
      const before = structuredClone(state);
      for (const action of engine.legalActions(state)) {
        expect(engine.step(state, action).ok).toBe(true);
      }
      const rejected = engine.step(state, illegal);
      expect(rejected.ok).toBe(false);
      expect(state).toEqual(before);
    }
  });

  it("rejects every action once the game is finished", () => {
    const { states } = randomPlaythrough(engine, 3, 500);
    const last = states[states.length - 1];
    if (last === undefined) throw new Error("No states");
    expect(engine.legalActions(last)).toEqual([]);
    expect(engine.step(last, { type: "pass" })).toEqual({
      ok: false,
      error: { type: "gameFinished" },
    });
  });
});
