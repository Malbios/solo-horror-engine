import { describe, expect, it } from "vitest";
import { createEngine } from "../src/core";
import { act, CONTINUE, fixturePack, PAUSE_PHASE } from "./helpers";

const change = (counter: string, amount: unknown) => ({ type: "changeCounter", counter, amount });
const coins = (amount: number) => ({ counter: "coins", amount });

function onePhase(effects: unknown[], base: object) {
  return fixturePack({
    ...base,
    phases: [{ id: "act", steps: [{ id: "go", effects }] }, PAUSE_PHASE],
  });
}

describe("costs", () => {
  it("lists an option only while its cost can be paid, and pays it when chosen", () => {
    const pack = onePhase(
      [
        {
          type: "choose",
          optional: true,
          options: [
            { id: "dear", label: "Dear", cost: [coins(2)], effects: [change("bought", 1)] },
            { id: "cheap", label: "Cheap", cost: [coins(1)], effects: [change("bought", 1)] },
          ],
        },
      ],
      {
        counters: [
          { id: "coins", start: 1, min: 0 },
          { id: "bought", start: 0 },
        ],
      },
    );
    const engine = createEngine(pack);
    const offered = engine.init(1);
    expect(engine.legalActions(offered)).toEqual([
      { type: "chooseOption", option: "cheap" },
      { type: "pass" },
    ]);
    const paid = act(engine, offered, { type: "chooseOption", option: "cheap" });
    expect(paid.counters["coins"]).toBe(0);
    expect(paid.counters["bought"]).toBe(1);
    const nextRound = act(engine, act(engine, paid, CONTINUE), CONTINUE);
    expect(nextRound.round).toBe(3);
    expect(nextRound.counters["bought"]).toBe(1);
    expect(engine.legalActions(nextRound)).toEqual([CONTINUE]);
  });

  it("treats a counter without a minimum as always payable", () => {
    const pack = onePhase(
      [{ type: "choose", options: [{ id: "spend", label: "Spend", cost: [coins(3)] }] }],
      { counters: [{ id: "coins", start: 1 }] },
    );
    const engine = createEngine(pack);
    const spent = act(engine, engine.init(1), { type: "chooseOption", option: "spend" });
    expect(spent.counters["coins"]).toBe(-2);
  });

  it("only lets cards be played when their cost can be paid", () => {
    const pack = onePhase(
      [
        { type: "createCards", card: "dear", zone: "hand" },
        { type: "createCards", card: "cheap", zone: "hand" },
        { type: "playWindow", play: { from: "hand", to: "played" } },
      ],
      {
        counters: [{ id: "coins", start: 2, min: 0 }],
        zones: [{ id: "hand" }, { id: "played" }],
        cards: [
          { id: "dear", name: "Dear", cost: [coins(5)] },
          { id: "cheap", name: "Cheap", cost: [coins(2)] },
        ],
      },
    );
    const engine = createEngine(pack);
    const window = engine.init(1);
    expect(window.pending).toEqual({
      kind: "window",
      play: ["cheap:1"],
      discard: [],
      buy: [],
      buyFree: false,
      abilities: [],
    });
    const played = act(engine, window, { type: "playCard", card: "cheap:1" });
    expect(played.counters["coins"]).toBe(0);
    expect(played.zones["played"]).toEqual(["cheap:1"]);
  });

  it("pays a discard cost with one card pick at a time", () => {
    const pack = onePhase(
      [
        { type: "createCards", card: "token", zone: "hand" },
        {
          type: "choose",
          options: [
            {
              id: "trade",
              label: "Trade",
              cost: [{ discard: { from: "hand", to: "pile", count: 2 } }],
              effects: [change("gold", 1)],
            },
          ],
        },
      ],
      {
        counters: [{ id: "gold", start: 0 }],
        zones: [{ id: "hand" }, { id: "pile" }],
        cards: [{ id: "token", name: "Token", copies: 3 }],
      },
    );
    const engine = createEngine(pack);
    let state = act(engine, engine.init(1), { type: "chooseOption", option: "trade" });
    expect(state.pending).toEqual({
      kind: "pickCard",
      cards: ["token:1", "token:2", "token:3"],
    });
    state = act(engine, state, { type: "pickCard", card: "token:2" });
    expect(state.pending).toEqual({ kind: "pickCard", cards: ["token:1", "token:3"] });
    expect(state.counters["gold"]).toBe(0);
    state = act(engine, state, { type: "pickCard", card: "token:3" });
    expect(state.zones["hand"]).toEqual(["token:1"]);
    expect(state.zones["pile"]).toEqual(["token:3", "token:2"]);
    expect(state.counters["gold"]).toBe(1);
  });

  it("hides a neighbour behind an unpayable edge cost and charges the step", () => {
    const pack = (start: number) =>
      onePhase([{ type: "stepMove", unit: { id: "walker" }, steps: 1, filter: "any" }], {
        spaces: ["a", "b", "c"].map((id) => ({ id, name: id })),
        edges: [
          { id: "ab", fromSpace: "a", toSpace: "b", cost: [coins(1)] },
          { id: "ac", fromSpace: "a", toSpace: "c" },
        ],
        edgeFilters: [{ id: "any" }],
        counters: [{ id: "coins", start, min: 0 }],
        unitKinds: [{ id: "walker", name: "Walker" }],
        setup: [
          {
            type: "createUnit",
            kind: "walker",
            id: "walker",
            placement: { onSpace: { space: "a" } },
          },
        ],
      });
    const broke = createEngine(pack(0));
    expect(broke.init(1).pending).toEqual({
      kind: "moveUnit",
      unit: "walker",
      options: ["c"],
      canPass: true,
    });
    const funded = createEngine(pack(1));
    const offered = funded.init(1);
    expect(offered.pending).toEqual({
      kind: "moveUnit",
      unit: "walker",
      options: ["b", "c"],
      canPass: true,
    });
    const moved = act(funded, offered, { type: "moveTo", space: "b" });
    expect(moved.units["walker"]?.placement).toEqual({ type: "space", space: "b" });
    expect(moved.counters["coins"]).toBe(0);
  });
});
