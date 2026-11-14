import { describe, expect, it } from "vitest";
import { createEngine } from "../src/core";
import { act, CONTINUE, fixturePack, PAUSE_PHASE } from "./helpers";

const change = (counter: string, amount: unknown) => ({ type: "changeCounter", counter, amount });
const deliver = (quantity: string, amount: unknown, recipient: unknown = null) => ({
  type: "deliver",
  quantity,
  amount,
  recipient,
});
const appendTrace = (digit: number) => ({
  type: "setCounter",
  counter: "trace",
  value: { add: [{ mul: [{ counter: "trace" }, 10] }, digit] },
});

const QUANTITIES = {
  counters: ["glow", "chill", "other", "trace", "used", "heard"].map((id) => ({ id, start: 0 })),
  quantityTypes: [
    { id: "spark", target: { counter: "glow" }, direction: "increase" },
    { id: "frost", target: { counter: "chill" }, direction: "increase" },
  ],
};

function quantityPack(effects: unknown[], extra: object = {}) {
  return fixturePack({
    ...QUANTITIES,
    phases: [{ id: "hit", steps: [{ id: "go", effects }] }, PAUSE_PHASE],
    ...extra,
  });
}

describe("typed quantities", () => {
  it("routes two quantity types to two different counters", () => {
    const state = createEngine(quantityPack([deliver("spark", 3), deliver("frost", 2)])).init(1);
    expect(state.counters["glow"]).toBe(3);
    expect(state.counters["chill"]).toBe(2);
  });

  it("routes an attribute quantity to the recipient unit and announces the delivery", () => {
    const pack = quantityPack([deliver("wear", 2, { id: "post" })], {
      spaces: [{ id: "yard", name: "Yard" }],
      unitKinds: [{ id: "post", name: "Post", attributes: [{ id: "sturdiness", start: 5 }] }],
      quantityTypes: [
        ...QUANTITIES.quantityTypes,
        { id: "wear", target: { attribute: "sturdiness" }, direction: "decrease" },
      ],
      triggers: [
        {
          id: "listen",
          on: { event: "quantityDelivered", quantity: "wear", kind: "post" },
          effects: [change("heard", { context: "amount" })],
        },
      ],
      setup: [
        { type: "createUnit", kind: "post", id: "post", placement: { onSpace: { space: "yard" } } },
      ],
    });
    const state = createEngine(pack).init(1);
    expect(state.units["post"]?.attributes["sturdiness"]).toBe(3);
    expect(state.counters["heard"]).toBe(2);
  });
});

describe("modifiers", () => {
  it("reduces each incoming quantity by one for one round", () => {
    const pack = quantityPack(
      [
        {
          type: "if",
          condition: { eq: [{ counter: "round-number" }, 1] },
          then: [{ type: "setCounter", counter: "shielded", value: 1 }],
        },
        deliver("spark", 3),
      ],
      {
        counters: [
          ...QUANTITIES.counters,
          { id: "round-number", start: 0 },
          { id: "shielded", start: 0, resetScope: "round" },
        ],
        round: { onEnter: [change("round-number", 1)] },
        modifiers: [
          {
            id: "dampen",
            quantity: "spark",
            condition: { gt: [{ counter: "shielded" }, 0] },
            action: { reduce: 1 },
          },
        ],
      },
    );
    const engine = createEngine(pack);
    const first = engine.init(1);
    expect(first.counters["glow"]).toBe(2);
    const second = act(engine, first, CONTINUE);
    expect(second.counters["shielded"]).toBe(0);
    expect(second.counters["glow"]).toBe(5);
  });

  it("applies modifiers in priority order, ties by id", () => {
    const modifier = (id: string, priority: number, digit: number) => ({
      id,
      quantity: "spark",
      priority,
      action: { increase: 0 },
      onApply: [appendTrace(digit)],
    });
    const pack = quantityPack([deliver("spark", 1)], {
      modifiers: [modifier("m-one", 2, 1), modifier("m-two", 1, 2), modifier("m-three", 1, 3)],
    });
    expect(createEngine(pack).init(1).counters["trace"]).toBe(321);
  });

  it("prevents a delivery entirely, so nothing is announced", () => {
    const pack = quantityPack([deliver("spark", 4)], {
      modifiers: [{ id: "block", quantity: "spark", action: { prevent: true } }],
      triggers: [
        {
          id: "listen",
          on: { event: "quantityDelivered", quantity: "spark", kind: null },
          effects: [change("heard", 1)],
        },
      ],
    });
    const state = createEngine(pack).init(1);
    expect(state.counters["glow"]).toBe(0);
    expect(state.counters["heard"]).toBe(0);
  });

  it("converts one quantity type into another, which its own modifiers then see", () => {
    const pack = quantityPack([deliver("spark", 2)], {
      modifiers: [
        { id: "turn", quantity: "spark", action: { convertTo: "frost" } },
        { id: "boost", quantity: "frost", action: { increase: 1 } },
      ],
    });
    const state = createEngine(pack).init(1);
    expect(state.counters["glow"]).toBe(0);
    expect(state.counters["chill"]).toBe(3);
  });

  it("substitutes other effects for a delivery", () => {
    const pack = quantityPack([deliver("spark", 2)], {
      modifiers: [{ id: "swap", quantity: "spark", action: { substitute: [change("other", 7)] } }],
    });
    const state = createEngine(pack).init(1);
    expect(state.counters["glow"]).toBe(0);
    expect(state.counters["other"]).toBe(7);
  });

  it("offers an optional modifier as a choice with pass", () => {
    const pack = quantityPack([deliver("spark", 3)], {
      modifiers: [
        {
          id: "screen",
          quantity: "spark",
          optional: true,
          action: { reduce: 1 },
          onApply: [change("used", 1)],
        },
      ],
    });
    const engine = createEngine(pack);
    const offered = engine.init(1);
    expect(offered.counters["glow"]).toBe(0);
    expect(engine.legalActions(offered)).toEqual([
      { type: "chooseOption", option: "screen" },
      { type: "pass" },
    ]);
    const used = act(engine, offered, { type: "chooseOption", option: "screen" });
    expect(used.counters["glow"]).toBe(2);
    expect(used.counters["used"]).toBe(1);
    const declined = act(engine, offered, { type: "pass" });
    expect(declined.counters["glow"]).toBe(3);
    expect(declined.counters["used"]).toBe(0);
  });
});
