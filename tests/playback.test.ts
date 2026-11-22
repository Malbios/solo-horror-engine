import { describe, expect, it } from "vitest";
import {
  createEngine,
  view,
  type DecisionView,
  type GameEvent,
  type GameView,
  type UnitState,
} from "../src/core";
import {
  ownMoveOf,
  ownRemovalOf,
  playbackBeats,
  readingMilliseconds,
  type PlaybackStep,
} from "../src/ui/playback";
import { loadDemoPack } from "./helpers";

const onSpace = (id: string, kind: string, space: string): UnitState => ({
  id,
  kind,
  attributes: {},
  placement: { type: "space", space },
});

function baseView(overrides: Partial<GameView>): GameView {
  const shown = view(createEngine(loadDemoPack()).init(1));
  return { ...shown, round: 1, pending: null, units: {}, counters: {}, zones: {}, ...overrides };
}

const describeAll = (event: GameEvent): string => event.type;
const moved = (unit: string, from: string | null, to: string | null): GameEvent => ({
  type: "unitMoved",
  unit,
  kind: "walker",
  fromSpace: from,
  toSpace: to,
});

function beatsOf(
  before: GameView,
  events: GameEvent[],
  after: GameView,
  ownMove: string | null = null,
  ownRemoval: string | null = null,
) {
  const steps: PlaybackStep[] = [{ events, after }];
  return playbackBeats({
    before,
    steps,
    ownMove,
    ownRemoval,
    describe: describeAll,
    bookkeeping: (kind) => kind === "pin",
    comesAlong: (kind) => kind === "cart",
  });
}

