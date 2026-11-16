import { describe, expect, it } from "vitest";
import { parsePack } from "../src/content";
import { createEngine } from "../src/core";
import { act, CONTINUE, fixturePack, PAUSE_PHASE } from "./helpers";

const change = (counter: string, amount: unknown) => ({ type: "changeCounter", counter, amount });
const call = (procedure: string, args: Record<string, unknown> = {}) => ({
  type: "call",
  procedure,
  args,
});
const arg = (name: string) => ({ arg: name });
const playEverything = {
  id: "play",
  steps: [{ id: "play", effects: [{ type: "playWindow", play: { from: "hand", to: "pile" } }] }],
};

const META = { id: "fixture", version: "1.0.0", schemaVersion: 2, name: "Fixture" };

function issuesOf(base: object, extra: object = {}): string[] {
  const parsed = parsePack({ meta: META, base, ...extra });
  return parsed.ok ? [] : parsed.error.issues.map((issue) => issue.message);
}

const gainProcedure = {
  id: "gain",
  params: ["points", "bonus"],
  effects: [change("score", arg("points")), change("extra", arg("bonus"))],
};

const counters = [
  { id: "score", start: 0 },
  { id: "extra", start: 0 },
];

describe("procedures", () => {
  it("runs one procedure from two cards with different args", () => {
    const engine = createEngine(
      fixturePack({
        counters,
        zones: [{ id: "hand" }, { id: "pile" }],
        procedures: [gainProcedure],
        cards: [
          { id: "small", name: "Small", effects: [call("gain", { points: 1, bonus: 0 })] },
          {
            id: "large",
            name: "Large",
            effects: [call("gain", { points: { add: [2, 3] }, bonus: 1 })],
          },
        ],
        setup: [
          { type: "createCards", card: "small", zone: "hand" },
          { type: "createCards", card: "large", zone: "hand" },
        ],
        phases: [playEverything],
      }),
    );
    let state = engine.init(1);
    state = act(engine, state, { type: "playCard", card: "small:1" });
    expect(state.counters).toMatchObject({ score: 1, extra: 0 });
    state = act(engine, state, { type: "playCard", card: "large:1" });
    expect(state.counters).toMatchObject({ score: 6, extra: 1 });
  });

  it("gives a nested call only its own args and restores the caller's after", () => {
    const engine = createEngine(
      fixturePack({
        counters: [...counters, { id: "inner", start: 0 }],
        procedures: [
          { id: "inner", params: ["step"], effects: [change("inner", arg("step"))] },
          {
            id: "outer",
            params: ["points"],
            effects: [
              change("score", arg("points")),
              call("inner", { step: { mul: [arg("points"), 10] } }),
              change("score", arg("points")),
            ],
          },
        ],
        setup: [call("outer", { points: 2 })],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters).toMatchObject({ score: 4, inner: 20 });
  });

  it("keeps args visible inside choices and lookups of the procedure", () => {
    const engine = createEngine(
      fixturePack({
        counters,
        procedures: [
          {
            id: "pick",
            params: ["points"],
            effects: [
              {
                type: "lookup",
                value: arg("points"),
                entries: [{ min: 3, max: 9, effects: [change("extra", arg("points"))] }],
              },
              {
                type: "choose",
                options: [{ id: "take", label: "Take", effects: [change("score", arg("points"))] }],
              },
            ],
          },
        ],
        setup: [call("pick", { points: 3 })],
        phases: [PAUSE_PHASE],
      }),
    );
    const state = act(engine, engine.init(1), { type: "chooseOption", option: "take" });
    expect(state.counters).toMatchObject({ score: 3, extra: 3 });
  });

  it("passes the calling unit through as self", () => {
    const engine = createEngine(
      fixturePack({
        spaces: [{ id: "here", name: "Here" }],
        unitKinds: [{ id: "token", name: "Token", attributes: [{ id: "size", start: 1 }] }],
        procedures: [
          {
            id: "grow",
            params: ["by"],
            effects: [
              { type: "changeAttribute", unit: "self", attribute: "size", amount: arg("by") },
            ],
          },
        ],
        setup: [
          {
            type: "createUnit",
            kind: "token",
            id: "token-a",
            placement: { onSpace: { space: "here" } },
          },
          {
            type: "forEachUnit",
            units: { kind: "token" },
            effects: [call("grow", { by: 4 })],
          },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).units["token-a"]?.attributes["size"]).toBe(5);
  });

  it("lets a module replace a procedure for every caller", () => {
    const pack = fixturePack(
      {
        counters,
        procedures: [gainProcedure],
        setup: [call("gain", { points: 1, bonus: 1 })],
        phases: [PAUSE_PHASE],
      },
      {
        modules: [
          {
            id: "double",
            kind: "variant",
            precedence: 1,
            content: {
              procedures: [
                {
                  id: "gain",
                  params: ["points", "bonus"],
                  effects: [change("score", { mul: [arg("points"), 2] })],
                },
              ],
            },
          },
        ],
        choices: [{ id: "variant", options: ["double"], min: 0, max: 1 }],
      },
    );
    const engine = createEngine(pack);
    const plain = act(engine, engine.init(1), { type: "pass" });
    expect(plain.counters).toMatchObject({ score: 1, extra: 1 });
    const doubled = act(engine, engine.init(1), { type: "pickModule", module: "double" });
    expect(doubled.counters).toMatchObject({ score: 2, extra: 0 });
    expect(act(engine, doubled, CONTINUE).round).toBe(2);
  });

  describe("pack checks", () => {
    const base = (extra: object) => ({ counters, phases: [PAUSE_PHASE], ...extra });

    it("rejects a call to an unknown procedure", () => {
      expect(issuesOf(base({ setup: [call("missing")] }))).toContain(
        'undefined procedure "missing"',
      );
    });

    it("rejects missing and unknown args", () => {
      const issues = issuesOf(
        base({ procedures: [gainProcedure], setup: [call("gain", { points: 1, size: 2 })] }),
      );
      expect(issues).toContain('call to procedure "gain" is missing arg "bonus"');
      expect(issues).toContain('call to procedure "gain" has unknown arg "size"');
    });

    it("rejects args read outside a procedure or not declared by it", () => {
      const issues = issuesOf(
        base({
          procedures: [{ id: "loose", params: [], effects: [change("score", arg("points"))] }],
          setup: [change("score", arg("points")), call("loose")],
        }),
      );
      expect(issues).toContain('arg "points" is read outside a procedure');
      expect(issues).toContain('procedure "loose" reads undeclared arg "points"');
    });

    it("rejects procedures that call themselves directly or indirectly", () => {
      expect(issuesOf(base({ procedures: [{ id: "self", effects: [call("self")] }] }))).toContain(
        "procedures call each other in a cycle: self -> self",
      );
      expect(
        issuesOf(
          base({
            procedures: [
              { id: "first", effects: [call("second")] },
              { id: "second", effects: [call("first")] },
            ],
          }),
        ),
      ).toContain("procedures call each other in a cycle: first -> second -> first");
    });

    it("rejects a cycle that only a module patch would create", () => {
      const issues = issuesOf(
        base({
          procedures: [
            { id: "first", effects: [call("second")] },
            { id: "second", effects: [] },
          ],
        }),
        {
          modules: [
            {
              id: "loop",
              kind: "variant",
              precedence: 1,
              content: { procedures: [{ id: "second", effects: [call("first")] }] },
            },
          ],
        },
      );
      expect(issues).toContain("procedures call each other in a cycle: first -> second -> first");
    });

    it("rejects repeated params", () => {
      expect(
        issuesOf(base({ procedures: [{ id: "twice", params: ["a", "a"], effects: [] }] })),
      ).toContain("params must be unique");
    });
  });
});
