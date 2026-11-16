import { describe, expect, it } from "vitest";
import { parsePack } from "../src/content";
import { createEngine, type Action, type GameState } from "../src/core";
import { act, fixturePack } from "./helpers";

const create = (card: string, zone: string) => ({ type: "createCards", card, zone });
const coins = (amount: number) => ({ counter: "coins", amount, floor: 0 });

const cards = [
  { id: "pear", name: "Pear", tags: ["fruit"], buyCost: [coins(1)], effects: [] },
  {
    id: "melon",
    name: "Melon",
    tags: ["fruit", "big"],
    buyCost: [coins(3)],
    effects: [{ type: "changeCounter", counter: "eaten", amount: 1 }],
  },
  { id: "pebble", name: "Pebble", buyCost: [coins(0)] },
];

const stock = [create("pear", "stall"), create("melon", "stall"), create("pebble", "stall")];

const shop = (buy: object = {}, extra: object = {}) => ({
  type: "playWindow",
  buy: { from: "stall", to: "basket", ...buy },
  ...extra,
});

function marketPack(window: object, start = 3, setup: object[] = stock) {
  return fixturePack({
    counters: [
      { id: "coins", start, min: -1 },
      { id: "eaten", start: 0 },
    ],
    zones: [{ id: "stall" }, { id: "basket" }, { id: "used" }],
    cards,
    setup,
    phases: [{ id: "shop", steps: [{ id: "shop", effects: [window] }] }],
  });
}

const buy = (card: string): Action => ({ type: "buyCard", card });
const PASS: Action = { type: "pass" };

const bought = (state: GameState) =>
  state.pending?.kind === "window" ? state.pending.buy : ["(no window)"];

describe("market", () => {
  it("moves a bought card, pays its buy cost and runs none of its effects", () => {
    const engine = createEngine(marketPack(shop()));
    const state = act(engine, engine.init(1), buy("melon:1"));
    expect(state.zones["basket"]).toEqual(["melon:1"]);
    expect(state.counters["coins"]).toBe(0);
    expect(state.counters["eaten"]).toBe(0);
  });

  it("never lets a cost take the counter below its floor", () => {
    const engine = createEngine(marketPack(shop(), 2));
    expect(bought(engine.init(1))).toEqual(["pear:1", "pebble:1"]);
  });

  it("still offers zero-cost cards while the counter is below the floor", () => {
    const engine = createEngine(marketPack(shop(), -1));
    expect(bought(engine.init(1))).toEqual(["pebble:1"]);
  });

  it("offers nothing to buy while the window condition fails", () => {
    const full = { lt: [{ countCards: { zone: "basket" } }, 1] };
    const engine = createEngine(marketPack(shop({ when: full })));
    const state = act(engine, engine.init(1), buy("pear:1"));
    expect(bought(state)).toEqual([]);
    expect(engine.legalActions(state)).toEqual([PASS]);
  });

  it("takes a free card through the filter once when the window does not repeat", () => {
    const engine = createEngine(
      marketPack(shop({ free: true, cards: { excludeTags: ["big"] } }, { repeat: false }), 0),
    );
    const state = engine.init(1);
    expect(bought(state)).toEqual(["pear:1", "pebble:1"]);
    expect(state.pending).toMatchObject({ kind: "window", play: [], buyFree: true });
    const after = act(engine, state, buy("pear:1"));
    expect(after.counters["coins"]).toBe(0);
    expect(after.zones["basket"]).toEqual(["pear:1"]);
    expect(after.round).toBe(2);
  });

  it("does not offer cards resting in another zone until they come back", () => {
    const engine = createEngine(
      fixturePack({
        counters: [
          { id: "coins", start: 5, min: 0 },
          { id: "eaten", start: 0 },
        ],
        zones: [{ id: "stall" }, { id: "basket" }, { id: "used" }],
        cards,
        setup: [create("pear", "stall"), create("pebble", "used")],
        phases: [
          {
            id: "shop",
            steps: [
              { id: "shop", effects: [shop()] },
              {
                id: "restock",
                effects: [{ type: "moveCards", from: "used", to: "stall", count: 1 }],
              },
            ],
          },
        ],
      }),
    );
    let state = engine.init(1);
    expect(bought(state)).toEqual(["pear:1"]);
    state = act(engine, state, PASS);
    expect(bought(state)).toContain("pebble:1");
  });

  it("rejects an unknown zone in a buy offer", () => {
    const parsed = parsePack({
      meta: { id: "fixture", version: "1.0.0", schemaVersion: 2, name: "Fixture" },
      base: {
        counters: [
          { id: "coins", start: 0 },
          { id: "eaten", start: 0 },
        ],
        zones: [{ id: "stall" }],
        cards,
        phases: [
          {
            id: "shop",
            steps: [{ id: "shop", effects: [shop({ to: "cart" })] }],
          },
        ],
      },
    });
    const issues = parsed.ok ? [] : parsed.error.issues.map((issue) => issue.message);
    expect(issues).toContain('undefined zone "cart"');
  });
});
