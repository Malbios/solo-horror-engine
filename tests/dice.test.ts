import { describe, expect, it } from "vitest";
import { createEngine, replay, type Action, type GameState } from "../src/core";
import { act, CONTINUE, fixturePack, PAUSE_PHASE } from "./helpers";

const change = (counter: string, amount: unknown) => ({ type: "changeCounter", counter, amount });
const set = (counter: string, value: unknown) => ({ type: "setCounter", counter, value });
const count = (symbol: string | null, role: string | null = null) => ({
  diceCount: { pool: "pool", symbol, role },
});

const SIX_SIDED = {
  id: "six",
  faces: [
    { id: "dud" },
    { id: "dud" },
    { id: "half", symbols: { half: 1 } },
    { id: "half", symbols: { half: 1 } },
    { id: "hit", symbols: { hit: 1 } },
    { id: "hit", symbols: { hit: 1 } },
  ],
};

const COUNTERS = ["size", "hits", "halves", "dice", "heard", "first", "second", "gold"].map(
  (id) => ({
    id,
    start: 0,
  }),
);

function dicePack(effects: unknown[], extra: object = {}) {
  return fixturePack({
    dice: [SIX_SIDED],
    pools: [{ id: "pool" }],
    counters: COUNTERS,
    phases: [{ id: "roll", steps: [{ id: "go", effects }] }, PAUSE_PHASE],
    ...extra,
  });
}

const tally = [set("hits", count("hit")), set("halves", count("half")), set("dice", count(null))];

const faces = (state: GameState) => (state.pools["pool"] ?? []).map((die) => die.face);

