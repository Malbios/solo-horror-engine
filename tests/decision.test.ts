import { describe, expect, it } from "vitest";
import { createEngine, view, viewActions, type GameState } from "../src/core";
import { actionLabel, stableOrder } from "../src/ui/decision";
import { createLabels, displayRules } from "../src/ui/labels";
import { groupCopies } from "../src/ui/panels";
import { act, fixturePack, PAUSE_PHASE } from "./helpers";

function shopPack() {
  return fixturePack({
    zones: [
      { id: "shelf", name: "Shelf" },
      { id: "bag", name: "Bag" },
    ],
    cards: [
      { id: "lamp", name: "Lamp" },
      { id: "bell", name: "Bell" },
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
            effects: [
              { type: "playWindow", buy: { from: "shelf", to: "bag", cards: {}, free: true } },
            ],
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
  return stableOrder(viewActions(state), shown, labels).map((action) =>
    actionLabel(action, shown, labels),
  );
}

describe("decision buttons", () => {
  it("list card actions by name with their copies, and keep a card's place after taking one", () => {
    const pack = shopPack();
    const engine = createEngine(pack);
    let state = engine.init(1);
    expect(buttons(state, pack)).toEqual(["Take Bell", "Take Lamp (2)", "Take Rope", "Pass"]);
    const lamp = viewActions(state).find(
      (action) => action.type === "buyCard" && action.card.startsWith("lamp"),
    );
    if (lamp === undefined) throw new Error("no lamp offered");
    state = act(engine, state, lamp);
    expect(buttons(state, pack)).toEqual(["Take Bell", "Take Lamp", "Take Rope", "Pass"]);
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
