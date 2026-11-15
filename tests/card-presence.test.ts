import { describe, expect, it } from "vitest";
import { parsePack } from "../src/content";
import { createEngine } from "../src/core";
import { act, CONTINUE, fixturePack, PAUSE_PHASE } from "./helpers";

const create = (card: string, zone: string) => ({ type: "createCards", card, zone });
const countCards = (zone: string, card: string | null = null, tag: string | null = null) => ({
  countCards: { zone, card, tag },
});
const record = (counter: string, value: object) => ({ type: "setCounter", counter, value });

const counters = ["all", "bycard", "bytag", "fired", "glow"].map((id) => ({ id, start: 0 }));

const zones = [{ id: "shelf" }, { id: "box", face: "down" }, { id: "bin" }];

const cards = [
  { id: "lamp", name: "Lamp", tags: ["bright"] },
  { id: "torch", name: "Torch", tags: ["bright"] },
  { id: "stone", name: "Stone" },
];

const META = { id: "fixture", version: "1.0.0", schemaVersion: 2, name: "Fixture" };

describe("card presence", () => {
  it("counts face-up cards by id, by tag and in total", () => {
    const engine = createEngine(
      fixturePack({
        counters,
        zones,
        cards,
        setup: [
          create("lamp", "shelf"),
          create("torch", "shelf"),
          create("stone", "shelf"),
          create("lamp", "box"),
          record("all", countCards("shelf")),
          record("bycard", countCards("shelf", "lamp")),
          record("bytag", countCards("shelf", null, "bright")),
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters).toMatchObject({ all: 3, bycard: 1, bytag: 2 });
  });

  it("ignores face-down cards until they turn face up", () => {
    const engine = createEngine(
      fixturePack({
        counters,
        zones,
        cards,
        setup: [
          create("lamp", "box"),
          record("all", countCards("box", "lamp")),
          { type: "turnCards", zone: "box", face: "up" },
          record("bycard", countCards("box", "lamp")),
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters).toMatchObject({ all: 0, bycard: 1 });
  });

  it("switches a trigger on only while the card is in the zone", () => {
    const engine = createEngine(
      fixturePack({
        counters,
        zones,
        cards,
        setup: [create("lamp", "shelf")],
        triggers: [
          {
            id: "lamp-reacts",
            on: { event: "scopeEntered", scope: "round" },
            condition: { gte: [countCards("shelf", "lamp"), 1] },
            effects: [{ type: "changeCounter", counter: "fired", amount: 1 }],
          },
        ],
        phases: [
          {
            id: "clear",
            steps: [
              {
                id: "wait",
                effects: [{ type: "choose", options: [{ id: "continue", label: "Continue" }] }],
              },
              { id: "clear", effects: [{ type: "moveCards", from: "shelf", to: "bin", count: 1 }] },
            ],
          },
        ],
      }),
    );
    let state = engine.init(1);
    expect(state.counters["fired"]).toBe(1);
    state = act(engine, state, CONTINUE);
    state = act(engine, state, CONTINUE);
    expect(state.round).toBe(3);
    expect(state.counters["fired"]).toBe(1);
  });

  it("switches a modifier on while the card is in the zone", () => {
    const pack = (setup: object[]) =>
      fixturePack({
        counters,
        zones,
        cards,
        quantityTypes: [{ id: "shine", target: { counter: "glow" }, direction: "increase" }],
        modifiers: [
          {
            id: "lamp-boost",
            quantity: "shine",
            condition: { gte: [countCards("shelf", null, "bright"), 1] },
            action: { increase: 2 },
          },
        ],
        setup: [...setup, { type: "deliver", quantity: "shine", amount: 1 }],
        phases: [PAUSE_PHASE],
      });
    expect(createEngine(pack([])).init(1).counters["glow"]).toBe(1);
    expect(createEngine(pack([create("torch", "shelf")])).init(1).counters["glow"]).toBe(3);
  });

  it("rejects unknown cards and zones", () => {
    const parsed = parsePack({
      meta: META,
      base: {
        counters,
        zones,
        cards,
        setup: [record("all", countCards("nowhere", "ghost"))],
        phases: [PAUSE_PHASE],
      },
    });
    const issues = parsed.ok ? [] : parsed.error.issues.map((issue) => issue.message);
    expect(issues).toContain('undefined zone "nowhere"');
    expect(issues).toContain('undefined card "ghost"');
  });
});