describe("playbackBeats", () => {
  it("makes one beat per step of a move, with the piece where it stood then", () => {
    const before = baseView({ units: { walker: onSpace("walker", "walker", "a") } });
    const after = baseView({ units: { walker: onSpace("walker", "walker", "c") } });
    const beats = beatsOf(before, [moved("walker", "a", "b"), moved("walker", "b", "c")], after);
    expect(beats.map((beat) => beat.view.units["walker"]?.placement)).toEqual([
      { type: "space", space: "b" },
      { type: "space", space: "c" },
    ]);
    expect(beats.map((beat) => beat.focus)).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("adds caption-only events to the current beat, and earlier ones to the first beat", () => {
    const before = baseView({
      units: { walker: onSpace("walker", "walker", "a") },
      counters: { fear: 0 },
    });
    const after = baseView({
      units: { walker: onSpace("walker", "walker", "b") },
      counters: { fear: 2 },
    });
    const events: GameEvent[] = [
      { type: "diceRolled", pool: "pool", dice: [] },
      moved("walker", "a", "b"),
      { type: "counterChanged", counter: "fear", from: 0, to: 2 },
    ];
    const beats = beatsOf(before, events, after);
    expect(beats).toHaveLength(1);
    expect(beats[0]?.lines).toEqual(["diceRolled", "unitMoved", "counterChanged"]);
    expect(beats[0]?.view.counters["fear"]).toBe(2);
  });

  it("skips the player's own first move but plays a follower's", () => {
    const before = baseView({
      units: { you: onSpace("you", "walker", "a"), friend: onSpace("friend", "walker", "a") },
    });
    const after = baseView({
      units: { you: onSpace("you", "walker", "b"), friend: onSpace("friend", "walker", "b") },
    });
    const beats = beatsOf(
      before,
      [moved("you", "a", "b"), moved("friend", "a", "b")],
      after,
      "you",
    );
    expect(beats).toHaveLength(1);
    expect(beats[0]?.view.units["friend"]?.placement).toEqual({ type: "space", space: "b" });
  });

  it("skips the move of the piece the player picked to follow", () => {
    const before = baseView({ units: { friend: onSpace("friend", "walker", "a") } });
    const after = baseView({ units: { friend: onSpace("friend", "walker", "b") } });
    expect(beatsOf(before, [moved("friend", "a", "b")], after, "friend")).toEqual([]);
  });

  it("skips the removal of the piece a chosen option is about, but not a later one", () => {
    const removed = (unit: string): GameEvent => ({
      type: "unitRemoved",
      unit,
      kind: "walker",
      fromSpace: "a",
    });
    const before = baseView({
      units: { friend: onSpace("friend", "walker", "a"), other: onSpace("other", "walker", "b") },
    });
    const after = baseView({ units: { other: onSpace("other", "walker", "a") } });
    const ownFirst = beatsOf(
      before,
      [removed("friend"), moved("other", "b", "a")],
      after,
      null,
      "friend",
    );
    expect(ownFirst.map((beat) => beat.lines)).toEqual([["unitMoved"]]);
    const ownLater = beatsOf(
      before,
      [moved("other", "b", "a"), removed("friend")],
      after,
      null,
      "friend",
    );
    expect(ownLater.map((beat) => beat.lines)).toEqual([["unitMoved"], ["unitRemoved"]]);
  });

  it("moves a piece that comes along within the current beat, but shows it arriving", () => {
    const cart = (from: string | null, to: string | null): GameEvent => ({
      type: "unitMoved",
      unit: "cart",
      kind: "cart",
      fromSpace: from,
      toSpace: to,
    });
    const before = baseView({
      units: { walker: onSpace("walker", "walker", "a"), cart: onSpace("cart", "cart", "a") },
    });
    const after = baseView({
      units: { walker: onSpace("walker", "walker", "b"), cart: onSpace("cart", "cart", "b") },
    });
    const beats = beatsOf(before, [moved("walker", "a", "b"), cart("a", "b")], after);
    expect(beats.map((beat) => beat.lines)).toEqual([["unitMoved", "unitMoved"]]);
    expect(beats[0]?.view.units["cart"]?.placement).toEqual({ type: "space", space: "b" });
    const arriving = beatsOf(baseView({}), [cart(null, "b")], after);
    expect(arriving.map((beat) => beat.focus)).toEqual([["b"]]);
  });

  it("shows a piece created and removed in the same step, then takes it away", () => {
    const before = baseView({});
    const after = baseView({});
    const events: GameEvent[] = [
      moved("ghost", null, "a"),
      { type: "unitCreated", unit: "ghost", kind: "walker" },
      { type: "unitRemoved", unit: "ghost", kind: "walker", fromSpace: "a" },
    ];
    const beats = beatsOf(before, events, after);
    expect(beats.map((beat) => Object.keys(beat.view.units))).toEqual([["ghost"], []]);
    expect(beats[1]?.focus).toEqual(["a"]);
  });

  it("keeps helper pieces on the board without playing their moves or removal back", () => {
    const before = baseView({});
    const after = baseView({});
    const pinMoved: GameEvent = {
      type: "unitMoved",
      unit: "pin",
      kind: "pin",
      fromSpace: null,
      toSpace: "a",
    };
    const events: GameEvent[] = [
      pinMoved,
      { type: "unitCreated", unit: "pin", kind: "pin" },
      { type: "unitRemoved", unit: "pin", kind: "pin", fromSpace: "a" },
    ];
    expect(beatsOf(before, events, after)).toEqual([]);
  });

  it("plays nothing back from setup", () => {
    const before = baseView({ round: 0, units: { walker: onSpace("walker", "walker", "a") } });
    const after = baseView({ round: 0, units: { walker: onSpace("walker", "walker", "b") } });
    expect(beatsOf(before, [moved("walker", "a", "b")], after)).toEqual([]);
  });

  it("shows a resolved card only when the player can see which card it is", () => {
    const before = baseView({});
    const after = baseView({
      zones: { open: [{ ref: "card-1", card: "notice" }], closed: [{ ref: "h1", card: null }] },
    });
    const events: GameEvent[] = [
      { type: "cardResolved", card: "h1" },
      { type: "cardResolved", card: "card-1" },
    ];
    const beats = beatsOf(before, events, after);
    expect(beats.map((beat) => beat.card)).toEqual([{ ref: "card-1", card: "notice" }]);
  });
});

describe("own moves", () => {
  const moving: DecisionView = { kind: "moveUnit", unit: "walker", options: ["b"], canPass: false };
  const choosing: DecisionView = {
    kind: "chooseOption",
    options: [{ id: "keep", label: "Keep", cost: [], topCardOf: null }],
    canPass: true,
    roll: null,
    unit: "friend",
    showZone: null,
  };

  it("names the piece the player moved or picked", () => {
    expect(ownMoveOf({ type: "moveTo", space: "b" }, moving)).toBe("walker");
    expect(ownMoveOf({ type: "pickUnit", unit: "friend" }, null)).toBe("friend");
    expect(ownMoveOf({ type: "pass" }, moving)).toBeNull();
  });

  it("names the piece a chosen option is about", () => {
    expect(ownRemovalOf({ type: "chooseOption", option: "keep" }, choosing)).toBe("friend");
    expect(ownRemovalOf({ type: "pass" }, choosing)).toBeNull();
    expect(ownRemovalOf({ type: "pickUnit", unit: "friend" }, null)).toBeNull();
  });
});

describe("readingMilliseconds", () => {
  const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");

  it("gives a short line the minimum time", () => {
    expect(readingMilliseconds(["Moved"])).toBe(2000);
  });

  it("gives more words more time, counting every text", () => {
    const one = readingMilliseconds([words(10)]);
    expect(readingMilliseconds([words(20)])).toBeGreaterThan(one);
    expect(readingMilliseconds(["Card name", words(10)])).toBeGreaterThan(one);
  });

  it("scales every part with the speed factor, limits included", () => {
    expect(readingMilliseconds(["Moved"], 0.5)).toBe(1000);
    expect(readingMilliseconds([words(500)], 0.5)).toBe(5000);
    expect(readingMilliseconds([words(10)], 1)).toBe(readingMilliseconds([words(10)]));
  });

  it("stops at the maximum for very long texts", () => {
    expect(readingMilliseconds([words(500)])).toBe(10000);
  });
});
