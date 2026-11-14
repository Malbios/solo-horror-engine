import { describe, expect, it } from "vitest";
import { createEngine, replay, type Action, type GameState } from "../src/core";
import { act, CONTINUE, fixturePack, PAUSE_PHASE } from "./helpers";

const unit = (id: string) => ({ id });
const recordSelf = {
  type: "setCounter",
  counter: "trace",
  value: { add: [{ mul: [{ counter: "trace" }, 10] }, { attribute: "label", of: "self" }] },
};

type Piece = { label: number; rank: number };

function piecesPack(pieces: Piece[], selection: object) {
  return fixturePack({
    spaces: [{ id: "here", name: "Here" }],
    unitKinds: [
      {
        id: "piece",
        name: "Piece",
        attributes: [
          { id: "label", start: 0 },
          { id: "rank", start: 0 },
        ],
      },
    ],
    counters: [{ id: "trace", start: 0 }],
    setup: pieces.flatMap((piece) => {
      const id = `p${piece.label}`;
      return [
        { type: "createUnit", kind: "piece", id, placement: { onSpace: { space: "here" } } },
        { type: "setAttribute", unit: unit(id), attribute: "label", value: piece.label },
        { type: "setAttribute", unit: unit(id), attribute: "rank", value: piece.rank },
      ];
    }),
    phases: [{ id: "visit", steps: [{ id: "all", effects: [selection] }] }, PAUSE_PHASE],
  });
}

const byRank = (direction: "asc" | "desc", tieBreak: string) => ({
  sortBy: [{ key: { attribute: "rank", of: "self" }, direction }],
  tieBreak,
});

function pick(engine: ReturnType<typeof createEngine>, state: GameState, unitId: string) {
  return act(engine, state, { type: "pickUnit", unit: unitId });
}

