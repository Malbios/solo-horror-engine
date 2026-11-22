import { describe, expect, it } from "vitest";
import { createEngine, view, viewActions, type Action, type GameState } from "../src/core";
import {
  actionLabel,
  automaticAction,
  cardsToShow,
  rollToShow,
  buyNote,
  discardsApart,
  stableOrder,
  unavailableBuys,
} from "../src/ui/decision";
import { createLabels, displayRules, knownCosts } from "../src/ui/labels";
import { groupCopies } from "../src/ui/panels";
import { act, fixturePack, PAUSE_PHASE } from "./helpers";

function shopPack(coins = 9) {
  return fixturePack({
    zones: [
      { id: "shelf", name: "Shelf" },
      { id: "bag", name: "Bag" },
    ],
    counters: [{ id: "coins", name: "Coins", start: coins, min: 0 }],
    cards: [
      { id: "lamp", name: "Lamp", buyCost: [{ counter: "coins", amount: 1 }] },
      { id: "bell", name: "Bell", buyCost: [{ counter: "coins", amount: 2 }] },
      { id: "rope", name: "Rope" },
    ],
    setup: [
      { type: "createCards", card: "rope", zone: "shelf" },
      { type: "createCards", card: "lamp", zone: "shelf" },
      { type: "createCards", card: "bell", zone: "shelf" },
      { type: "createCards", card: "lamp", zone: "shelf" },
    ],
    phases: [
      {
        id: "shop",
        steps: [
          {
            id: "go",
            effects: [{ type: "playWindow", buy: { from: "shelf", to: "bag", cards: {} } }],
          },
        ],
      },
      PAUSE_PHASE,
    ],
  });
}

function buttons(state: GameState, pack: ReturnType<typeof shopPack>) {
  const shown = view(state);
  const labels = createLabels(displayRules(pack, shown.modules), shown);
  return stableOrder(viewActions(state), shown, labels).map((action) => {
    const note = buyNote(action, shown, labels);
    return note === null
      ? actionLabel(action, shown, labels)
      : `${actionLabel(action, shown, labels)} [${note}]`;
  });
}

describe("decision buttons", () => {
  it("list card actions by name with price and copies, and keep a card's place after taking one", () => {
    const pack = shopPack();
    const engine = createEngine(pack);
    let state = engine.init(1);
    expect(buttons(state, pack)).toEqual([
      "Buy Bell [2 Coins]",
      "Buy Lamp [1 Coins · 2 left]",
      "Buy Rope [Free]",
      "Pass",
    ]);
    const lamp = viewActions(state).find(
      (action) => action.type === "buyCard" && action.card.startsWith("lamp"),
    );
    if (lamp === undefined) throw new Error("no lamp offered");
    state = act(engine, state, lamp);
    expect(buttons(state, pack)).toEqual([
      "Buy Bell [2 Coins]",
      "Buy Lamp [1 Coins]",
      "Buy Rope [Free]",
      "Pass",
    ]);
  });
});

