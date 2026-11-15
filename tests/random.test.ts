import { describe, expect, it } from "vitest";
import { createEngine } from "../src/core";
import { fixturePack, PAUSE_PHASE } from "./helpers";

const ENTRIES = ["one", "two", "three", "four", "five", "six"];

function tablePack(entries: object[], ifNone: unknown[] = []) {
  return fixturePack({
    counters: [
      { id: "picked", start: 0 },
      { id: "blocked", start: 1 },
    ],
    phases: [
      {
        id: "draw",
        steps: [{ id: "go", effects: [{ type: "randomTable", entries, ifNone }] }],
      },
      PAUSE_PHASE,
    ],
  });
}

const pickEntry = (id: string, index: number, extra: object = {}) => ({
  id,
  effects: [{ type: "setCounter", counter: "picked", value: index + 1 }],
  ...extra,
});

describe("random tables", () => {
  it("draws once over the four eligible entries of a six-entry table", () => {
    const entries = ENTRIES.map((id, index) =>
      pickEntry(
        id,
        index,
        index === 1 || index === 4 ? { when: { eq: [{ counter: "blocked" }, 0] } } : {},
      ),
    );
    const engine = createEngine(tablePack(entries));
    const results = Array.from({ length: 200 }, (_, seed) => engine.init(seed).counters["picked"]);
    expect(new Set(results)).toEqual(new Set([1, 3, 4, 6]));
    expect(engine.init(42)).toEqual(engine.init(42));
  });

  it("keeps relative weights among the eligible entries", () => {
    const entries = [
      pickEntry("rare", 0, { weight: 1 }),
      pickEntry("common", 1, { weight: 3 }),
      pickEntry("never", 2, { weight: 0 }),
    ];
    const engine = createEngine(tablePack(entries));
    const results = Array.from({ length: 400 }, (_, seed) => engine.init(seed).counters["picked"]);
    const common = results.filter((picked) => picked === 2).length;
    expect(results).not.toContain(3);
    expect(common).toBeGreaterThan(250);
    expect(common).toBeLessThan(350);
  });

  it("runs ifNone when no entry is eligible", () => {
    const entries = [pickEntry("closed", 0, { when: false })];
    const ifNone = [{ type: "setCounter", counter: "picked", value: 99 }];
    expect(createEngine(tablePack(entries, ifNone)).init(1).counters["picked"]).toBe(99);
  });
});
