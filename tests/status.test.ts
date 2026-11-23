import { describe, expect, it } from "vitest";
import { parsePack } from "../src/content";
import { createEngine, view, type Counter } from "../src/core";
import { amountText, createLabels, displayRules } from "../src/ui/labels";
import {
  panelAttributes,
  piecesWithoutAttributes,
  shownAttributes,
  zoneLayout,
} from "../src/ui/panels";
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

describe("amounts as icons", () => {
  function counter(icons: Counter["icons"], max: number | null): Counter {
    return {
      id: "glow",
      name: "Glow",
      hidden: false,
      show: "main",
      zone: null,
      icons,
      start: 0,
      min: 0,
      max,
      resetScope: null,
      onOverflow: [],
      onUnderflow: [],
    };
  }
  const both = { full: "o", empty: "x" };

  it("draws a point per icon, the missing ones up to the max, then the number", () => {
    expect(amountText(counter(both, 4), 3, false)).toBe("ooox (3)");
    expect(amountText(counter(both, 4), 0, false)).toBe("xxxx (0)");
    expect(amountText(counter(both, 4), 4, true)).toBe("oooo (4)");
    expect(amountText(counter(both, null), 2, false)).toBe("oo (2)");
  });

  it("draws no missing icons without an empty icon, and only the number when nothing is drawn", () => {
    const fullOnly = { full: "o", empty: null };
    expect(amountText(counter(fullOnly, 4), 3, false)).toBe("ooo (3)");
    expect(amountText(counter(fullOnly, 4), 0, false)).toBe("0");
    expect(amountText(counter(both, 2), -1, false)).toBe("xxx (-1)");
    expect(amountText(counter(both, 2), 5, false)).toBe("ooooo (5)");
  });

  it("keeps the number, and the max where asked, without icons", () => {
    expect(amountText(counter(null, 4), 3, false)).toBe("3");
    expect(amountText(counter(null, 4), 3, true)).toBe("3 / 4");
    expect(amountText(counter(null, null), 3, true)).toBe("3");
    expect(amountText(undefined, 3, true)).toBe("3");
  });

  it("shows a main attribute with icons in the strip", () => {
    const pack = fixturePack({
      unitKinds: [
        {
          id: "walker",
          name: "Walker",
          attributes: [
            {
              id: "grit",
              name: "Grit",
              start: 2,
              max: 3,
              show: "main",
              icons: { full: "o", empty: "x" },
            },
          ],
        },
      ],
      spaces: [{ id: "mill", name: "Mill" }],
      setup: [{ type: "createUnit", kind: "walker", placement: { onSpace: { space: "mill" } } }],
    });
    const shown = view(createEngine(pack).init(1));
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    expect(statusItems(shown, labels)).toEqual([
      { label: "Walker Grit", value: "oox (2)", flag: false },
    ]);
  });
});

describe("panels", () => {
  it("puts main zones first and keeps empty and minor zones apart", () => {
    const { shown, labels } = screen();
    expect(zoneLayout(shown, labels)).toEqual({
      rows: [["bag"], ["shelf"]],
      empty: ["pocket"],
      minor: ["spare"],
    });
  });

  it("orders zones by order, then pack order, and draws zones sharing a row side by side", () => {
    const filled = ["first", "late", "low", "tied", "joins", "boss"];
    const pack = fixturePack({
      zones: [
        { id: "boss", show: "main", order: 5 },
        { id: "first" },
        { id: "late", order: 2, row: "pair" },
        { id: "low", order: 1 },
        { id: "tied", order: 1 },
        { id: "joins", row: "pair" },
        { id: "bare", order: 0, row: "pair" },
      ],
      cards: [{ id: "lamp", name: "Lamp" }],
      setup: filled.map((zone) => ({ type: "createCards", card: "lamp", zone })),
    });
    const shown = view(createEngine(pack).init(1));
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    expect(zoneLayout(shown, labels)).toEqual({
      rows: [["boss"], ["low"], ["tied"], ["late", "joins"], ["first"]],
      empty: ["bare"],
      minor: [],
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

  it("leaves attributes shown in the strip out of the piece's card", () => {
    const { shown, labels } = screen();
    const walker = Object.values(shown.units).find((unit) => unit.kind === "walker");
    const stone = Object.values(shown.units).find((unit) => unit.kind === "stone");
    if (walker === undefined || stone === undefined) throw new Error("pieces missing");
    expect(shownAttributes(walker, labels)).toEqual([["grit", 5]]);
    expect(panelAttributes(walker, labels)).toEqual([]);
    expect(panelAttributes({ ...stone, attributes: { moss: 1, age: 3 } }, labels)).toEqual([
      ["moss", 1],
    ]);
    expect(panelAttributes({ ...walker, attributes: { grit: 5, extra: 2 } }, labels)).toEqual([
      ["extra", 2],
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
