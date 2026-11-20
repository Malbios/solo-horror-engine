import { describe, expect, it } from "vitest";
import { createEngine } from "../src/core";
import { fixturePack, PAUSE_PHASE } from "./helpers";

const change = (counter: string, amount: unknown) => ({ type: "changeCounter", counter, amount });
const set = (counter: string, value: unknown) => ({ type: "setCounter", counter, value });
const create = (kind: string, id: string) => ({
  type: "createUnit",
  kind,
  id,
  placement: { onSpace: { space: "field" } },
});
const removeSelf = { type: "removeUnit", unit: "self" };
const flock = [create("sheep", "s1"), create("sheep", "s2"), create("sheep", "s3")];

// One field; every removal is counted ("removed"), and a per-group trigger counts its firings ("batches") and notes
// how many removals had happened when it fired ("removed-when-fired").
const base = {
  spaces: [{ id: "field", name: "field" }],
  edges: [],
  edgeFilters: [{ id: "any" }],
  unitKinds: [
    { id: "sheep", name: "Sheep" },
    { id: "wolf", name: "Wolf" },
  ],
  counters: ["removed", "batches", "removed-when-fired", "tally", "tally-plain"].map((id) => ({
    id,
    start: 0,
  })),
};
const triggers = (on: object, plain: object[]) => [
  { id: "each", on, effects: plain },
  {
    id: "group",
    on,
    perGroup: true,
    effects: [change("batches", 1), set("removed-when-fired", { counter: "removed" })],
  },
];
const sheepRemoved = { event: "unitRemoved", kind: "sheep" };

function run(
  setup: object[],
  phases: object[] = [PAUSE_PHASE],
  on: object = sheepRemoved,
  plain: object[] = [change("removed", 1)],
) {
  return createEngine(fixturePack({ ...base, triggers: triggers(on, plain), setup, phases })).init(
    1,
  ).counters;
}

describe("per-group triggers", () => {
  it("fire once for a loop that handles several units, after the loop", () => {
    const counters = run([
      ...flock,
      { type: "forEachUnit", units: { kind: "sheep", at: null }, effects: [removeSelf] },
    ]);
    expect(counters["removed"]).toBe(3);
    expect(counters["batches"]).toBe(1);
    expect(counters["removed-when-fired"]).toBe(3);
  });

  it("fire again for separate effects", () => {
    const counters = run([
      ...flock,
      { type: "removeUnit", unit: { id: "s1" } },
      { type: "removeUnit", unit: { id: "s2" } },
    ]);
    expect(counters["batches"]).toBe(2);
  });

  it("do not group events about units other than the one the loop is working on", () => {
    const eachWolfTakesASheep = {
      type: "forEachUnit",
      units: { kind: "wolf", at: null },
      effects: [
        {
          type: "removeUnit",
          unit: { closest: { kind: "sheep", origin: { space: "field" }, filter: "any" } },
        },
      ],
    };
    const counters = run([
      ...flock,
      create("wolf", "w1"),
      create("wolf", "w2"),
      eachWolfTakesASheep,
    ]);
    expect(counters["removed"]).toBe(2);
    expect(counters["batches"]).toBe(2);
  });

  it("group a counter change made while the loop works on a unit", () => {
    const tallyEach = {
      type: "forEachUnit",
      units: { kind: "sheep", at: null },
      effects: [change("tally", 1)],
    };
    const counters = run(
      [...flock, tallyEach],
      [PAUSE_PHASE],
      { event: "counterChanged", counter: "tally" },
      [change("tally-plain", 1)],
    );
    expect(counters["tally-plain"]).toBe(3);
    expect(counters["batches"]).toBe(1);
  });

  it("still fire when the loop is cut short by its scope ending", () => {
    const cull = {
      id: "cull",
      steps: [
        {
          id: "cull",
          effects: [
            {
              type: "forEachUnit",
              units: { kind: "sheep", at: null },
              effects: [removeSelf, { type: "endScope", scope: "phase" }],
            },
          ],
        },
      ],
    };
    const counters = run(flock, [cull, PAUSE_PHASE]);
    expect(counters["removed"]).toBe(1);
    expect(counters["batches"]).toBe(1);
  });
});
