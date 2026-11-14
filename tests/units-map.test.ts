import { describe, expect, it } from "vitest";
import { createEngine, replay, spaceOfUnit, type Action } from "../src/core";
import { act, CONTINUE, fixturePack, PAUSE_PHASE } from "./helpers";

const change = (counter: string, amount: unknown) => ({ type: "changeCounter", counter, amount });
const set = (counter: string, value: unknown) => ({ type: "setCounter", counter, value });
const at = (space: string) => ({ space });
const onSpace = (space: string) => ({ onSpace: at(space) });
const unit = (id: string) => ({ id });
const create = (kind: string, id: string, placement: unknown) => ({
  type: "createUnit",
  kind,
  id,
  placement,
});
const distance = (origin: string, destination: string, filter = "any", ifUnreachable = -1) => ({
  distance: { origin: at(origin), destination: at(destination), filter, ifUnreachable },
});

const LINE = {
  spaces: ["a", "b", "c", "d"].map((id) => ({ id, name: id, tags: id === "b" ? ["mid"] : [] })),
  edges: [
    { id: "ab", fromSpace: "a", toSpace: "b" },
    { id: "bc", fromSpace: "b", toSpace: "c" },
    { id: "cd", fromSpace: "c", toSpace: "d" },
  ],
  edgeFilters: [{ id: "any" }],
};

