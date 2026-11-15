import { describe, expect, it } from "vitest";
import { parsePack } from "../src/content";
import { createEngine, view, viewEvents } from "../src/core";
import { act, CONTINUE, fixturePack, PAUSE_PHASE } from "./helpers";

const change = (counter: string, amount: number) => ({ type: "changeCounter", counter, amount });
const create = (card: string, zone: string) => ({ type: "createCards", card, zone });
const resolve = (zone: string, to: string | null = null, ifEmpty: object[] = []) => ({
  type: "resolveCard",
  zone,
  to,
  ifEmpty,
});

const counters = [
  { id: "score", start: 0 },
  { id: "back", start: 0 },
  { id: "empty", start: 0 },
  { id: "coins", start: 0, min: 0 },
];

const zones = [
  { id: "deck", face: "down" },
  { id: "table" },
  { id: "used" },
  { id: "secret", face: "down", backEffects: [change("back", 1)] },
];

const cards = [
  { id: "bright", name: "Bright", effects: [change("score", 3)] },
  {
    id: "stubborn",
    name: "Stubborn",
    playable: false,
    cost: [{ counter: "coins", amount: 5 }],
    effects: [change("score", 10)],
  },
  {
    id: "relay",
    name: "Relay",
    effects: [{ type: "moveCards", from: "table", to: "used", count: 1 }, resolve("deck", "table")],
  },
];

function packWith(setup: object[]) {
  return fixturePack({ counters, zones, cards, setup, phases: [PAUSE_PHASE] });
}

const META = { id: "fixture", version: "1.0.0", schemaVersion: 2, name: "Fixture" };

describe("resolving cards", () => {
  it("reveals a drawn card and runs its effects without a decision", () => {
    const engine = createEngine(packWith([create("bright", "deck"), resolve("deck", "table")]));
    const state = engine.init(1);
    expect(state.zones["table"]).toEqual(["bright:1"]);
    expect(state.faceUp["bright:1"]).toBe(true);
    expect(state.counters["score"]).toBe(3);
  });

  it("runs the zone's back effects for a face-down card and keeps it hidden", () => {
    const engine = createEngine(
      fixturePack({
        counters,
        zones,
        cards,
        setup: [create("bright", "secret")],
        phases: [
          {
            id: "reveal",
            steps: [
              {
                id: "wait",
                effects: [{ type: "choose", options: [{ id: "continue", label: "Continue" }] }],
              },
              {
                id: "back",
                effects: [
                  resolve("secret"),
                  { type: "choose", options: [{ id: "continue", label: "Continue" }] },
                ],
              },
              {
                id: "front",
                effects: [{ type: "turnCards", zone: "secret", face: "up" }, resolve("secret")],
              },
              {
                id: "end",
                effects: [{ type: "choose", options: [{ id: "continue", label: "Continue" }] }],
              },
            ],
          },
        ],
      }),
    );
    const before = engine.init(1);
    const outcome = engine.step(before, CONTINUE);
    if (!outcome.ok) throw new Error("step failed");
    const hidden = outcome.value.state;
    expect(hidden.counters).toMatchObject({ back: 1, score: 0 });
    expect(JSON.stringify(view(hidden))).not.toContain("bright");
    expect(JSON.stringify(viewEvents(outcome.value.events, hidden))).not.toContain("bright");
    const revealed = act(engine, hidden, CONTINUE);
    expect(revealed.counters).toMatchObject({ back: 1, score: 3 });
  });

  it("runs ifEmpty when the zone has no cards", () => {
    const engine = createEngine(packWith([resolve("deck", "table", [change("empty", 1)])]));
    expect(engine.init(1).counters["empty"]).toBe(1);
  });

  it("lets a card move itself on and resolve the next one", () => {
    const engine = createEngine(
      packWith([create("relay", "deck"), create("bright", "deck"), resolve("deck", "table")]),
    );
    const state = engine.init(1);
    expect(state.zones["used"]).toEqual(["relay:1"]);
    expect(state.zones["table"]).toEqual(["bright:1"]);
    expect(state.counters["score"]).toBe(3);
  });

  it("ignores play conditions and costs", () => {
    const engine = createEngine(packWith([create("stubborn", "deck"), resolve("deck", "table")]));
    const state = engine.init(1);
    expect(state.counters).toMatchObject({ score: 10, coins: 0 });
  });

  it("marks a step that reveals a card as an undo barrier", () => {
    const engine = createEngine(
      fixturePack({
        counters,
        zones,
        cards,
        setup: [create("bright", "deck")],
        phases: [
          {
            id: "draw",
            steps: [
              {
                id: "wait",
                effects: [{ type: "choose", options: [{ id: "continue", label: "Continue" }] }],
              },
              { id: "draw", effects: [resolve("deck", "table")] },
            ],
          },
          PAUSE_PHASE,
        ],
      }),
    );
    const start = engine.init(1);
    const outcome = engine.step(start, CONTINUE);
    if (!outcome.ok) throw new Error("step failed");
    expect(outcome.value.state.counters["score"]).toBe(3);
    expect(outcome.value.undoBarrier).toBe(true);
  });

  it("rejects an unknown zone", () => {
    const parsed = parsePack({
      meta: META,
      base: { counters, zones, cards, setup: [resolve("nowhere")], phases: [PAUSE_PHASE] },
    });
    const issues = parsed.ok ? [] : parsed.error.issues.map((issue) => issue.message);
    expect(issues).toContain('undefined zone "nowhere"');
  });
});
