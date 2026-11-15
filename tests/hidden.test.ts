import { describe, expect, it } from "vitest";
import {
  createEngine,
  replay,
  view,
  viewActions,
  viewEvents,
  type Action,
  type GameState,
} from "../src/core";
import { act, CONTINUE, fixturePack, PAUSE_PHASE } from "./helpers";

const SECRET = "secretive";

function hiddenPack(steps: unknown[], extraCards: object[] = []) {
  return fixturePack({
    zones: [{ id: "stack", face: "down" }, { id: "hand" }, { id: "spent", face: "down" }],
    cards: [
      { id: SECRET, name: "Secret", copies: 2 },
      { id: "plain", name: "Plain", copies: 2 },
      ...extraCards,
    ],
    setup: [
      { type: "createCards", card: SECRET, zone: "stack" },
      { type: "createCards", card: "plain", zone: "stack" },
    ],
    phases: [{ id: "play", steps: [{ id: "go", effects: steps }] }, PAUSE_PHASE],
  });
}

const refs = (state: GameState, zone: string) =>
  (view(state).zones[zone] ?? []).map((card) => card.ref);
const identities = (state: GameState, zone: string) =>
  (view(state).zones[zone] ?? []).map((card) => card.card);

describe("hidden cards", () => {
  it("never shows a face-down card's definition in the view, events or options", () => {
    const pack = hiddenPack([
      { type: "shuffle", zone: "stack" },
      { type: "moveCards", from: "stack", to: "spent", count: 1 },
      {
        type: "choose",
        options: [
          {
            id: "dump",
            label: "Dump",
            cost: [{ discard: { from: "stack", to: "spent", count: 1 } }],
          },
        ],
      },
    ]);
    const engine = createEngine(pack);
    const start = engine.init(4);
    const outcome = engine.step(start, { type: "chooseOption", option: "dump" });
    if (!outcome.ok) throw new Error("step failed");
    const { state, events } = outcome.value;
    expect(state.pending?.kind).toBe("pickCard");
    const shown = JSON.stringify([
      view(start),
      view(state),
      viewActions(state),
      viewEvents(events, state),
    ]);
    expect(shown).not.toContain(SECRET);
    expect(shown).not.toContain("plain");
    expect(refs(state, "stack").every((ref) => /^h\d+$/.test(ref))).toBe(true);
  });

  it("accepts a handle in a submitted action and replays the log", () => {
    const pack = hiddenPack([
      {
        type: "choose",
        options: [
          {
            id: "dump",
            label: "Dump",
            cost: [{ discard: { from: "stack", to: "spent", count: 1 } }],
          },
        ],
      },
    ]);
    const engine = createEngine(pack);
    let state = act(engine, engine.init(2), { type: "chooseOption", option: "dump" });
    const offered = viewActions(state);
    const firstOffer = offered[0];
    if (firstOffer?.type !== "pickCard") throw new Error("expected a card pick");
    expect(firstOffer.card).toMatch(/^h\d+$/);
    const actions: Action[] = [{ type: "chooseOption", option: "dump" }, firstOffer, CONTINUE];
    state = act(engine, state, firstOffer);
    state = act(engine, state, CONTINUE);
    const replayed = replay(engine, 2, actions);
    expect(replayed.ok && replayed.value).toEqual(state);
  });

  it("re-mints handles on shuffle and forgets peeked cards", () => {
    const pack = hiddenPack([
      { type: "peek", zone: "stack", count: 1 },
      { type: "choose", options: [{ id: "mix", label: "Mix" }] },
      { type: "shuffle", zone: "stack" },
    ]);
    const engine = createEngine(pack);
    const peeked = engine.init(6);
    expect(identities(peeked, "stack")).toEqual([SECRET, null, null, null]);
    expect(refs(peeked, "stack")[0]).toMatch(/^h\d+$/);
    const mixed = act(engine, peeked, { type: "chooseOption", option: "mix" });
    expect(identities(mixed, "stack")).toEqual([null, null, null, null]);
    const before = new Set(refs(peeked, "stack"));
    expect(refs(mixed, "stack").some((ref) => before.has(ref))).toBe(false);
  });

  it("reveals cards turned face up and hides them again when turned down", () => {
    const pack = hiddenPack([
      { type: "turnCards", zone: "stack", count: 1, face: "up" },
      { type: "choose", options: [{ id: "flip", label: "Flip" }] },
      { type: "turnCards", zone: "stack", count: 1, face: "down" },
    ]);
    const engine = createEngine(pack);
    const up = engine.init(1);
    expect(view(up).zones["stack"]?.[0]).toEqual({ ref: `${SECRET}:1`, card: SECRET });
    const down = act(engine, up, { type: "chooseOption", option: "flip" });
    const top = view(down).zones["stack"]?.[0];
    expect(top?.ref).toMatch(/^h\d+$/);
    expect(top?.card).toBe(SECRET);
  });

  it("offers cards that look the same only once", () => {
    const pack = hiddenPack([
      { type: "moveCards", from: "stack", to: "hand", count: 4 },
      { type: "playWindow", from: "hand", to: "spent" },
    ]);
    const engine = createEngine(pack);
    const state = engine.init(1);
    expect(engine.legalActions(state)).toHaveLength(5);
    expect(viewActions(state)).toEqual([
      { type: "playCard", card: `${SECRET}:1` },
      { type: "playCard", card: "plain:1" },
      { type: "pass" },
    ]);
  });
});
