import { describe, expect, it } from "vitest";
import { createEngine } from "../src/core";
import { fixturePack, PAUSE_PHASE } from "./helpers";

const create = (card: string, zone: string) => ({ type: "createCards", card, zone });
const move = (to: string, count: number) => ({ type: "moveCards", from: "pile", to, count });

const zones = [
  { id: "pile", face: "down" },
  { id: "bin" },
  { id: "box", face: "down" },
  { id: "shelf" },
];

const cards = [
  { id: "lamp", name: "Lamp" },
  { id: "stone", name: "Stone" },
];

const lampLeavesPile = {
  id: "lamp-leaves-pile",
  on: { event: "cardsMoved", from: "pile", to: null, card: "lamp" },
  effects: [
    { type: "changeCounter", counter: "fired", amount: 1 },
    { type: "moveThisCard", to: "shelf", position: "top" },
  ],
};

function engineWith(setup: object[]) {
  return createEngine(
    fixturePack({
      counters: [{ id: "fired", start: 0 }],
      zones,
      cards,
      triggers: [lampLeavesPile],
      setup,
      phases: [PAUSE_PHASE],
    }),
  );
}

describe("card-filtered move triggers", () => {
  it("fire for the named card landing face up and see it as this card", () => {
    const state = engineWith([
      create("stone", "pile"),
      create("lamp", "pile"),
      move("bin", 2),
    ]).init(1);
    expect(state.counters["fired"]).toBe(1);
    expect(state.zones["shelf"]?.length).toBe(1);
    expect(state.zones["bin"]?.length).toBe(1);
  });

  it("stay silent when the named card lands face down", () => {
    const state = engineWith([create("lamp", "pile"), move("box", 1)]).init(1);
    expect(state.counters["fired"]).toBe(0);
    expect(state.zones["box"]?.length).toBe(1);
  });

  it("stay silent when only other cards move", () => {
    const state = engineWith([
      create("stone", "pile"),
      create("lamp", "pile"),
      move("bin", 1),
    ]).init(1);
    expect(state.counters["fired"]).toBe(0);
  });
});
