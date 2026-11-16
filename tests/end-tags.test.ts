import { describe, expect, it } from "vitest";
import { createEngine, type GameState } from "../src/core";
import { act, fixturePack, PAUSE_PHASE } from "./helpers";

const place = (kind: string, id: string, space: string) => ({
  type: "createUnit",
  kind,
  id,
  placement: { onSpace: { space } },
});

// pond - reeds - hill, plus pond - meadow. The "slide" tag counts only when leaving the reeds side
// of reeds-hill and the pond side of pond-meadow.
const base = {
  counters: [{ id: "far", start: 0 }],
  spaces: ["pond", "reeds", "hill", "meadow"].map((id) => ({ id, name: id })),
  edges: [
    {
      id: "pond-reeds",
      fromSpace: "pond",
      toSpace: "reeds",
      fromTags: ["slide"],
      toTags: ["slide"],
    },
    { id: "reeds-hill", fromSpace: "reeds", toSpace: "hill", fromTags: ["slide"] },
    {
      id: "pond-meadow",
      fromSpace: "pond",
      toSpace: "meadow",
      toTags: ["climb"],
      fromTags: ["slide"],
    },
  ],
  edgeFilters: [
    { id: "any" },
    { id: "slide", requireTags: ["slide"] },
    { id: "climb", requireTags: ["climb"] },
    { id: "no-slide", excludeTags: ["slide"] },
  ],
  unitKinds: ["frog", "heron"].map((id) => ({ id, name: id })),
};

function packWith(setup: object[], effects: object[]) {
  return fixturePack({
    ...base,
    setup,
    phases: [{ id: "go", steps: [{ id: "go", effects }] }, PAUSE_PHASE],
  });
}

const spaceOf = (state: GameState, unit: string) => {
  const placement = state.units[unit]?.placement;
  return placement?.type === "space" ? placement.space : null;
};

const step = (filter: string, forced: boolean, steps = 1) => ({
  type: "stepMove",
  unit: { id: "frog" },
  steps,
  filter,
  forced,
});

describe("end tags", () => {
  it("offer an edge only when it is left from the tagged end", () => {
    const fromReeds = createEngine(
      packWith([place("frog", "frog", "reeds")], [step("slide", false)]),
    );
    expect(fromReeds.init(1).pending).toEqual({
      kind: "moveUnit",
      unit: "frog",
      options: ["hill", "pond"],
      canPass: true,
    });
    const fromHill = createEngine(
      packWith([place("frog", "frog", "hill")], [step("slide", false)]),
    );
    expect(fromHill.init(1).pending?.kind).not.toBe("moveUnit");
    const fromMeadow = createEngine(
      packWith([place("frog", "frog", "meadow")], [step("climb", false)]),
    );
    expect(fromMeadow.init(1).pending).toMatchObject({ kind: "moveUnit", options: ["pond"] });
  });

  it("are excluded by a filter only from their own end", () => {
    const engine = createEngine(
      packWith([place("frog", "frog", "hill")], [step("no-slide", false)]),
    );
    expect(engine.init(1).pending).toMatchObject({ kind: "moveUnit", options: ["reeds"] });
  });

  it("set distances by direction, also when walking toward a target", () => {
    const distance = {
      type: "setCounter",
      counter: "far",
      value: {
        distance: {
          origin: { space: "reeds" },
          destination: { space: "meadow" },
          filter: "slide",
          ifUnreachable: 99,
        },
      },
    };
    const back = {
      type: "setCounter",
      counter: "far",
      value: {
        add: [
          { counter: "far" },
          {
            mul: [
              100,
              {
                distance: {
                  origin: { space: "meadow" },
                  destination: { space: "reeds" },
                  filter: "slide",
                  ifUnreachable: 99,
                },
              },
            ],
          },
        ],
      },
    };
    const state = createEngine(packWith([], [distance, back])).init(1);
    expect(state.counters["far"]).toBe(2 + 100 * 99);

    const toward = {
      type: "moveToward",
      unit: { id: "heron" },
      target: { space: "meadow" },
      steps: 5,
      filter: "slide",
    };
    const heron = createEngine(packWith([place("heron", "heron", "hill")], [toward])).init(1);
    expect(spaceOf(heron, "heron")).toBe("hill");
    const fromReeds = createEngine(packWith([place("heron", "heron", "reeds")], [toward])).init(1);
    expect(spaceOf(fromReeds, "heron")).toBe("meadow");
  });

  it("work on edges added during play", () => {
    const added = {
      type: "addEdge",
      edge: { id: "hill-meadow", fromSpace: "hill", toSpace: "meadow", toTags: ["climb"] },
    };
    const engine = createEngine(
      packWith([place("frog", "frog", "meadow")], [added, step("climb", false)]),
    );
    expect(engine.init(1).pending).toMatchObject({ kind: "moveUnit", options: ["hill", "pond"] });
  });
});

describe("forced steps", () => {
  it("take the only possible step without asking", () => {
    const engine = createEngine(packWith([place("frog", "frog", "hill")], [step("any", true)]));
    const state = engine.init(1);
    expect(spaceOf(state, "frog")).toBe("reeds");
    expect(state.pending?.kind).not.toBe("moveUnit");
  });

  it("ask without a pass when several steps are possible, and keep going", () => {
    const engine = createEngine(packWith([place("frog", "frog", "reeds")], [step("any", true, 2)]));
    let state = engine.init(1);
    expect(state.pending).toEqual({
      kind: "moveUnit",
      unit: "frog",
      options: ["hill", "pond"],
      canPass: false,
    });
    expect(engine.legalActions(state)).not.toContainEqual({ type: "pass" });
    state = act(engine, state, { type: "moveTo", space: "hill" });
    expect(spaceOf(state, "frog")).toBe("reeds");
  });

  it("stop when no step is possible", () => {
    const engine = createEngine(packWith([place("frog", "frog", "hill")], [step("slide", true)]));
    const state = engine.init(1);
    expect(spaceOf(state, "frog")).toBe("hill");
  });
});
