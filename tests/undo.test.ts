import { describe, expect, it } from "vitest";
import { canUndo, createEngine, undo, type Action } from "../src/core";
import { fixturePack, PAUSE_PHASE } from "./helpers";

const PICK: Action = { type: "chooseOption", option: "go" };

function undoPack(revealing: unknown[]) {
  return fixturePack({
    counters: [{ id: "marks", start: 0 }],
    zones: [{ id: "stack", face: "down" }, { id: "open" }],
    cards: [{ id: "slip", name: "Slip", copies: 3 }],
    dice: [{ id: "coin", faces: [{ id: "heads" }, { id: "tails" }] }],
    pools: [{ id: "toss" }],
    setup: [{ type: "createCards", card: "slip", zone: "stack" }],
    phases: [
      {
        id: "act",
        steps: [
          {
            id: "go",
            effects: [
              {
                type: "choose",
                options: [{ id: "go", label: "Go", effects: revealing }],
              },
            ],
          },
        ],
      },
      PAUSE_PHASE,
    ],
  });
}

const cases: [string, unknown[]][] = [
  ["a shuffle", [{ type: "shuffle", zone: "stack" }]],
  ["a dice roll", [{ type: "rollDice", pool: "toss", die: "coin", count: 1 }]],
  [
    "a random table draw",
    [
      {
        type: "randomTable",
        entries: [
          { id: "a", effects: [] },
          { id: "b", effects: [] },
        ],
      },
    ],
  ],
  ["a peek", [{ type: "peek", zone: "stack", count: 1 }]],
  ["a card turned face up", [{ type: "turnCards", zone: "stack", count: 1, face: "up" }]],
  ["a card moved face up", [{ type: "moveCards", from: "stack", to: "open", count: 1 }]],
];

describe("undo barriers", () => {
  it("allows undo after a decision that revealed nothing", () => {
    const engine = createEngine(undoPack([{ type: "changeCounter", counter: "marks", amount: 1 }]));
    const outcome = engine.step(engine.init(1), PICK);
    expect(outcome.ok && outcome.value.undoBarrier).toBe(false);
    expect(canUndo(engine, 1, [PICK])).toBe(true);
    const undone = undo(engine, 1, [PICK]);
    expect(undone.ok && undone.value.actions).toEqual([]);
  });

  it.each(cases)("refuses undo after %s", (_, revealing) => {
    const engine = createEngine(undoPack(revealing));
    const outcome = engine.step(engine.init(1), PICK);
    expect(outcome.ok && outcome.value.undoBarrier).toBe(true);
    expect(canUndo(engine, 1, [PICK])).toBe(false);
    expect(undo(engine, 1, [PICK])).toEqual({ ok: false, error: { type: "undoBlocked" } });
  });

  it("allows undo again for actions after the barrier", () => {
    const engine = createEngine(undoPack([{ type: "shuffle", zone: "stack" }]));
    const actions: Action[] = [PICK, { type: "chooseOption", option: "continue" }];
    expect(canUndo(engine, 1, actions)).toBe(true);
  });

  it("refuses undo with an empty log", () => {
    const engine = createEngine(undoPack([]));
    expect(undo(engine, 1, [])).toEqual({ ok: false, error: { type: "undoBlocked" } });
  });
});
