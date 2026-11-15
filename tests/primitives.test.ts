import { describe, expect, it } from "vitest";
import { createEngine, replay, type Action } from "../src/core";
import { act, CONTINUE, deepFreeze, fixturePack, PAUSE_PHASE } from "./helpers";

const change = (counter: string, amount: unknown) => ({ type: "changeCounter", counter, amount });
const set = (counter: string, value: unknown) => ({ type: "setCounter", counter, value });
const appendDigit = (digit: number) =>
  set("trace", { add: [{ mul: [{ counter: "trace" }, 10] }, digit] });

describe("decision loop", () => {
  const engine = createEngine(
    fixturePack({
      zones: [{ id: "pile" }, { id: "line" }],
      cards: ["alpha", "beta", "gamma"].map((id) => ({ id, name: id })),
      setup: ["alpha", "beta", "gamma"].map((card) => ({
        type: "createCards",
        card,
        zone: "pile",
      })),
      phases: [
        {
          id: "arrange",
          steps: [{ id: "place", effects: [{ type: "playWindow", from: "pile", to: "line" }] }],
        },
      ],
      endConditions: [
        { id: "placed", condition: { eq: [{ zoneCount: "line" }, 3] }, outcome: "win" },
      ],
    }),
  );

  it("orders three cards as three single picks", () => {
    let state = engine.init(1);
    expect(engine.legalActions(state)).toEqual([
      { type: "playCard", card: "alpha:1" },
      { type: "playCard", card: "beta:1" },
      { type: "playCard", card: "gamma:1" },
      { type: "pass" },
    ]);
    state = act(engine, state, { type: "playCard", card: "gamma:1" });
    expect(engine.legalActions(state)).toHaveLength(3);
    state = act(engine, state, { type: "playCard", card: "alpha:1" });
    state = act(engine, state, { type: "playCard", card: "beta:1" });
    expect(state.zones["line"]).toEqual(["beta:1", "alpha:1", "gamma:1"]);
    expect(state.outcome).toEqual({ result: "win", endCondition: "placed" });
  });

  it("rejects an action that is not legal without changing state", () => {
    const state = deepFreeze(engine.init(1));
    const before = structuredClone(state);
    const action: Action = { type: "chooseOption", option: "continue" };
    expect(engine.step(state, action)).toEqual({
      ok: false,
      error: { type: "illegalAction", action },
    });
    expect(state).toEqual(before);
  });

  it("presents a decision with exactly one option instead of resolving it", () => {
    const single = createEngine(fixturePack({ phases: [PAUSE_PHASE] }));
    expect(single.legalActions(single.init(1))).toEqual([CONTINUE]);
  });

  it("skips a choice whose options are all unavailable", () => {
    const skipping = createEngine(
      fixturePack({
        phases: [
          {
            id: "skip",
            steps: [
              {
                id: "never",
                effects: [
                  { type: "choose", options: [{ id: "hidden", label: "Hidden", when: false }] },
                ],
              },
            ],
          },
          PAUSE_PHASE,
        ],
      }),
    );
    expect(skipping.legalActions(skipping.init(1))).toEqual([CONTINUE]);
  });
});