describe("current prices", () => {
  function formulaPack(faceDownShelf = false) {
    return fixturePack({
      zones: [
        faceDownShelf
          ? { id: "shelf", name: "Shelf", face: "down" }
          : { id: "shelf", name: "Shelf" },
        { id: "bag", name: "Bag" },
      ],
      counters: [
        { id: "coins", name: "Coins", start: 9, min: 0 },
        { id: "markup", name: "Markup", start: 2 },
        { id: "lock", start: 0, hidden: true },
      ],
      cards: [
        {
          id: "lamp",
          name: "Lamp",
          buyCost: [{ counter: "coins", amount: { counter: "markup" } }],
        },
        {
          id: "bell",
          name: "Bell",
          buyCost: [
            { counter: "coins", amount: { sub: [{ counter: "markup" }, 2] } },
            { counter: "lock", amount: 0 },
          ],
        },
      ],
      setup: [
        { type: "createCards", card: "lamp", zone: "shelf" },
        { type: "createCards", card: "bell", zone: "shelf" },
      ],
      phases: [
        {
          id: "shop",
          steps: [
            {
              id: "go",
              effects: [{ type: "playWindow", buy: { from: "shelf", to: "bag", cards: {} } }],
            },
          ],
        },
        PAUSE_PHASE,
      ],
    });
  }

  it("shows a price given by an expression as its current amount, and leaves out zero and hidden costs", () => {
    const pack = formulaPack();
    const state = createEngine(pack).init(1);
    expect(state.pending).toMatchObject({
      buyPrices: {
        "lamp:1": [{ counter: "coins", amount: 2 }],
        "bell:1": [
          { counter: "coins", amount: 0 },
          { counter: "lock", amount: 0 },
        ],
      },
    });
    expect(buttons(state, pack)).toEqual(["Buy Bell [Free]", "Buy Lamp [2 Coins]", "Pass"]);
  });

  it("gives the price only of cards the player can identify, by their ref", () => {
    const state = createEngine(formulaPack(true)).init(1);
    const shown = view(state);
    if (shown.pending?.kind !== "window") throw new Error("no window");
    expect(
      Object.keys(state.pending?.kind === "window" ? state.pending.buyPrices : {}).length,
    ).toBe(2);
    expect(shown.pending.buyPrices).toEqual({});
  });

  it("knows a card's cost outside a buy window only where it is a plain number", () => {
    expect(
      knownCosts([
        { counter: "coins", amount: 3, floor: null },
        { counter: "coins", amount: { counter: "markup" }, floor: null },
      ]),
    ).toEqual([{ counter: "coins", amount: 3 }]);
  });
});

describe("unavailable buys", () => {
  it("lists shop cards that cannot be bought, once per name", () => {
    const state = createEngine(shopPack(1)).init(1);
    const shown = view(state);
    expect(unavailableBuys(shown).map((card) => card.card)).toEqual(["bell"]);
    expect(
      viewActions(state)
        .filter((action) => action.type === "buyCard")
        .map((action) => ("card" in action ? action.card.split(":")[0] : "")),
    ).toEqual(["rope", "lamp"]);
  });
});

describe("discards apart", () => {
  const windowPack = (playable: boolean) =>
    fixturePack({
      zones: [
        { id: "hand", name: "Hand" },
        { id: "pile", name: "Pile" },
      ],
      cards: [
        { id: "lamp", name: "Lamp", playable },
        { id: "bell", name: "Bell", playable: false },
      ],
      setup: [
        { type: "createCards", card: "lamp", zone: "hand" },
        { type: "createCards", card: "bell", zone: "hand" },
      ],
      phases: [
        {
          id: "turn",
          steps: [
            {
              id: "go",
              effects: [
                {
                  type: "playWindow",
                  play: { from: "hand", to: "pile", cards: {} },
                  discard: { from: "hand", to: "pile", effects: [] },
                },
              ],
            },
          ],
        },
        PAUSE_PHASE,
      ],
    });
  const types = (actions: readonly Action[]) => actions.map((action) => action.type);

  it("takes every discard out of a list that offers more than discards", () => {
    const state = createEngine(windowPack(true)).init(1);
    const { actions, discards } = discardsApart(viewActions(state));
    expect(types(actions)).toEqual(["playCard", "pass"]);
    expect(discards).toEqual([
      expect.objectContaining({ type: "discardCard", card: "lamp:1" }),
      expect.objectContaining({ type: "discardCard", card: "bell:1" }),
    ]);
  });

  it("keeps the discards in a list of only discards and pass", () => {
    const state = createEngine(windowPack(false)).init(1);
    const { actions, discards } = discardsApart(viewActions(state));
    expect(types(actions)).toEqual(["discardCard", "discardCard", "pass"]);
    expect(discards).toEqual([]);
  });
});

