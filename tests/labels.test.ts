import { describe, expect, it } from "vitest";
import { createEngine, view, viewActions, viewEvents } from "../src/core";
import {
  createLabels,
  describeAction,
  describeDecision,
  describeEvent,
  displayRules,
  HIDDEN_CARD_NAME,
  moduleInfo,
  rolledDice,
} from "../src/ui/labels";
import { fixturePack, loadDemoPack, PAUSE_PHASE } from "./helpers";

const SECRET = "grey-oval";

function hiddenPack() {
  return fixturePack({
    counters: [{ id: "tally", name: "Tally", start: 0 }],
    zones: [
      { id: "stack", name: "Stack", face: "down" },
      { id: "spent", name: "Spent", face: "down" },
    ],
    cards: [{ id: SECRET, name: "Grey Oval", copies: 2 }],
    setup: [{ type: "createCards", card: SECRET, zone: "stack" }],
    phases: [
      {
        id: "play",
        steps: [
          {
            id: "go",
            effects: [
              {
                type: "choose",
                options: [
                  {
                    id: "dump",
                    label: "Dump",
                    cost: [{ discard: { from: "stack", to: "spent", count: 1 } }],
                    effects: [{ type: "changeCounter", counter: "tally", amount: 2 }],
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
}

describe("labels", () => {
  it("names counters, zones and changes from the pack", () => {
    const pack = hiddenPack();
    const engine = createEngine(pack);
    const start = engine.init(3);
    const outcome = engine.step(start, { type: "chooseOption", option: "dump" });
    if (!outcome.ok) throw new Error("step failed");
    const picked = viewActions(outcome.value.state)[0];
    if (picked === undefined) throw new Error("no pick offered");
    const finished = engine.step(outcome.value.state, picked);
    if (!finished.ok) throw new Error("pick failed");
    const shown = view(finished.value.state);
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    const lines = viewEvents(finished.value.events, finished.value.state).map((event) =>
      describeEvent(event, shown, labels),
    );
    expect(lines).toContain("1 card: Stack to Spent");
    expect(lines).toContain("Tally +2 (now 2)");
  });

  it("leaves changes to hidden counters out of the log", () => {
    const pack = fixturePack({
      counters: [{ id: "tally", name: "Tally", start: 0, hidden: true }],
    });
    const shown = view(createEngine(pack).init(3));
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    const change = { type: "counterChanged", counter: "tally", from: 0, to: 1 } as const;
    expect(describeEvent(change, shown, labels)).toBeNull();
  });

  it("leaves helper pieces out of the log and names a piece already gone by its kind", () => {
    const pack = fixturePack({
      unitKinds: [
        { id: "pin", name: "Pin", bookkeeping: true },
        { id: "walker", name: "Walker" },
      ],
    });
    const shown = view(createEngine(pack).init(3));
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    const lines = [
      { type: "unitCreated", unit: "pin#1", kind: "pin" },
      { type: "unitMoved", unit: "pin#1", kind: "pin", fromSpace: null, toSpace: "a" },
      { type: "unitRemoved", unit: "pin#1", kind: "pin", fromSpace: "a" },
      { type: "unitCreated", unit: "walker#7", kind: "walker" },
    ] as const;
    expect(lines.map((event) => describeEvent(event, shown, labels))).toEqual([
      null,
      null,
      null,
      "Walker appears",
    ]);
  });

  it("counts the named symbols of a roll", () => {
    const pack = fixturePack({
      dice: [
        {
          id: "cube",
          faces: [
            { id: "blank", symbols: {} },
            { id: "star", symbols: { star: 1, dot: 1 } },
          ],
          symbols: [{ id: "star", name: "star", plural: "stars" }],
        },
      ],
    });
    const shown = view(createEngine(pack).init(3));
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    const roll = (faces: string[]) =>
      describeEvent(
        {
          type: "diceRolled",
          pool: "tray",
          dice: faces.map((face, index) => ({
            id: `d${index + 1}`,
            die: "cube",
            face,
            role: null,
          })),
        },
        shown,
        labels,
      );
    expect(roll(["star", "blank"])).toBe("Rolled star, blank: 1 star");
    expect(roll(["star", "star"])).toBe("Rolled star, star: 2 stars");
    expect(roll(["blank"])).toBe("Rolled blank: 0 stars");
  });

  it("draws each rolled die with its face label in its type's colours", () => {
    const pack = fixturePack({
      dice: [
        {
          id: "cube",
          color: "teal",
          labelColor: "ivory",
          faces: [
            { id: "blank", symbols: {} },
            { id: "star", symbols: { star: 1 }, label: "*" },
          ],
        },
        { id: "plain", faces: [{ id: "dot", symbols: {} }] },
      ],
    });
    const rules = displayRules(pack, view(createEngine(pack).init(3)).modules);
    const die = (type: string, face: string) => ({ id: "d1", die: type, face, role: null });
    expect(
      rolledDice([die("cube", "star"), die("cube", "blank"), die("plain", "dot")], rules),
    ).toEqual([
      { label: "*", color: "teal", labelColor: "ivory" },
      { label: "blank", color: "teal", labelColor: "ivory" },
      { label: "dot", color: null, labelColor: null },
    ]);
  });

  it("never names a face-down card in actions or the log", () => {
    const pack = hiddenPack();
    const engine = createEngine(pack);
    const outcome = engine.step(engine.init(3), { type: "chooseOption", option: "dump" });
    if (!outcome.ok) throw new Error("step failed");
    const { state, events } = outcome.value;
    const shown = view(state);
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    const text = JSON.stringify([
      viewActions(state).map((action) => describeAction(action, shown, labels)),
      viewEvents(events, state).map((event) => describeEvent(event, shown, labels)),
    ]);
    expect(text).not.toContain("Grey Oval");
    expect(text).not.toContain(SECRET);
    expect(text).toContain(HIDDEN_CARD_NAME);
  });

  it("names the zone of a face-down card that is resolved, never the card", () => {
    const pack = fixturePack({
      counters: [{ id: "tally", name: "Tally", start: 0 }],
      zones: [
        {
          id: "omen",
          name: "Omen",
          face: "down",
          backEffects: [{ type: "changeCounter", counter: "tally", amount: 1 }],
        },
      ],
      cards: [{ id: SECRET, name: "Grey Oval" }],
      setup: [
        { type: "createCards", card: SECRET, zone: "omen" },
        { type: "resolveCard", zone: "omen", to: null },
      ],
      phases: [PAUSE_PHASE],
    });
    const engine = createEngine(pack);
    const state = engine.init(3);
    const shown = view(state);
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    const ref = shown.zones["omen"]?.[0]?.ref ?? "";
    expect(describeEvent({ type: "cardResolved", card: ref }, shown, labels)).toBe(
      `Resolved ${HIDDEN_CARD_NAME} (Omen)`,
    );
    expect(state.counters["tally"]).toBe(1);
  });

  it("shows a window's own prompt with counters filled in, else the generic one", () => {
    const windowPack = (prompt: string | null) =>
      fixturePack({
        counters: [{ id: "dmg", start: 3, hidden: true }],
        phases: [
          { id: "react", steps: [{ id: "go", effects: [{ type: "playWindow", prompt }] }] },
          PAUSE_PHASE,
        ],
      });
    const promptOf = (prompt: string | null) => {
      const pack = windowPack(prompt);
      const shown = view(createEngine(pack).init(1));
      return describeDecision(shown, createLabels(displayRules(pack, shown.modules), shown));
    };
    expect(promptOf("Hit for {dmg}: react or pass ({nope})")).toBe(
      "Hit for 3: react or pass ({nope})",
    );
    expect(promptOf(null)).toBe("Choose an action or pass");
  });

  it("offers a module with its note, and without one when the pack gives none", () => {
    const pack = loadDemoPack();
    const engine = createEngine(pack);
    const state = engine.init(1);
    const shown = view(state);
    const labels = createLabels(displayRules(pack, shown.modules), shown, moduleInfo(pack));
    expect(labels.module("bonus-cards")).toBe("bonus-cards");
    expect(labels.moduleNote("bonus-cards")).toBe("Adds two extra cards to the deck");
    expect(labels.moduleNote("missing-module")).toBeNull();
    const plain = fixturePack({ phases: [PAUSE_PHASE] });
    expect([...moduleInfo(plain).values()].every((info) => info.note === null)).toBe(true);
  });

  it("names pieces by kind and space, never by id", () => {
    const create = (id: string, kind: string, space: string) => ({
      type: "createUnit",
      kind,
      id,
      placement: { onSpace: { space } },
    });
    const pack = fixturePack({
      spaces: [
        { id: "mill", name: "Mill" },
        { id: "pond", name: "Pond" },
      ],
      edges: [{ id: "mp", fromSpace: "mill", toSpace: "pond" }],
      unitKinds: [
        { id: "walker", name: "Walker" },
        { id: "guide", name: "Guide" },
      ],
      setup: [
        create("guide-a", "guide", "pond"),
        create("w1", "walker", "mill"),
        create("w2", "walker", "mill"),
        create("w3", "walker", "pond"),
      ],
      phases: [PAUSE_PHASE],
    });
    const engine = createEngine(pack);
    const state = engine.init(1);
    const shown = view(state);
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    expect(labels.unit("guide-a")).toBe("Guide");
    expect(labels.unit("w2")).toBe("Walker 2 at Mill");
    expect(labels.unit("w3")).toBe("Walker at Pond");
    expect(labels.piece("w1")).toBe("Walker 1");
    expect(
      describeEvent(
        { type: "unitMoved", unit: "w3", kind: "walker", fromSpace: "mill", toSpace: "pond" },
        shown,
        labels,
      ),
    ).toBe("Walker moves from Mill to Pond");
  });

  it("uses names for the demo pack's spaces and pieces", () => {
    const pack = loadDemoPack();
    const engine = createEngine(pack);
    let state = engine.init(5);
    for (let attempt = 0; attempt < 10 && state.pending?.kind !== "moveUnit"; attempt++) {
      const action = engine.legalActions(state)[0];
      if (action === undefined) break;
      const outcome = engine.step(state, action);
      if (!outcome.ok) throw new Error("step failed");
      state = outcome.value.state;
    }
    const shown = view(state);
    const labels = createLabels(displayRules(pack, shown.modules), shown);
    const moves = viewActions(state)
      .filter((action) => action.type === "moveTo")
      .map((action) => describeAction(action, shown, labels));
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((line) => /^Move to [A-Z][a-z]+$/.test(line))).toBe(true);
  });
});