describe("setup as decisions", () => {
  const extraModule = (id: string, amount: number) => ({
    id,
    kind: "extra",
    precedence: 1,
    content: { setup: [change("total", amount)] },
  });
  const engine = createEngine(
    fixturePack(
      { counters: [{ id: "total", start: 0 }], phases: [PAUSE_PHASE] },
      {
        modules: [extraModule("small", 1), extraModule("large", 10)],
        choices: [{ id: "extras", options: ["small", "large"], min: 0, max: 2 }],
      },
    ),
  );

  it("applies chosen modules and replays from the log", () => {
    const actions: Action[] = [
      { type: "pickModule", module: "large" },
      { type: "pickModule", module: "small" },
    ];
    const state = actions.reduce((current, action) => act(engine, current, action), engine.init(5));
    expect(state.modules).toEqual(["large", "small"]);
    expect(state.counters["total"]).toBe(11);
    expect(replay(engine, 5, actions)).toEqual({ ok: true, value: state });
  });

  it("allows passing once the minimum is reached", () => {
    let state = engine.init(5);
    state = act(engine, state, { type: "pickModule", module: "large" });
    state = act(engine, state, { type: "pass" });
    expect(state.counters["total"]).toBe(10);
  });

  it("faults when the composed rules reference something a module removed", () => {
    const broken = createEngine(
      fixturePack(
        {
          counters: [{ id: "kept", start: 0 }],
          phases: [
            { id: "use", steps: [{ id: "bump", effects: [change("kept", 1)] }] },
            PAUSE_PHASE,
          ],
        },
        {
          modules: [
            { id: "strip", kind: "variant", precedence: 1, remove: { counters: ["kept"] } },
          ],
          choices: [{ id: "variant", options: ["strip"], min: 0, max: 1 }],
        },
      ),
    );
    const result = broken.step(broken.init(1), { type: "pickModule", module: "strip" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("engineFault");
  });
});

describe("triggers", () => {
  it("reacts to applied effects and honours once", () => {
    const engine = createEngine(
      fixturePack({
        counters: ["a", "b", "c"].map((id) => ({ id, start: 0 })),
        triggers: [
          {
            id: "follow",
            on: { event: "counterChanged", counter: "a" },
            effects: [change("b", 1)],
          },
          {
            id: "first-only",
            on: { event: "counterChanged", counter: "a" },
            once: true,
            effects: [change("c", 1)],
          },
        ],
        phases: [{ id: "bump", steps: [{ id: "a", effects: [change("a", 1)] }] }, PAUSE_PHASE],
      }),
    );
    let state = engine.init(1);
    expect(state.counters).toEqual({ a: 1, b: 1, c: 1 });
    state = act(engine, state, CONTINUE);
    expect(state.counters).toEqual({ a: 2, b: 2, c: 1 });
  });
});

describe("expressions", () => {
  it("computes cards in a zone with a minimum of 1", () => {
    const atLeastOne = { max: [{ zoneCount: "stack" }, 1] };
    const engine = createEngine(
      fixturePack({
        counters: [
          { id: "empty-result", start: 0 },
          { id: "full-result", start: 0 },
        ],
        zones: [{ id: "stack" }],
        cards: [{ id: "token", name: "Token", copies: 3 }],
        setup: [
          set("empty-result", atLeastOne),
          { type: "createCards", card: "token", zone: "stack" },
          set("full-result", atLeastOne),
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters).toEqual({ "empty-result": 1, "full-result": 3 });
  });
});

describe("resolution stack", () => {
  const counters = ["a", "b", "trace"].map((id) => ({ id, start: 0 }));

  it("resolves a trigger chain before the remaining queued effect", () => {
    const engine = createEngine(
      fixturePack({
        counters,
        triggers: [
          {
            id: "a-to-b",
            on: { event: "counterChanged", counter: "a" },
            effects: [change("b", 1)],
          },
          {
            id: "b-to-trace",
            on: { event: "counterChanged", counter: "b" },
            effects: [appendDigit(1)],
          },
        ],
        setup: [change("a", 1), appendDigit(2)],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters["trace"]).toBe(12);
  });

  const runaway = {
    counters: [{ id: "spin", start: 0 }],
    triggers: [
      {
        id: "again",
        on: { event: "counterChanged", counter: "spin" },
        effects: [change("spin", 1)],
      },
    ],
  };

  it("faults a runaway loop during a step and leaves state unchanged", () => {
    const engine = createEngine(
      fixturePack({
        ...runaway,
        phases: [
          {
            id: "ask",
            steps: [
              {
                id: "choice",
                effects: [
                  {
                    type: "choose",
                    options: [
                      { id: "start", label: "Start", effects: [change("spin", 1)] },
                      { id: "rest", label: "Rest" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const state = deepFreeze(engine.init(1));
    const before = structuredClone(state);
    const result = engine.step(state, { type: "chooseOption", option: "start" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("engineFault");
    expect(state).toEqual(before);
  });

  it("marks the state as faulted when setup runs away", () => {
    const engine = createEngine(
      fixturePack({ ...runaway, setup: [change("spin", 1)], phases: [PAUSE_PHASE] }),
    );
    const state = engine.init(1);
    expect(state.status).toBe("faulted");
    expect(engine.legalActions(state)).toEqual([]);
    const result = engine.step(state, CONTINUE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("engineFault");
  });
});

describe("scopes", () => {
  it("runs exit hooks and resets when a phase is cut short", () => {
    const engine = createEngine(
      fixturePack({
        counters: [
          { id: "exits", start: 0 },
          { id: "skipped", start: 0 },
          { id: "per-round", start: 0, resetScope: "round" },
        ],
        phases: [
          {
            id: "cut",
            onExit: [change("exits", 1)],
            steps: [
              {
                id: "bump",
                effects: [change("per-round", 1), { type: "endScope", scope: "phase" }],
              },
              { id: "never", effects: [change("skipped", 1)] },
            ],
          },
          PAUSE_PHASE,
        ],
      }),
    );
    let state = engine.init(1);
    expect(state.counters).toEqual({ exits: 1, skipped: 0, "per-round": 1 });
    state = act(engine, state, CONTINUE);
    expect(state.round).toBe(2);
    expect(state.counters).toEqual({ exits: 2, skipped: 0, "per-round": 1 });
  });
});

describe("counters", () => {
  it("clamps to bounds and runs overflow and underflow effects per excess unit", () => {
    const engine = createEngine(
      fixturePack({
        counters: [
          { id: "high", start: 5, max: 7, onOverflow: [change("spilled-up", 1)] },
          { id: "spilled-up", start: 0 },
          { id: "low", start: 0, min: 0, onUnderflow: [change("spilled-down", 1)] },
          { id: "spilled-down", start: 0 },
        ],
        setup: [change("high", 4), change("low", -2)],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters).toEqual({
      high: 7,
      "spilled-up": 2,
      low: 0,
      "spilled-down": 2,
    });
  });
});

describe("state-based checks", () => {
  it("resolves simultaneous checks one at a time in pack order", () => {
    const engine = createEngine(
      fixturePack({
        counters: ["a", "b", "trace"].map((id) => ({ id, start: 0 })),
        checks: [
          {
            id: "a-empty",
            condition: { lte: [{ counter: "a" }, 0] },
            effects: [appendDigit(1), set("a", 5)],
          },
          {
            id: "b-empty",
            condition: { lte: [{ counter: "b" }, 0] },
            effects: [appendDigit(2), set("b", 5)],
          },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).counters["trace"]).toBe(12);
  });

  it("stops running checks once the game is ending", () => {
    const engine = createEngine(
      fixturePack({
        counters: [{ id: "x", start: 0 }],
        endConditions: [{ id: "over", condition: false, outcome: "loss" }],
        checks: [
          {
            id: "still-true",
            condition: { gte: [{ counter: "x" }, 0] },
            effects: [{ type: "endGame", endCondition: "over" }],
          },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    const state = engine.init(1);
    expect(state.status).toBe("finished");
    expect(state.outcome).toEqual({ result: "loss", endCondition: "over" });
  });

  it.each([
    ["loss", "win"],
    ["win", "loss"],
  ])("resolves a simultaneous %s and %s by pack order", (first, second) => {
    const always = { gte: [{ counter: "x" }, 1] };
    const engine = createEngine(
      fixturePack({
        counters: [{ id: "x", start: 1 }],
        endConditions: [
          { id: "first", condition: always, outcome: first },
          { id: "second", condition: always, outcome: second },
        ],
        phases: [PAUSE_PHASE],
      }),
    );
    expect(engine.init(1).outcome).toEqual({ result: first, endCondition: "first" });
  });
});

describe("cards and zones", () => {
  it("returns a discard zone to the draw zone at a scope exit", () => {
    const engine = createEngine(
      fixturePack({
        zones: [{ id: "draw", face: "down" }, { id: "discard" }],
        cards: [{ id: "token", name: "Token", copies: 2 }],
        setup: [{ type: "createCards", card: "token", zone: "discard" }],
        round: {
          onExit: [
            {
              type: "moveCards",
              from: "discard",
              to: "draw",
              count: { zoneCount: "discard" },
              position: "bottom",
            },
          ],
        },
        phases: [PAUSE_PHASE],
      }),
    );
    let state = engine.init(1);
    expect(state.zones).toEqual({ draw: [], discard: ["token:1", "token:2"] });
    state = act(engine, state, CONTINUE);
    expect(state.zones).toEqual({ draw: ["token:1", "token:2"], discard: [] });
    expect(state.faceUp).toEqual({ "token:1": false, "token:2": false });
  });
});

describe("modules and layering", () => {
  const engine = createEngine(
    fixturePack(
      {
        counters: [{ id: "score", start: 0 }],
        zones: [{ id: "hand" }, { id: "played" }],
        cards: [{ id: "plain", name: "Plain", effects: [change("score", 1)] }],
        setup: [{ type: "createCards", card: "plain", zone: "hand" }],
        phases: [
          {
            id: "play",
            steps: [
              { id: "window", effects: [{ type: "playWindow", from: "hand", to: "played" }] },
            ],
          },
        ],
      },
      {
        modules: [
          {
            id: "boosted",
            kind: "variant",
            precedence: 1,
            content: { cards: [{ id: "plain", name: "Plain", effects: [change("score", 5)] }] },
          },
        ],
        choices: [{ id: "variant", options: ["boosted"], min: 0, max: 1 }],
      },
    ),
  );
  const playPlain: Action = { type: "playCard", card: "plain:1" };

  it("uses the base card without the module", () => {
    const state = act(engine, act(engine, engine.init(1), { type: "pass" }), playPlain);
    expect(state.counters["score"]).toBe(1);
  });

  it("replaces the card by id when the module is chosen", () => {
    const chosen = act(engine, engine.init(1), { type: "pickModule", module: "boosted" });
    expect(act(engine, chosen, playPlain).counters["score"]).toBe(5);
  });
});

describe("end sequences", () => {
  it("ends when a zone empties and scores two counters", () => {
    const engine = createEngine(
      fixturePack({
        counters: [
          { id: "points", start: 4 },
          { id: "bonus", start: 0 },
        ],
        zones: [{ id: "deck" }, { id: "hand" }],
        cards: [{ id: "token", name: "Token", copies: 2 }],
        setup: [{ type: "createCards", card: "token", zone: "deck" }],
        phases: [
          {
            id: "draw",
            steps: [
              { id: "one", effects: [{ type: "moveCards", from: "deck", to: "hand", count: 1 }] },
            ],
          },
        ],
        endConditions: [
          {
            id: "deck-empty",
            condition: { eq: [{ zoneCount: "deck" }, 0] },
            sequence: [change("bonus", 2)],
            outcome: {
              when: { gt: [{ counter: "points" }, { counter: "bonus" }] },
              then: "win",
              else: "loss",
            },
          },
        ],
      }),
    );
    const state = engine.init(1);
    expect(state.status).toBe("finished");
    expect(state.round).toBe(2);
    expect(state.counters["bonus"]).toBe(2);
    expect(state.outcome).toEqual({ result: "win", endCondition: "deck-empty" });
  });
});
