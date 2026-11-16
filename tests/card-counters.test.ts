import { describe, expect, it } from "vitest";
import { createEngine, view, type GameState } from "../src/core";
import { act, fixturePack } from "./helpers";

// A lantern with 3 charges: its ability spends one and moves the lantern away at 0.
const lantern = {
  id: "lantern",
  name: "Lantern",
  counters: [{ id: "charges", name: "Charges", start: 3, min: 0 }],
  abilities: [
    {
      id: "shine",
      label: "Shine",
      when: { thisCard: { zone: "belt" } },
      effects: [
        { type: "changeCounter", counter: "light", amount: 1 },
        { type: "changeCardCounter", cardCounter: "charges", amount: -1 },
        {
          type: "if",
          condition: { eq: [{ cardCounter: "charges" }, 0] },
          then: [{ type: "moveThisCard", to: "spent" }],
        },
      ],
    },
  ],
};

const shield = {
  id: "shield",
  name: "Shield",
  copies: 2,
  tags: ["guard"],
  counters: [{ id: "dents", start: 0 }],
};

const window = { type: "playWindow", abilitiesFrom: ["belt", "pack"] };

function engineWith(setup: object[], effects: object[] = [window]) {
  return createEngine(
    fixturePack({
      counters: [
        { id: "light", start: 0 },
        { id: "marked", start: 0 },
      ],
      zones: [{ id: "belt" }, { id: "pack" }, { id: "spent" }, { id: "hidden", face: "down" }],
      cards: [
        lantern,
        shield,
        {
          id: "flare",
          name: "Flare",
          tags: ["bright"],
          effects: [{ type: "call", procedure: "mark", args: {} }],
        },
      ],
      procedures: [
        {
          id: "mark",
          params: [],
          effects: [
            {
              type: "if",
              condition: { thisCard: { tag: "bright" } },
              then: [{ type: "changeCounter", counter: "marked", amount: 1 }],
            },
          ],
        },
      ],
      setup,
      phases: [{ id: "turn", steps: [{ id: "act", effects }] }],
    }),
  );
}

const create = (card: string, zone: string) => ({ type: "createCards", card, zone });
const shine = { type: "useAbility", card: "lantern:1", ability: "shine" } as const;

describe("card counters", () => {
  it("start on every copy, change through this card's ability, and let it move itself", () => {
    const engine = engineWith([create("lantern", "belt")]);
    let state: GameState = engine.init(1);
    expect(state.cardCounters["lantern:1"]).toEqual({ charges: 3 });
    for (let use = 0; use < 3; use += 1) state = act(engine, state, shine);
    expect(state.counters["light"]).toBe(3);
    expect(state.cardCounters["lantern:1"]).toEqual({ charges: 0 });
    expect(state.zones["spent"]).toEqual(["lantern:1"]);
    expect(engine.legalActions(state)).not.toContainEqual(shine);
  });

  it("offer an ability only while its card lies in the named zone", () => {
    const engine = engineWith([create("lantern", "pack")]);
    expect(engine.legalActions(engine.init(1))).not.toContainEqual(shine);
  });

  it("are shown on face-up cards only", () => {
    const up = view(engineWith([create("lantern", "belt")]).init(1));
    expect(up.zones["belt"]).toEqual([
      { ref: "lantern:1", card: "lantern", counters: { charges: 3 } },
    ]);
    const down = view(engineWith([create("lantern", "hidden")]).init(1));
    expect(down.zones["hidden"]?.[0]?.counters).toBeUndefined();
  });

  it("are changed for each card in a zone in turn", () => {
    const dent = {
      type: "forEachCard",
      zone: "belt",
      cards: { requireTags: ["guard"] },
      effects: [{ type: "changeCardCounter", cardCounter: "dents", amount: 2 }],
    };
    const state = engineWith(
      [create("shield", "belt"), create("lantern", "belt")],
      [dent, window],
    ).init(1);
    expect(state.cardCounters["shield:1"]).toEqual({ dents: 2 });
    expect(state.cardCounters["shield:2"]).toEqual({ dents: 2 });
    expect(state.cardCounters["lantern:1"]).toEqual({ charges: 3 });
  });
});

describe("this card", () => {
  it("is the played card, also inside a procedure it calls", () => {
    const engine = engineWith(
      [create("flare", "belt")],
      [{ type: "playWindow", play: { from: "belt", to: "spent" } }],
    );
    const state = act(engine, engine.init(1), { type: "playCard", card: "flare:1" });
    expect(state.counters["marked"]).toBe(1);
  });

  it("is absent outside a card, so card conditions are false and counters read 0", () => {
    const state = engineWith(
      [],
      [
        {
          type: "if",
          condition: {
            or: [{ thisCard: { tag: "bright" } }, { gt: [{ cardCounter: "charges" }, 0] }],
          },
          then: [{ type: "changeCounter", counter: "marked", amount: 1 }],
        },
        window,
      ],
    ).init(1);
    expect(state.counters["marked"]).toBe(0);
  });

  it("rejects a counter no card defines", () => {
    expect(() =>
      engineWith([], [{ type: "changeCardCounter", cardCounter: "unknown", amount: 1 }]),
    ).toThrow(/undefined cardCounter/);
  });
});
