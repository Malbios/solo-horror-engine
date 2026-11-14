import { describe, expect, it } from "vitest";
import { createEngine, type Action, type GameState } from "../src/core";
import { deepFreeze, loadDemoPack } from "./helpers";

const pack = loadDemoPack();
const engine = createEngine(pack);
const trackId = "demo-track";
const advance: Action = { type: "advanceTrack", trackId };

function applyAll(state: GameState, actions: readonly Action[]): GameState {
  return actions.reduce((current, action) => {
    const outcome = engine.step(current, action);
    if (!outcome.ok) throw new Error(`Unexpected rejection: ${outcome.error.type}`);
    return outcome.value.state;
  }, state);
}

describe("engine", () => {
  it("matches the demo initial state snapshot", () => {
    expect(engine.init(1)).toMatchSnapshot();
  });

  it("places the whole deck in the start zone", () => {
    const state = engine.init(1);
    expect([...(state.zones["draw"] ?? [])].sort()).toEqual(
      pack.deck.cards.map((c) => c.id).sort(),
    );
    expect(state.zones["hand"]).toEqual([]);
  });

  it("yields identical state for the same seed and actions", () => {
    const actions = [advance, advance, advance];
    expect(applyAll(engine.init(123), actions)).toEqual(applyAll(engine.init(123), actions));
  });

  it("uses the seed to order the deck", () => {
    const orders = new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(engine.init(seed).zones)));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("keeps state JSON-serialisable", () => {
    const state = applyAll(engine.init(8), [advance, advance]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("rejects an unknown track without changing state", () => {
    const state = deepFreeze(engine.init(1));
    const before = structuredClone(state);
    const outcome = engine.step(state, { type: "advanceTrack", trackId: "missing" });
    expect(outcome).toEqual({ ok: false, error: { type: "unknownTrack", trackId: "missing" } });
    expect(state).toEqual(before);
  });

  it("accepts every legal action and rejects ones that are not legal", () => {
    let state = deepFreeze(engine.init(4));
    while (state.status === "playing") {
      const legal = engine.legalActions(state);
      expect(legal.length).toBeGreaterThan(0);
      for (const action of legal) {
        expect(engine.step(state, action).ok).toBe(true);
      }
      const [first] = legal;
      if (first === undefined) throw new Error("No legal action");
      const outcome = engine.step(state, first);
      if (!outcome.ok) throw new Error("Legal action rejected");
      state = deepFreeze(outcome.value.state);
    }
    expect(engine.legalActions(state)).toEqual([]);
    const before = structuredClone(state);
    expect(engine.step(state, advance)).toEqual({ ok: false, error: { type: "gameFinished" } });
    expect(state).toEqual(before);
  });

  it("rejects advancing a track at maximum", () => {
    const track = pack.tracks[0];
    if (track === undefined) throw new Error("Demo pack has no track");
    const atMax = deepFreeze({ ...engine.init(1), tracks: { [trackId]: track.max } });
    expect(engine.legalActions(atMax)).not.toContainEqual(advance);
    expect(engine.step(atMax, advance)).toEqual({
      ok: false,
      error: { type: "trackAtMaximum", trackId },
    });
  });

  it("emits events and finishes when every track is at maximum", () => {
    const track = pack.tracks[0];
    if (track === undefined) throw new Error("Demo pack has no track");
    const nearlyDone = { ...engine.init(1), tracks: { [trackId]: track.max - 1 } };
    const outcome = engine.step(nearlyDone, advance);
    expect(outcome.ok && outcome.value.events).toEqual([
      { type: "trackAdvanced", trackId, value: track.max },
      { type: "gameFinished" },
    ]);
    expect(outcome.ok && outcome.value.state.status).toBe("finished");
  });
});
