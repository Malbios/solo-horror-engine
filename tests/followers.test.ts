import { describe, expect, it } from "vitest";
import { parsePack } from "../src/content";
import { createEngine, type Action, type GameState } from "../src/core";
import { act, fixturePack, PAUSE_PHASE } from "./helpers";

const place = (kind: string, id: string, space: string) => ({
  type: "createUnit",
  kind,
  id,
  placement: { onSpace: { space } },
});

const noWolfThere = { eq: [{ countUnits: { kind: "wolf", at: "candidate" } }, 0] };

const followers = (extra: object = {}) => ({
  units: { kind: "sheep" },
  max: { counter: "cap" },
  when: noWolfThere,
  ...extra,
});

const base = {
  counters: [
    { id: "cap", start: 2 },
    { id: "arrivals", start: 0 },
  ],
  spaces: ["west", "middle", "east"].map((id) => ({ id, name: id })),
  edges: [
    { id: "west-middle", fromSpace: "west", toSpace: "middle" },
    { id: "middle-east", fromSpace: "middle", toSpace: "east" },
  ],
  edgeFilters: [{ id: "any" }],
  unitKinds: ["walker", "sheep", "wolf"].map((id) => ({ id, name: id })),
};

function packWith(setup: object[], move: object, extra: object = {}) {
  return fixturePack({
    ...base,
    setup,
    phases: [{ id: "go", steps: [{ id: "go", effects: [move] }] }, PAUSE_PHASE],
    ...extra,
  });
}

const flock = [
  place("walker", "walker", "west"),
  place("sheep", "s1", "west"),
  place("sheep", "s2", "west"),
  place("sheep", "s3", "west"),
];

const walk = (steps: number, extra: object = {}) => ({
  type: "stepMove",
  unit: { id: "walker" },
  steps,
  filter: "any",
  followers: followers(extra),
});

const spaceOf = (state: GameState, unit: string) => {
  const placement = state.units[unit]?.placement;
  return placement?.type === "space" ? placement.space : null;
};

const PASS: Action = { type: "pass" };
const pick = (unit: string): Action => ({ type: "pickUnit", unit });
const moveTo = (space: string): Action => ({ type: "moveTo", space });

describe("followers", () => {
  it("lets the player pick followers up to the cap, one at a time", () => {
    const engine = createEngine(packWith(flock, walk(1)));
    let state = act(engine, engine.init(1), moveTo("middle"));
    expect(state.pending).toEqual({ kind: "pickUnit", options: ["s1", "s2", "s3"], canPass: true });
    expect(engine.legalActions(state)).toContainEqual(PASS);
    state = act(engine, state, pick("s1"));
    state = act(engine, state, pick("s3"));
    expect(["s1", "s2", "s3"].map((unit) => spaceOf(state, unit))).toEqual([
      "middle",
      "west",
      "middle",
    ]);
    expect(state.pending?.kind).not.toBe("pickUnit");
  });

  it("keeps everyone in place on pass", () => {
    const engine = createEngine(packWith(flock, walk(1)));
    const state = act(engine, act(engine, engine.init(1), moveTo("middle")), PASS);
    expect(["s1", "s2", "s3"].map((unit) => spaceOf(state, unit))).toEqual([
      "west",
      "west",
      "west",
    ]);
  });

  it("reads the cap from an expression", () => {
    const engine = createEngine(
      packWith([...flock, { type: "setCounter", counter: "cap", value: 1 }], walk(1)),
    );
    let state = act(engine, engine.init(1), moveTo("middle"));
    state = act(engine, state, pick("s2"));
    expect(state.pending?.kind).not.toBe("pickUnit");
    expect(spaceOf(state, "s2")).toBe("middle");
  });

  it("offers followers again on every step", () => {
    const engine = createEngine(packWith(flock, walk(2)));
    let state = act(engine, engine.init(1), moveTo("middle"));
    state = act(engine, state, pick("s1"));
    state = act(engine, state, PASS);
    state = act(engine, state, moveTo("west"));
    expect(state.pending).toEqual({ kind: "pickUnit", options: ["s1"], canPass: true });
  });

  it("refuses to follow into a blocked space but follows out of one", () => {
    const into = createEngine(packWith([...flock, place("wolf", "wolf", "east")], walk(2)));
    let state = act(into, into.init(1), moveTo("middle"));
    state = act(into, state, pick("s1"));
    state = act(into, state, PASS);
    state = act(into, state, moveTo("east"));
    expect(state.pending?.kind).not.toBe("pickUnit");
    expect(spaceOf(state, "s1")).toBe("middle");

    const out = createEngine(
      packWith(
        [
          place("walker", "walker", "east"),
          place("wolf", "wolf", "east"),
          place("sheep", "s1", "east"),
        ],
        walk(1),
      ),
    );
    state = act(out, act(out, out.init(1), moveTo("middle")), pick("s1"));
    expect(spaceOf(state, "s1")).toBe("middle");
  });

  it("fires movement triggers for followers", () => {
    const engine = createEngine(
      packWith(flock, walk(1), {
        triggers: [
          {
            id: "count-arrivals",
            on: { event: "unitMoved", kind: "sheep", toSpace: "middle" },
            effects: [{ type: "changeCounter", counter: "arrivals", amount: 1 }],
          },
        ],
      }),
    );
    let state = act(engine, engine.init(1), moveTo("middle"));
    state = act(engine, state, pick("s1"));
    state = act(engine, state, pick("s2"));
    expect(state.counters["arrivals"]).toBe(2);
  });

  it("works for automatic movement toward a target", () => {
    const engine = createEngine(
      packWith(flock, {
        type: "moveToward",
        unit: { id: "walker" },
        target: { space: "east" },
        steps: 1,
        filter: "any",
        followers: followers(),
      }),
    );
    const state = engine.init(1);
    expect(spaceOf(state, "walker")).toBe("middle");
    expect(state.pending).toEqual({ kind: "pickUnit", options: ["s1", "s2", "s3"], canPass: true });
  });

  it("rejects an unknown follower kind", () => {
    const parsed = parsePack({
      meta: { id: "fixture", version: "1.0.0", schemaVersion: 2, name: "Fixture" },
      base: {
        ...base,
        setup: flock,
        phases: [
          {
            id: "go",
            steps: [{ id: "go", effects: [walk(1, { units: { kind: "ghost" } })] }],
          },
        ],
      },
    });
    const issues = parsed.ok ? [] : parsed.error.issues.map((issue) => issue.message);
    expect(issues).toContain('undefined unitKind "ghost"');
  });
});
