import { describe, expect, it } from "vitest";
import { createEngine, type Action, type GameState } from "../src/core";
import { act, fixturePack, PAUSE_PHASE } from "./helpers";

const place = (kind: string, id: string, space: string) => ({
  type: "createUnit",
  kind,
  id,
  placement: { onSpace: { space } },
});

const SPACES = ["west", "middle", "east", "far"];

function packWith(setup: object[], move: object, extra: object = {}) {
  return fixturePack({
    counters: [{ id: "halt", start: 0 }],
    spaces: SPACES.map((id) => ({ id, name: id, tags: id === "middle" ? ["corridor"] : [] })),
    edges: SPACES.slice(1).map((id, index) => ({
      id: `${SPACES[index]}-${id}`,
      fromSpace: SPACES[index],
      toSpace: id,
    })),
    edgeFilters: [{ id: "any" }],
    unitKinds: ["walker", "sheep"].map((id) => ({ id, name: id })),
    setup,
    phases: [{ id: "go", steps: [{ id: "go", effects: [move] }] }, PAUSE_PHASE],
    ...extra,
  });
}

const walk = (steps: number, extra: object = {}) => ({
  type: "stepMove",
  unit: { id: "walker" },
  steps,
  filter: "any",
  ...extra,
});

const spaceOf = (state: GameState, unit: string) => {
  const placement = state.units[unit]?.placement;
  return placement?.type === "space" ? placement.space : null;
};

const moveTo = (space: string): Action => ({ type: "moveTo", space });
const intoCorridor = { spaceHasTag: { at: "candidate", tag: "corridor" } };

describe("free steps", () => {
  it("does not count a step into a space where the condition holds", () => {
    const engine = createEngine(
      packWith([place("walker", "walker", "west")], walk(1, { freeWhen: intoCorridor })),
    );
    let state = act(engine, engine.init(1), moveTo("middle"));
    expect(state.pending).toMatchObject({ kind: "moveUnit", options: ["east", "west"] });
    state = act(engine, state, moveTo("east"));
    expect(spaceOf(state, "walker")).toBe("east");
    expect(state.pending?.kind).not.toBe("moveUnit");
  });
});

describe("steps resolved by effects", () => {
  const slideEast = {
    when: { eq: [{ countUnits: { kind: "walker", at: { space: "west" } } }, 1] },
    effects: [{ type: "placeUnit", unit: "self", placement: { onSpace: { space: "middle" } } }],
  };
  const followers = { units: { kind: "sheep" }, max: 1, when: true };

  it("runs the effects as one step and offers followers to where the mover ended", () => {
    const engine = createEngine(
      packWith(
        [place("walker", "walker", "west"), place("sheep", "s1", "west")],
        walk(2, { instead: slideEast, followers }),
      ),
    );
    let state = engine.init(1);
    expect(spaceOf(state, "walker")).toBe("middle");
    expect(state.pending).toEqual({ kind: "pickUnit", options: ["s1"], canPass: true });
    state = act(engine, state, { type: "pickUnit", unit: "s1" });
    expect(spaceOf(state, "s1")).toBe("middle");
    expect(state.pending).toMatchObject({ kind: "moveUnit", options: ["east", "west"] });
    state = act(engine, state, moveTo("east"));
    expect(state.pending?.kind).not.toBe("moveUnit");
  });
});

describe("stop condition", () => {
  const haltOnArrival = {
    id: "halt-on-arrival",
    on: { event: "unitMoved", kind: "walker", toSpace: "middle" },
    condition: true,
    effects: [{ type: "setCounter", counter: "halt", value: 1 }],
  };
  const halted = { eq: [{ counter: "halt" }, 1] };

  it("ends a chosen move when a trigger made it true", () => {
    const engine = createEngine(
      packWith([place("walker", "walker", "west")], walk(3, { stopWhen: halted }), {
        triggers: [haltOnArrival],
      }),
    );
    const state = act(engine, engine.init(1), moveTo("middle"));
    expect(spaceOf(state, "walker")).toBe("middle");
    expect(state.pending?.kind).not.toBe("moveUnit");
  });

  it("ends an automatic move when a trigger made it true", () => {
    const engine = createEngine(
      packWith(
        [place("walker", "walker", "west")],
        {
          type: "moveToward",
          unit: { id: "walker" },
          target: { space: "far" },
          steps: 3,
          filter: "any",
          stopWhen: halted,
        },
        { triggers: [haltOnArrival] },
      ),
    );
    expect(spaceOf(engine.init(1), "walker")).toBe("middle");
  });
});
