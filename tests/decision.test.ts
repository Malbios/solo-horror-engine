import { describe, expect, it } from "vitest";
import { createEngine, view, viewActions, type GameState } from "../src/core";
import {
  actionLabel,
  automaticPass,
  buyNote,
  stableOrder,
  unavailableBuys,
} from "../src/ui/decision";
import { createLabels, displayRules } from "../src/ui/labels";
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

describe("automatic pass", () => {
  it("passes for the player only when the shop offers nothing to buy", () => {
    const pack = shopPack(0);
    const engine = createEngine(pack);
    const poor = engine.init(1);
    expect(automaticPass(view(poor), viewActions(poor))).toBeNull();
    const rope = viewActions(poor).find((action) => action.type === "buyCard");
    if (rope === undefined) throw new Error("no free card offered");
    const broke = act(engine, poor, rope);
    expect(automaticPass(view(broke), viewActions(broke))).toEqual({ type: "pass" });
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