describe("automatic action", () => {
  it("takes the only offered action for the player, and nothing while there is a real choice", () => {
    const pack = shopPack(0);
    const engine = createEngine(pack);
    const poor = engine.init(1);
    expect(automaticAction(viewActions(poor))).toBeNull();
    const rope = viewActions(poor).find((action) => action.type === "buyCard");
    if (rope === undefined) throw new Error("no free card offered");
    const broke = act(engine, poor, rope);
    expect(automaticAction(viewActions(broke))).toEqual({ type: "pass" });
  });

  it("takes a lone option of a choice", () => {
    const pack = fixturePack({
      counters: [{ id: "picked", start: 0 }],
      phases: [
        {
          id: "ask",
          steps: [
            {
              id: "go",
              effects: [
                {
                  type: "choose",
                  options: [
                    {
                      id: "only",
                      label: "The only way",
                      effects: [{ type: "setCounter", counter: "picked", value: 1 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        PAUSE_PHASE,
      ],
    });
    const state = createEngine(pack).init(1);
    expect(automaticAction(viewActions(state))).toEqual({ type: "chooseOption", option: "only" });
  });
});

describe("rollToShow", () => {
  const shown = view(createEngine(shopPack()).init(1));
  const rolled = (pool: string) => ({ type: "diceRolled" as const, pool, dice: [] });

  it("shows the pool rolled last by the steps just taken", () => {
    const steps = [
      { events: [rolled("first")], after: shown },
      { events: [rolled("second")], after: shown },
    ];
    expect(rollToShow(steps, shown)).toBe("second");
  });

  it("shows the dice being picked when nothing was rolled, else nothing", () => {
    const picking = {
      ...shown,
      pending: { kind: "pickDie" as const, pool: "tray", dice: ["d1"], canPass: true },
    };
    expect(rollToShow([{ events: [], after: picking }], picking)).toBe("tray");
    expect(rollToShow([{ events: [], after: shown }], shown)).toBeNull();
  });

  it("shows the roll a choice or window names when nothing was rolled", () => {
    const waitingOn = (effect: Record<string, unknown>) => {
      const pack = fixturePack({
        zones: [{ id: "hand", name: "Hand" }],
        phases: [{ id: "turn", steps: [{ id: "go", effects: [effect] }] }, PAUSE_PHASE],
      });
      return view(createEngine(pack).init(1));
    };
    const choice = {
      type: "choose",
      optional: true,
      options: [{ id: "keep", label: "Keep", effects: [] }],
    };
    const window = { type: "playWindow", play: { from: "hand", to: "hand" } };
    for (const effect of [choice, window]) {
      const named = waitingOn({ ...effect, roll: "tray" });
      expect(rollToShow([{ events: [], after: named }], named)).toBe("tray");
      expect(rollToShow([{ events: [rolled("other")], after: named }], named)).toBe("other");
      const unnamed = waitingOn(effect);
      expect(rollToShow([{ events: [], after: unnamed }], unnamed)).toBeNull();
    }
  });
});

describe("cardsToShow", () => {
  const offered = (showZone: string | null) => {
    const pack = fixturePack({
      zones: [{ id: "look", name: "Look" }],
      cards: [{ id: "lamp", name: "Lamp" }],
      setup: [{ type: "createCards", card: "lamp", zone: "look" }],
      phases: [
        {
          id: "turn",
          steps: [
            {
              id: "go",
              effects: [{ type: "choose", showZone, options: [{ id: "keep", label: "Keep" }] }],
            },
          ],
        },
        PAUSE_PHASE,
      ],
    });
    return view(createEngine(pack).init(1));
  };

  it("shows the face-up cards of the zone a choice names", () => {
    const named = offered("look");
    expect(named.pending).toMatchObject({ kind: "chooseOption", showZone: "look" });
    expect(cardsToShow(named).map((card) => card.card)).toEqual(["lamp"]);
    expect(cardsToShow(offered(null))).toEqual([]);
  });

  it("leaves face-down cards out", () => {
    const named = offered("look");
    const hidden = { ...named, zones: { ...named.zones, look: [{ ref: "h1", card: null }] } };
    expect(cardsToShow(hidden)).toEqual([]);
  });
});

describe("groupCopies", () => {
  it("shows face-up copies once with a count, and never merges hidden cards", () => {
    const groups = groupCopies([
      { ref: "c1", card: "lamp" },
      { ref: "c2", card: "bell" },
      { ref: "c3", card: "lamp" },
      { ref: "h1", card: null },
      { ref: "h2", card: null },
    ]);
    expect(groups.map(({ card, copies }) => [card.ref, copies])).toEqual([
      ["c1", 2],
      ["c2", 1],
      ["h1", 1],
      ["h2", 1],
    ]);
  });
});
