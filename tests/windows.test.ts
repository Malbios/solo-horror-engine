import { describe, expect, it } from "vitest";
import { parsePack } from "../src/content";
import { createEngine, viewActions, type Action } from "../src/core";
import { act, fixturePack } from "./helpers";

const change = (counter: string, amount: number) => ({ type: "changeCounter", counter, amount });
const create = (card: string, zone: string) => ({ type: "createCards", card, zone });

const counters = [
  { id: "light", start: 0 },
  { id: "coins", start: 0, min: 0 },
  { id: "score", start: 0 },
];

const zones = [{ id: "hand" }, { id: "pile" }, { id: "bench" }, { id: "trash" }];

const glow = {
  id: "glow",
  label: "Glow",
  effects: [change("light", 1)],
  limit: { uses: 1, per: "phase" },
};

const cards = [
  { id: "spark", name: "Spark", tags: ["quick"], effects: [change("score", 2)] },
  { id: "stone", name: "Stone", effects: [change("score", 1)] },
  { id: "lamp", name: "Lamp", abilities: [glow] },
];

const fullWindow = {
  type: "playWindow",
  play: { from: "hand", to: "pile" },
  discard: { from: "hand", to: "trash", effects: [change("coins", 1)] },
  abilitiesFrom: ["bench"],
};

const withPlayFilter = (cards: object) => ({
  ...fullWindow,
  play: { ...fullWindow.play, cards },
});

function windowPack(window: object, extra: object = {}) {
  return fixturePack({
    counters,
    zones,
    cards,
    setup: [create("spark", "hand"), create("stone", "hand"), create("lamp", "bench")],
    phases: [{ id: "act", steps: [{ id: "act", effects: [window] }] }],
    ...extra,
  });
}

const PASS: Action = { type: "pass" };
const USE_GLOW: Action = { type: "useAbility", card: "lamp:1", ability: "glow" };

const META = { id: "fixture", version: "1.0.0", schemaVersion: 2, name: "Fixture" };

function issuesOf(base: object): string[] {
  const parsed = parsePack({ meta: META, base });
  return parsed.ok ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("rich windows", () => {
  it("offers play, discard and abilities together and stays open until pass", () => {
    const engine = createEngine(windowPack(fullWindow));
    let state = engine.init(1);
    expect(engine.legalActions(state)).toEqual([
      { type: "playCard", card: "spark:1" },
      { type: "playCard", card: "stone:1" },
      { type: "discardCard", card: "spark:1" },
      { type: "discardCard", card: "stone:1" },
      USE_GLOW,
      PASS,
    ]);
    state = act(engine, state, USE_GLOW);
    expect(state.counters["light"]).toBe(1);
    expect(engine.legalActions(state)).not.toContainEqual(USE_GLOW);
    state = act(engine, state, { type: "discardCard", card: "stone:1" });
    expect(state.counters["coins"]).toBe(1);
    expect(state.zones["trash"]).toEqual(["stone:1"]);
    state = act(engine, state, { type: "playCard", card: "spark:1" });
    expect(state.counters["score"]).toBe(2);
    expect(state.zones["bench"]).toEqual(["lamp:1"]);
    expect(engine.legalActions(state)).toEqual([PASS]);
    state = act(engine, state, PASS);
    expect(state.round).toBe(2);
    expect(engine.legalActions(state)).toEqual([USE_GLOW, PASS]);
  });

  it("plays only cards that pass the tag filter but lets any card be discarded", () => {
    const engine = createEngine(windowPack(withPlayFilter({ requireTags: ["quick"] })));
    const legal = engine.legalActions(engine.init(1));
    expect(legal.filter((action) => action.type === "playCard")).toEqual([
      { type: "playCard", card: "spark:1" },
    ]);
    expect(legal.filter((action) => action.type === "discardCard")).toHaveLength(2);
    const excluding = createEngine(windowPack(withPlayFilter({ excludeTags: ["quick"] })));
    expect(
      excluding.legalActions(excluding.init(1)).filter((action) => action.type === "playCard"),
    ).toEqual([{ type: "playCard", card: "stone:1" }]);
  });

  it("hides abilities whose condition fails or whose cost cannot be paid", () => {
    const engine = createEngine(
      windowPack(fullWindow, {
        cards: [
          ...cards.filter((card) => card.id !== "lamp"),
          {
            id: "lamp",
            name: "Lamp",
            abilities: [
              { id: "bright", label: "Bright", when: { gte: [{ counter: "light" }, 5] } },
              { id: "buy", label: "Buy", cost: [{ counter: "coins", amount: 1 }] },
            ],
          },
        ],
      }),
    );
    let state = engine.init(1);
    expect(engine.legalActions(state).filter((action) => action.type === "useAbility")).toEqual([]);
    state = act(engine, state, { type: "discardCard", card: "stone:1" });
    expect(engine.legalActions(state)).toContainEqual({
      type: "useAbility",
      card: "lamp:1",
      ability: "buy",
    });
    state = act(engine, state, { type: "useAbility", card: "lamp:1", ability: "buy" });
    expect(state.counters["coins"]).toBe(0);
  });

  it("never gives back a use limited per game", () => {
    const engine = createEngine(
      windowPack(fullWindow, {
        cards: [
          ...cards.filter((card) => card.id !== "lamp"),
          { id: "lamp", name: "Lamp", abilities: [{ ...glow, limit: { uses: 1, per: "game" } }] },
        ],
      }),
    );
    let state = act(engine, engine.init(1), USE_GLOW);
    state = act(engine, state, PASS);
    expect(state.round).toBe(2);
    expect(engine.legalActions(state)).not.toContainEqual(USE_GLOW);
  });

  it("does not offer abilities of face-down cards", () => {
    const engine = createEngine(
      windowPack(fullWindow, {
        zones: [{ id: "hand" }, { id: "pile" }, { id: "bench", face: "down" }, { id: "trash" }],
      }),
    );
    expect(
      engine.legalActions(engine.init(1)).filter((action) => action.type === "useAbility"),
    ).toEqual([]);
  });

  it("closes a window without repeat after one action", () => {
    const engine = createEngine(windowPack({ ...fullWindow, repeat: false }));
    const state = act(engine, engine.init(1), { type: "playCard", card: "stone:1" });
    expect(state.counters["score"]).toBe(1);
    expect(state.round).toBe(2);
  });

  it("offers identical visible cards once in the view", () => {
    const engine = createEngine(
      windowPack(fullWindow, { setup: [create("stone", "hand"), create("stone", "hand")] }),
    );
    expect(viewActions(engine.init(1))).toEqual([
      { type: "playCard", card: "stone:1" },
      { type: "discardCard", card: "stone:1" },
      PASS,
    ]);
  });

  describe("pack checks", () => {
    const base = (window: object, extraCards: object[] = []) => ({
      counters,
      zones,
      cards: [...cards, ...extraCards],
      phases: [{ id: "act", steps: [{ id: "act", effects: [window] }] }],
    });

    it("rejects repeated ability ids on one card", () => {
      expect(
        issuesOf(
          base(fullWindow, [
            { id: "twin", name: "Twin", abilities: [glow, { ...glow, label: "Again" }] },
          ]),
        ),
      ).toContain("ability ids must be unique");
    });

    it("rejects unknown zones in abilitiesFrom and discard", () => {
      const issues = issuesOf(
        base({
          ...fullWindow,
          discard: { from: "hand", to: "nowhere", effects: [] },
          abilitiesFrom: ["shelf"],
        }),
      );
      expect(issues).toContain('undefined zone "nowhere"');
      expect(issues).toContain('undefined zone "shelf"');
    });
  });
});