describe("ordering", () => {
  it("breaks a three-way tie on a sort key with single-pick decisions", () => {
    const engine = createEngine(
      piecesPack(
        [
          { label: 1, rank: 1 },
          { label: 2, rank: 1 },
          { label: 3, rank: 1 },
        ],
        { type: "forEachUnit", order: byRank("asc", "decision"), effects: [recordSelf] },
      ),
    );
    let state = engine.init(1);
    expect(state.pending).toEqual({ kind: "pickUnit", options: ["p1", "p2", "p3"] });
    expect(engine.legalActions(state)).toHaveLength(3);
    state = pick(engine, state, "p3");
    expect(state.pending).toEqual({ kind: "pickUnit", options: ["p1", "p2"] });
    state = pick(engine, state, "p1");
    expect(state.counters["trace"]).toBe(312);
    expect(state.pending?.kind).toBe("chooseOption");
  });

  it("sorts descending and falls back to id order within a tie", () => {
    const engine = createEngine(
      piecesPack(
        [
          { label: 1, rank: 1 },
          { label: 2, rank: 3 },
          { label: 3, rank: 3 },
        ],
        { type: "forEachUnit", order: byRank("desc", "id"), effects: [recordSelf] },
      ),
    );
    expect(engine.init(1).counters["trace"]).toBe(231);
  });

  it("breaks ties at random, reproducibly from the seed", () => {
    const engine = createEngine(
      piecesPack(
        [1, 2, 3, 4].map((label) => ({ label, rank: 0 })),
        { type: "forEachUnit", order: byRank("asc", "random"), effects: [recordSelf] },
      ),
    );
    const traces = [1, 2, 3, 4, 5, 6].map((seed) => engine.init(seed).counters["trace"] ?? 0);
    for (const trace of traces) {
      expect(String(trace).split("").sort().join("")).toBe("1234");
    }
    expect(new Set(traces).size).toBeGreaterThan(1);
    expect(engine.init(4)).toEqual(engine.init(4));
  });

  it("keeps the snapshot: removed units are skipped and new units are not visited", () => {
    const engine = createEngine(
      piecesPack(
        [1, 2, 3].map((label) => ({ label, rank: 0 })),
        {
          type: "forEachUnit",
          effects: [
            recordSelf,
            {
              type: "if",
              condition: { eq: [{ attribute: "label", of: "self" }, 1] },
              then: [
                { type: "removeUnit", unit: unit("p2") },
                {
                  type: "createUnit",
                  kind: "piece",
                  id: "p0",
                  placement: { onSpace: { space: "here" } },
                },
              ],
            },
          ],
        },
      ),
    );
    expect(engine.init(1).counters["trace"]).toBe(13);
  });

  it("selects a limited number of units, cutting inside a tie group", () => {
    const engine = createEngine(
      piecesPack(
        [
          { label: 1, rank: 1 },
          { label: 2, rank: 2 },
          { label: 3, rank: 2 },
        ],
        {
          type: "selectUnits",
          order: byRank("asc", "decision"),
          count: 2,
          effects: [recordSelf],
        },
      ),
    );
    let state = engine.init(1);
    expect(state.counters["trace"]).toBe(1);
    expect(state.pending).toEqual({ kind: "pickUnit", options: ["p2", "p3"] });
    state = pick(engine, state, "p3");
    expect(state.counters["trace"]).toBe(13);
    expect(state.pending?.kind).toBe("chooseOption");
  });

  describe("ties between equally short paths", () => {
    const diamond = (order: object, crowdOn: string | null = null) =>
      fixturePack({
        spaces: ["a", "b", "c", "d"].map((id) => ({ id, name: id })),
        edges: [
          { id: "ab", fromSpace: "a", toSpace: "b" },
          { id: "ac", fromSpace: "a", toSpace: "c" },
          { id: "bd", fromSpace: "b", toSpace: "d" },
          { id: "cd", fromSpace: "c", toSpace: "d" },
        ],
        edgeFilters: [{ id: "any" }],
        unitKinds: [
          { id: "hunter", name: "Hunter" },
          { id: "crowd", name: "Crowd" },
        ],
        setup: [
          {
            type: "createUnit",
            kind: "hunter",
            id: "hunter",
            placement: { onSpace: { space: "a" } },
          },
          ...(crowdOn === null
            ? []
            : [{ type: "createUnit", kind: "crowd", placement: { onSpace: { space: crowdOn } } }]),
        ],
        phases: [
          {
            id: "hunt",
            steps: [
              {
                id: "go",
                effects: [
                  {
                    type: "moveToward",
                    unit: unit("hunter"),
                    target: { space: "d" },
                    steps: 1,
                    filter: "any",
                    order,
                  },
                ],
              },
            ],
          },
          PAUSE_PHASE,
        ],
      });
    const hunterSpace = (state: GameState) => state.units["hunter"]?.placement;

    it("takes the lowest space id by default", () => {
      expect(hunterSpace(createEngine(diamond({})).init(1))).toEqual({ type: "space", space: "b" });
    });

    it("prefers the next space chosen by the pack's sort keys", () => {
      const order = {
        sortBy: [{ key: { countUnits: { kind: "crowd", at: "candidate" } }, direction: "desc" }],
      };
      const state = createEngine(diamond(order, "c")).init(1);
      expect(hunterSpace(state)).toEqual({ type: "space", space: "c" });
    });

    it("asks which tied step to take, with no pass", () => {
      const engine = createEngine(diamond({ tieBreak: "decision" }));
      const state = engine.init(1);
      expect(state.pending).toEqual({
        kind: "moveUnit",
        unit: "hunter",
        options: ["b", "c"],
        canPass: false,
      });
      expect(engine.legalActions(state)).toEqual([
        { type: "moveTo", space: "b" },
        { type: "moveTo", space: "c" },
      ]);
      const moved = act(engine, state, { type: "moveTo", space: "c" });
      expect(hunterSpace(moved)).toEqual({ type: "space", space: "c" });
      expect(moved.pending?.kind).toBe("chooseOption");
    });

    it("picks a tied step at random, reproducibly from the seed", () => {
      const engine = createEngine(diamond({ tieBreak: "random" }));
      const reached = new Set(
        [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify(hunterSpace(engine.init(seed)))),
      );
      expect(reached.size).toBe(2);
      expect(engine.init(3)).toEqual(engine.init(3));
    });
  });

  it("filters candidates and replays decisions from the log", () => {
    const engine = createEngine(
      piecesPack(
        [1, 2, 3].map((label) => ({ label, rank: 0 })),
        {
          type: "selectUnits",
          units: { where: { gt: [{ attribute: "label", of: "self" }, 1] } },
          order: { tieBreak: "decision" },
          effects: [recordSelf],
        },
      ),
    );
    const initial = engine.init(9);
    expect(initial.pending).toEqual({ kind: "pickUnit", options: ["p2", "p3"] });
    const actions: Action[] = [{ type: "pickUnit", unit: "p3" }, CONTINUE];
    let state = initial;
    for (const action of actions) state = act(engine, state, action);
    const replayed = replay(engine, 9, actions);
    expect(replayed.ok && replayed.value).toEqual(state);
  });
});
