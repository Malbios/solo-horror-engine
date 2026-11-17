import { describe, expect, it } from "vitest";
import { createEngine, view } from "../src/core";
import { act, fixturePack, PAUSE_PHASE } from "./helpers";

function pack() {
  return fixturePack({
    zones: [{ id: "vault", name: "Vault", face: "down" }],
    counters: [{ id: "opened", start: 0 }],
    cards: [
      {
        id: "riddle",
        name: "Riddle",
        parts: [
          {
            id: "first",
            text: "Not the blue door",
            effects: [{ type: "changeCounter", counter: "opened", amount: 1 }],
          },
          {
            id: "second",
            text: "Not the red door",
            effects: [{ type: "changeCounter", counter: "opened", amount: 10 }],
          },
        ],
      },
    ],
    setup: [{ type: "createCards", card: "riddle", zone: "vault" }],
    phases: [
      {
        id: "turn",
        steps: [
          {
            id: "reveal",
            effects: [
              {
                type: "choose",
                options: [
                  {
                    id: "first",
                    label: "First",
                    effects: [{ type: "revealCardPart", zone: "vault", part: "first" }],
                  },
                  {
                    id: "second",
                    label: "Second",
                    effects: [{ type: "revealCardPart", zone: "vault", part: "second" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      PAUSE_PHASE,
    ],
  });
}

describe("card parts", () => {
  it("reveal one part's text and run its effects while the card stays face down", () => {
    const engine = createEngine(pack());
    const start = engine.init(1);
    const outcome = engine.step(start, { type: "chooseOption", option: "second" });
    if (!outcome.ok) throw new Error("step failed");
    const shown = view(outcome.value.state);
    const [card] = shown.zones["vault"] ?? [];
    expect(card?.card).toBeNull();
    expect(card?.revealed).toEqual(["Not the red door"]);
    expect(outcome.value.state.counters["opened"]).toBe(10);
    expect(outcome.value.undoBarrier).toBe(true);
  });

  it("reveal a part only once", () => {
    const engine = createEngine(pack());
    let state = act(engine, engine.init(1), { type: "chooseOption", option: "first" });
    state = act(engine, state, { type: "chooseOption", option: "continue" });
    state = act(engine, state, { type: "chooseOption", option: "first" });
    expect(state.counters["opened"]).toBe(1);
    expect(view(state).zones["vault"]?.[0]?.revealed).toEqual(["Not the blue door"]);
  });
});