describe("location and containment", () => {
  it("moves units inside a container along with it", () => {
    const engine = createEngine(
      fixturePack({
        ...LINE,
        unitKinds: [
          { id: "carrier", name: "Carrier" },
          { id: "rider", name: "Rider" },
        ],
        counters: [
          { id: "carrier-moves", start: 0 },
          { id: "rider-moves", start: 0 },
        ],
        triggers: [
          {
            id: "c",
            on: { event: "unitMoved", kind: "carrier" },
            effects: [change("carrier-moves", 1)],
          },
          {
            id: "r",
            on: { event: "unitMoved", kind: "rider" },
            effects: [change("rider-moves", 1)],
          },
        ],
        setup: [
          create("carrier", "cart", onSpace("a")),
          create("rider", "passenger", { inside: unit("cart") }),
        ],
        phases: [
          {
            id: "drive",
            steps: [
              {
                id: "go",
                effects: [
                  {
                    type: "moveToward",
                    unit: unit("cart"),
                    target: at("c"),
                    steps: 5,
                    filter: "any",
                  },
                ],
              },
            ],
          },
          PAUSE_PHASE,
        ],
      }),
    );
    const state = engine.init(1);
    expect(state.units["passenger"]?.placement).toEqual({ type: "inside", unit: "cart" });
    expect(spaceOfUnit(state.units, "passenger")).toBe("c");
    const placedOnCreation = 1;
    expect(state.counters).toEqual({
      "carrier-moves": placedOnCreation + 2,
      "rider-moves": placedOnCreation,
    });
  });

  it("keeps the id and shared attributes when a unit changes kind", () => {
    const engine = createEngine(
      fixturePack({
        unitKinds: [
          {
            id: "pawn",
            name: "Pawn",
            attributes: [
              { id: "health", start: 3 },
              { id: "speed", start: 1 },
            ],
          },
          {
            id: "knight",
            name: "Knight",
            attributes: [
              { id: "health", start: 5 },
              { id: "armour", start: 2 },
            ],
          },
        ],
        setup: [
          create("pawn", "unit-a", { offMap: true }),
          { type: "changeAttribute", unit: unit("unit-a"), attribute: "health", amount: -1 },
          { type: "changeKind", unit: unit("unit-a"), kind: "knight" },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).units["unit-a"]).toEqual({
      id: "unit-a",
      kind: "knight",
      placement: { type: "offMap" },
      attributes: { health: 2, armour: 2 },
    });
  });

  it("never reuses the id of a removed unit", () => {
    const engine = createEngine(
      fixturePack({
        unitKinds: [{ id: "pawn", name: "Pawn" }],
        setup: [
          create("pawn", "unit-a", { offMap: true }),
          { type: "removeUnit", unit: unit("unit-a") },
          create("pawn", "unit-a", { offMap: true }),
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    const state = engine.init(1);
    expect(state.status).toBe("faulted");
    expect(state.fault).toContain("unit-a");
  });
});

describe("graph queries", () => {
  it("changes a distance when an edge is retargeted", () => {
    const engine = createEngine(
      fixturePack({
        ...LINE,
        counters: [
          { id: "before", start: 0 },
          { id: "after", start: 0 },
        ],
        setup: [
          set("before", distance("a", "d")),
          { type: "retargetEdge", edge: "bc", toSpace: "d" },
          set("after", distance("a", "d")),
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters).toEqual({ before: 3, after: 2 });
  });

  it("uses the unreachable value and skips effects on an unresolved unit", () => {
    const engine = createEngine(
      fixturePack({
        ...LINE,
        spaces: [...LINE.spaces, { id: "island", name: "Island" }],
        unitKinds: [{ id: "target", name: "Target" }],
        counters: [{ id: "far", start: 0 }],
        setup: [
          set("far", distance("a", "island", "any", 99)),
          create("target", "lost", onSpace("island")),
          {
            type: "placeUnit",
            unit: { closest: { kind: "target", origin: at("a"), filter: "any" } },
            placement: onSpace("b"),
          },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    const state = engine.init(1);
    expect(state.counters["far"]).toBe(99);
    expect(spaceOfUnit(state.units, "lost")).toBe("island");
  });

  it("honours edge direction", () => {
    const engine = createEngine(
      fixturePack({
        spaces: [
          { id: "x", name: "X" },
          { id: "y", name: "Y" },
        ],
        edges: [{ id: "xy", fromSpace: "x", toSpace: "y", directed: true }],
        edgeFilters: [{ id: "any" }],
        counters: [
          { id: "forward", start: 0 },
          { id: "backward", start: 0 },
        ],
        setup: [set("forward", distance("x", "y")), set("backward", distance("y", "x"))],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters).toEqual({ forward: 1, backward: -1 });
  });

  it("evaluates gates per filter while placement ignores the graph", () => {
    const engine = createEngine(
      fixturePack({
        spaces: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
        edges: [
          { id: "ab", fromSpace: "a", toSpace: "b", gate: { gte: [{ counter: "open" }, 1] } },
        ],
        edgeFilters: [
          { id: "gated", useGates: true },
          { id: "ignoring", useGates: false },
        ],
        unitKinds: [{ id: "token", name: "Token" }],
        counters: [
          { id: "open", start: 0 },
          { id: "gated", start: 0 },
          { id: "ignoring", start: 0 },
        ],
        setup: [
          set("gated", distance("a", "b", "gated")),
          set("ignoring", distance("a", "b", "ignoring")),
          create("token", "piece", onSpace("a")),
          { type: "placeUnit", unit: unit("piece"), placement: onSpace("b") },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    const state = engine.init(1);
    expect(state.counters).toEqual({ open: 0, gated: -1, ignoring: 1 });
    expect(spaceOfUnit(state.units, "piece")).toBe("b");
  });
});

describe("stepwise movement", () => {
  const moverPack = (stopWhen: unknown) =>
    fixturePack({
      ...LINE,
      unitKinds: [{ id: "mover", name: "Mover" }],
      counters: [{ id: "seen-middle", start: 0 }],
      checks: [
        {
          id: "middle",
          condition: {
            and: [
              { spaceHasTag: { at: { locationOf: unit("runner") }, tag: "mid" } },
              { eq: [{ counter: "seen-middle" }, 0] },
            ],
          },
          effects: [set("seen-middle", 1)],
        },
      ],
      setup: [create("mover", "runner", onSpace("a"))],
      phases: [
        {
          id: "run",
          steps: [
            {
              id: "go",
              effects: [
                {
                  type: "moveToward",
                  unit: unit("runner"),
                  target: at("d"),
                  steps: 3,
                  filter: "any",
                  stopWhen,
                },
              ],
            },
          ],
        },
        PAUSE_PHASE,
      ],
    });

  it("takes one step per frame so checks see the intermediate space", () => {
    const state = createEngine(moverPack(false)).init(1);
    expect(spaceOfUnit(state.units, "runner")).toBe("d");
    expect(state.counters["seen-middle"]).toBe(1);
  });

  it("stops early when the stop condition holds", () => {
    const stopAtMiddle = { spaceHasTag: { at: { locationOf: "self" }, tag: "mid" } };
    const state = createEngine(moverPack(stopAtMiddle)).init(1);
    expect(spaceOfUnit(state.units, "runner")).toBe("b");
  });

  it("lets the player choose each step and stop early", () => {
    const engine = createEngine(
      fixturePack({
        ...LINE,
        unitKinds: [{ id: "hero", name: "Hero" }],
        setup: [create("hero", "player", onSpace("b"))],
        phases: [
          {
            id: "walk",
            steps: [
              {
                id: "go",
                effects: [{ type: "stepMove", unit: unit("player"), steps: 2, filter: "any" }],
              },
            ],
          },
          PAUSE_PHASE,
        ],
      }),
    );
    let state = engine.init(1);
    expect(engine.legalActions(state)).toEqual([
      { type: "moveTo", space: "a" },
      { type: "moveTo", space: "c" },
      { type: "pass" },
    ]);
    const actions: Action[] = [{ type: "moveTo", space: "c" }, { type: "pass" }];
    state = act(engine, state, actions[0] as Action);
    expect(engine.legalActions(state)).toEqual([
      { type: "moveTo", space: "b" },
      { type: "moveTo", space: "d" },
      { type: "pass" },
    ]);
    state = act(engine, state, actions[1] as Action);
    expect(spaceOfUnit(state.units, "player")).toBe("c");
    expect(engine.legalActions(state)).toEqual([CONTINUE]);
    expect(replay(engine, 1, actions)).toEqual({ ok: true, value: state });
  });
});

describe("unit attributes and space counters", () => {
  it("bounds attributes, keeps per-space counters and iterates units in id order", () => {
    const tagged = (id: string, value: number) => [
      create("piece", id, onSpace("a")),
      { type: "setAttribute", unit: unit(id), attribute: "label", value },
    ];
    const engine = createEngine(
      fixturePack({
        ...LINE,
        unitKinds: [
          {
            id: "piece",
            name: "Piece",
            attributes: [
              { id: "charge", start: 0, max: 3, onOverflow: [change("spill", 1)] },
              { id: "label", start: 0 },
            ],
          },
        ],
        spaceCounters: [{ id: "noise", start: 0 }],
        counters: [
          { id: "spill", start: 0 },
          { id: "trace", start: 0 },
        ],
        setup: [
          ...tagged("u-c", 3),
          ...tagged("u-a", 1),
          ...tagged("u-b", 2),
          { type: "changeAttribute", unit: unit("u-a"), attribute: "charge", amount: 5 },
          { type: "changeSpaceCounter", at: at("b"), spaceCounter: "noise", amount: 2 },
          {
            type: "forEachUnit",
            units: { kind: "piece" },
            effects: [
              set("trace", {
                add: [{ mul: [{ counter: "trace" }, 10] }, { attribute: "label", of: "self" }],
              }),
            ],
          },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    const state = engine.init(1);
    expect(state.units["u-a"]?.attributes["charge"]).toBe(3);
    expect(state.counters).toEqual({ spill: 2, trace: 123 });
    expect(state.spaceCounters["b"]).toEqual({ noise: 2 });
    expect(state.spaceCounters["a"]).toEqual({ noise: 0 });
  });
});

describe("demo pack movement", () => {
  it("offers the walker's neighbours after setup", async () => {
    const { loadDemoPack } = await import("./helpers");
    const engine = createEngine(loadDemoPack());
    const state = act(engine, engine.init(1), { type: "pass" });
    expect(engine.legalActions(state)).toEqual([
      { type: "moveTo", space: "centre" },
      { type: "moveTo", space: "east" },
      { type: "moveTo", space: "west" },
      { type: "pass" },
    ]);
  });
});
