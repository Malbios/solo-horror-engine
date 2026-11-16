import { describe, expect, it } from "vitest";
import { createEngine, spaceOfUnit } from "../src/core";
import { act, fixturePack, PAUSE_PHASE } from "./helpers";

const at = (space: string) => ({ space });
const create = (kind: string, id: string, space: string) => ({
  type: "createUnit",
  kind,
  id,
  placement: { onSpace: at(space) },
});
const set = (counter: string, value: unknown) => ({ type: "setCounter", counter, value });

// A line of meadows: east - mid - west. Scouts count as walkers; a hound blocks a meadow.
const base = {
  spaces: ["east", "mid", "west"].map((id) => ({ id, name: id })),
  edges: [
    { id: "em", fromSpace: "east", toSpace: "mid" },
    { id: "mw", fromSpace: "mid", toSpace: "west" },
  ],
  edgeFilters: [{ id: "any" }],
  unitKinds: [
    { id: "leader", name: "Leader" },
    { id: "walker", name: "Walker" },
    { id: "bold", name: "Bold" },
    { id: "scout", name: "Scout", countsAs: ["walker", "bold"] },
    { id: "hound", name: "Hound" },
  ],
  counters: ["walkers", "near-scout", "seen", "bold-here", "left-from-mid"].map((id) => ({
    id,
    start: 0,
  })),
};

describe("kinds that count as other kinds", () => {
  it("are counted, found, iterated and matched as the wider kind", () => {
    const engine = createEngine(
      fixturePack({
        ...base,
        triggers: [
          {
            id: "seen",
            on: { event: "unitCreated", kind: "walker" },
            effects: [{ type: "changeCounter", counter: "seen", amount: 1 }],
          },
        ],
        setup: [
          create("walker", "w1", "west"),
          create("scout", "s1", "mid"),
          set("walkers", { countUnits: { kind: "walker" } }),
          {
            type: "forEachUnit",
            units: { kind: "bold" },
            effects: [{ type: "changeCounter", counter: "bold-here", amount: 1 }],
          },
          {
            type: "if",
            condition: {
              unitIsKind: {
                unit: { closest: { kind: "walker", origin: at("east"), filter: "any" } },
                kind: "scout",
              },
            },
            then: [set("near-scout", 1)],
          },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters).toMatchObject({
      walkers: 2,
      "bold-here": 1,
      "near-scout": 1,
      seen: 2,
    });
  });

  it("let a follower filter see the destination, so one kind may follow where others may not", () => {
    const engine = createEngine(
      fixturePack({
        ...base,
        setup: [
          create("leader", "lead", "mid"),
          create("walker", "w1", "mid"),
          create("scout", "s1", "mid"),
          create("hound", "h1", "west"),
        ],
        phases: [
          {
            id: "go",
            steps: [
              {
                id: "go",
                effects: [
                  {
                    type: "stepMove",
                    unit: { id: "lead" },
                    steps: 1,
                    filter: "any",
                    followers: {
                      units: {
                        kind: "walker",
                        where: {
                          or: [
                            { eq: [{ countUnits: { kind: "hound", at: "candidate" } }, 0] },
                            { unitIsKind: { unit: "self", kind: "bold" } },
                          ],
                        },
                      },
                      max: 2,
                    },
                  },
                ],
              },
            ],
          },
          PAUSE_PHASE,
        ],
      }),
    );
    let state = engine.init(1);
    state = act(engine, state, { type: "moveTo", space: "west" });
    expect(state.pending).toEqual({ kind: "pickUnit", options: ["s1"], canPass: true });
    state = act(engine, state, { type: "pickUnit", unit: "s1" });
    expect(spaceOfUnit(state.units, "s1")).toBe("west");
    expect(spaceOfUnit(state.units, "w1")).toBe("mid");
  });

  it("tell a removal trigger which space the unit left", () => {
    const engine = createEngine(
      fixturePack({
        ...base,
        triggers: [
          {
            id: "left-mid",
            on: { event: "unitRemoved", kind: "walker" },
            condition: { eq: [{ countUnits: { kind: "hound", at: "candidate" } }, 1] },
            effects: [{ type: "changeCounter", counter: "left-from-mid", amount: 1 }],
          },
        ],
        setup: [
          create("hound", "h1", "mid"),
          create("scout", "s1", "mid"),
          create("walker", "w1", "east"),
          { type: "removeUnit", unit: { id: "s1" } },
          { type: "removeUnit", unit: { id: "w1" } },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters["left-from-mid"]).toBe(1);
  });

  it("reject a kind that is not defined", () => {
    expect(() =>
      fixturePack({ ...base, unitKinds: [{ id: "scout", name: "Scout", countsAs: ["ghost"] }] }),
    ).toThrow(/unitKind \\"ghost\\"/);
  });
});
