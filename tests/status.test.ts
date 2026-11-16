import { describe, expect, it } from "vitest";
import { createEngine, view } from "../src/core";
import { createLabels, displayRules } from "../src/ui/labels";
import { piecesWithoutAttributes, zoneLayout } from "../src/ui/panels";
import { statusItems } from "../src/ui/status";
import { fixturePack } from "./helpers";

function screenPack() {
  return fixturePack({
    counters: [
      { id: "lamps", name: "Lamps", start: 3, max: 9, show: "main" },
      { id: "fog", name: "Fog", start: 0, show: "flag" },
      { id: "wind", name: "Wind", start: 2, show: "flag" },
      { id: "steps", name: "Steps", start: 1 },
      { id: "tally", name: "Tally", start: 4, show: "minor" },
    ],
    zones: [
      { id: "shelf", name: "Shelf" },
      { id: "bag", name: "Bag", show: "main" },
      { id: "spare", name: "Spare", show: "minor" },
      { id: "pocket", name: "Pocket" },
    ],
    cards: [{ id: "lamp", name: "Lamp" }],
    unitKinds: [
      {
        id: "walker",
        name: "Walker",
        attributes: [{ id: "grit", name: "Grit", start: 5, show: "main" }],
      },
      { id: "stone", name: "Stone" },
    ],
    spaces: [{ id: "mill", name: "Mill" }],
    setup: [
      { type: "createCards", card: "lamp", zone: "shelf" },
      { type: "createUnit", kind: "walker", placement: { onSpace: { space: "mill" } } },
      { type: "createUnit", kind: "stone", placement: { onSpace: { space: "mill" } } },
      { type: "createUnit", kind: "stone", placement: { onSpace: { space: "mill" } } },
    ],
  });
}

function screen() {
  const pack = screenPack();
  const shown = view(createEngine(pack).init(1));
  return { shown, labels: createLabels(displayRules(pack, shown.modules), shown) };
}

describe("status strip", () => {
  it("shows main counters and attributes, and flags only while they are not 0", () => {
    const { shown, labels } = screen();
    expect(statusItems(shown, labels)).toEqual([
      { label: "Lamps", value: "3/9", flag: false },
      { label: "Walker Grit", value: "5", flag: false },
      { label: "Wind", value: "2", flag: true },
    ]);
  });
});

describe("panels", () => {
  it("puts main zones first and keeps empty and minor zones apart", () => {
    const { shown, labels } = screen();
    expect(zoneLayout(shown, labels)).toEqual({
      main: ["bag"],
      normal: ["shelf"],
      empty: ["pocket"],
      minor: ["spare"],
    });
  });

  it("counts pieces without attributes per kind", () => {
    const { shown, labels } = screen();
    expect(piecesWithoutAttributes(shown, labels)).toEqual([
      { kind: "stone", name: "Stone", count: 2 },
    ]);
  });
});