describe("dice", () => {
  it("rolls a pool sized by an expression, with stable ids and symbol counts", () => {
    const pack = dicePack([
      set("size", 4),
      { type: "rollDice", pool: "pool", die: "six", count: { add: [{ counter: "size" }, 1] } },
      ...tally,
    ]);
    const engine = createEngine(pack);
    const state = engine.init(7);
    const pool = state.pools["pool"] ?? [];
    expect(pool.map((die) => die.id)).toEqual(["d1", "d2", "d3", "d4", "d5"]);
    expect(state.counters["dice"]).toBe(5);
    expect(state.counters["hits"]).toBe(faces(state).filter((face) => face === "hit").length);
    expect(state.counters["halves"]).toBe(faces(state).filter((face) => face === "half").length);
    expect(engine.init(7)).toEqual(state);
  });

  it("adds dice to an existing pool, continuing the ids, and announces each roll", () => {
    const pack = dicePack(
      [
        { type: "rollDice", pool: "pool", die: "six", count: 2 },
        { type: "addDice", pool: "pool", die: "six", count: 1 },
      ],
      {
        triggers: [
          {
            id: "listen",
            on: { event: "diceRolled", pool: "pool" },
            effects: [change("heard", 1)],
          },
        ],
      },
    );
    const state = createEngine(pack).init(3);
    expect((state.pools["pool"] ?? []).map((die) => die.id)).toEqual(["d1", "d2", "d3"]);
    expect(state.counters["heard"]).toBe(2);
  });

  it("assigns two dice to two roles, one pick at a time", () => {
    const pack = dicePack([
      { type: "rollDice", pool: "pool", die: "six", count: 2 },
      {
        type: "assignDice",
        pool: "pool",
        roles: [
          { role: "aim", count: 1 },
          { role: "guide", count: 1 },
        ],
      },
      set("first", count(null, "aim")),
      set("second", count(null, "guide")),
    ]);
    const engine = createEngine(pack);
    let state = engine.init(5);
    expect(state.pending).toEqual({
      kind: "pickDie",
      pool: "pool",
      dice: ["d1", "d2"],
      canPass: false,
    });
    state = act(engine, state, { type: "pickDie", die: "d2" });
    expect(state.pending?.kind).not.toBe("pickDie");
    expect(state.pools["pool"]?.map((die) => [die.id, die.role])).toEqual([
      ["d1", "guide"],
      ["d2", "aim"],
    ]);
    expect(state.counters["first"]).toBe(1);
    expect(state.counters["second"]).toBe(1);
  });

  it("rerolls every die showing a listed face", () => {
    const pack = dicePack([
      { type: "rollDice", pool: "pool", die: "six", count: 6 },
      { type: "rerollDice", pool: "pool", faces: ["hit", "half"] },
    ]);
    const engine = createEngine(pack);
    const rolledOnly = createEngine(
      dicePack([{ type: "rollDice", pool: "pool", die: "six", count: 6 }]),
    ).init(11);
    const rerolled = engine.init(11);
    faces(rolledOnly).forEach((face, index) => {
      if (face === "dud") expect(faces(rerolled)[index]).toBe("dud");
    });
    expect(rerolled.rng).not.toEqual(rolledOnly.rng);
  });

  it("rerolls chosen dice together once the player passes", () => {
    const pack = dicePack([
      { type: "rollDice", pool: "pool", die: "six", count: 3 },
      { type: "rerollDice", pool: "pool", mode: "choose" },
    ]);
    const engine = createEngine(pack);
    let state = engine.init(2);
    const before = faces(state);
    expect(engine.legalActions(state)).toEqual([
      { type: "pickDie", die: "d1" },
      { type: "pickDie", die: "d2" },
      { type: "pickDie", die: "d3" },
      { type: "pass" },
    ]);
    state = act(engine, state, { type: "pickDie", die: "d2" });
    expect(state.pending).toEqual({
      kind: "pickDie",
      pool: "pool",
      dice: ["d1", "d3"],
      canPass: true,
    });
    const rngBefore = state.rng;
    state = act(engine, state, { type: "pass" });
    expect(faces(state)[0]).toBe(before[0]);
    expect(faces(state)[2]).toBe(before[2]);
    expect(state.rng).not.toEqual(rngBefore);
    expect(state.pending?.kind).toBe("chooseOption");
  });

  it("stops a chosen reroll once the most dice allowed are picked", () => {
    const pack = dicePack([
      { type: "rollDice", pool: "pool", die: "six", count: 3 },
      { type: "rerollDice", pool: "pool", mode: "choose", max: 1 },
    ]);
    const engine = createEngine(pack);
    let state = engine.init(2);
    const before = faces(state);
    const rngBefore = state.rng;
    state = act(engine, state, { type: "pickDie", die: "d3" });
    expect(state.pending?.kind).toBe("chooseOption");
    expect(faces(state).slice(0, 2)).toEqual(before.slice(0, 2));
    expect(state.rng).not.toEqual(rngBefore);
  });
  it("turns a chosen die to another face, paid for with a discard", () => {
    const pack = dicePack(
      [
        { type: "createCards", card: "chip", zone: "hand" },
        { type: "rollDice", pool: "pool", die: "six", count: 4 },
        { type: "setDieFace", pool: "pool", faces: ["dud", "half"], toFace: "hit" },
        set("hits", count("hit")),
      ],
      {
        zones: [{ id: "hand" }, { id: "pile" }],
        cards: [{ id: "chip", name: "Chip", copies: 2 }],
      },
    );
    const engine = createEngine(pack);
    let state = engine.init(13);
    const before = faces(state).filter((face) => face === "hit").length;
    expect(state.pending?.kind).toBe("pickDie");
    const legal = engine.legalActions(state);
    const choice = legal[0];
    if (choice?.type !== "pickDie") throw new Error("expected a die to pick");
    state = act(engine, state, choice);
    expect(state.counters["hits"]).toBe(before + 1);
  });

  it("changes a face without asking when every eligible die looks the same", () => {
    const pack = dicePack([
      { type: "rollDice", pool: "pool", die: "six", count: 4 },
      { type: "setDieFace", pool: "pool", faces: ["dud", "half"], toFace: "hit" },
      set("hits", count("hit")),
    ]);
    const state = createEngine(pack).init(8);
    expect(faces(state)).toEqual(["hit", "hit", "hit", "half"]);
    expect(state.counters["hits"]).toBe(3);
    expect(state.pending?.kind).not.toBe("pickDie");
  });

  it("replays dice decisions from the log", () => {
    const pack = dicePack([
      { type: "rollDice", pool: "pool", die: "six", count: 3 },
      { type: "rerollDice", pool: "pool", mode: "choose" },
      ...tally,
    ]);
    const engine = createEngine(pack);
    const actions: Action[] = [
      { type: "pickDie", die: "d1" },
      { type: "pickDie", die: "d3" },
      { type: "pass" },
      CONTINUE,
    ];
    let state = engine.init(21);
    for (const action of actions) state = act(engine, state, action);
    const replayed = replay(engine, 21, actions);
    expect(replayed.ok && replayed.value).toEqual(state);
  });
});

describe("lookup", () => {
  const lookupPack = (value: number) =>
    dicePack([
      {
        type: "lookup",
        value,
        entries: [
          { min: 1, max: 2, effects: [set("first", 1)] },
          { min: 3, max: 6, effects: [set("second", 1)] },
        ],
        otherwise: [set("gold", 1)],
      },
    ]);

  it("runs the first entry whose range holds the value", () => {
    const low = createEngine(lookupPack(2)).init(1);
    expect([low.counters["first"], low.counters["second"]]).toEqual([1, 0]);
    const high = createEngine(lookupPack(5)).init(1);
    expect([high.counters["first"], high.counters["second"]]).toEqual([0, 1]);
  });

  it("falls back to otherwise when no range holds the value", () => {
    expect(createEngine(lookupPack(9)).init(1).counters["gold"]).toBe(1);
  });
});
