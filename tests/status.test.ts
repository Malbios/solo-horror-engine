import { describe, expect, it } from "vitest";
import { parsePack } from "../src/content";
import { createEngine, view } from "../src/core";
import { createLabels, displayRules } from "../src/ui/labels";
import { piecesWithoutAttributes, shownAttributes, zoneLayout } from "../src/ui/panels";
import { statusItems } from "../src/ui/status";
import { fixturePack, PAUSE_PHASE } from "./helpers";

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
      {
        id: "stone",
        name: "Stone",
        attributes: [
          { id: "moss", name: "Moss", start: 0, show: "flag" },
          { id: "age", name: "Age", start: 3, hidden: true },
        ],
      },
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

  it("hides hidden attributes and flag attributes at 0", () => {
    const { shown, labels } = screen();
    const stone = Object.values(shown.units).find((unit) => unit.kind === "stone");
    if (stone === undefined) throw new Error("no stone");
    expect(shownAttributes(stone, labels)).toEqual([]);
    expect(shownAttributes({ ...stone, attributes: { moss: 1, age: 3 } }, labels)).toEqual([
      ["moss", 1],
    ]);
  });

  it("counts pieces without attributes to show per kind", () => {
    const { shown, labels } = screen();
    expect(piecesWithoutAttributes(shown, labels)).toEqual([
      { kind: "stone", name: "Stone", count: 2 },
    ]);
  });
});

describe("counters shown with a zone", () => {
  function pinned() {
    const pack = fixturePack({
      counters: [
        { id: "lamps", name: "Lamps", start: 3, show: "main" },
        { id: "glow", name: "Glowing", start: 1, show: "flag", zone: "shelf" },
        { id: "dim", name: "Dim", start: 0, show: "flag", zone: "shelf" },
        { id: "charge", name: "Charge", start: 2, max: 5, show: "main", zone: "shelf" },
        { id: "secret", name: "Secret", start: 7, hidden: true, zone: "shelf" },
      ],
      zones: [
        { id: "shelf", name: "Shelf" },
        { id: "bag", name: "Bag" },
      ],
      cards: [{ id: "lamp", name: "Lamp" }],
      setup: [
        { type: "createCards", card: "lamp", zone: "shelf" },
        { type: "createCards", card: "lamp", zone: "bag" },
      ],
    });
    const shown = view(createEngine(pack).init(1));
    return { shown, labels: createLabels(displayRules(pack, shown.modules), shown) };
  }

  it("lists them with the zone's cards instead of in the strip", () => {
    const { shown, labels } = pinned();
    expect(labels.zoneNotes("shelf")).toEqual(["Glowing", "Charge: 2 / 5"]);
    expect(labels.zoneNotes("bag")).toEqual([]);
    expect(statusItems(shown, labels).map((item) => item.label)).toEqual(["Lamps"]);
  });

  it("adds them to the details of a card in that zone only", () => {
    const { shown, labels } = pinned();
    const [onShelf] = shown.zones["shelf"] ?? [];
    const [inBag] = shown.zones["bag"] ?? [];
    if (onShelf === undefined || inBag === undefined) throw new Error("cards missing");
    expect(labels.cardNotes(onShelf)).toEqual(["Glowing", "Charge: 2 / 5"]);
    expect(labels.cardNotes(inBag)).toEqual([]);
    expect(labels.cardNotes({ ...onShelf, card: null })).toEqual([]);
  });

  it("rejects a counter shown with a zone that does not exist", () => {
    const parsed = parsePack({
      meta: { id: "pinned", version: "1.0.0", schemaVersion: 2, name: "Pinned" },
      base: { counters: [{ id: "glow", start: 0, zone: "nowhere" }], phases: [PAUSE_PHASE] },
    });
    const issues = parsed.ok ? [] : parsed.error.issues.map((issue) => issue.message);
    expect(issues).toContain('undefined zone "nowhere"');
  });
});
