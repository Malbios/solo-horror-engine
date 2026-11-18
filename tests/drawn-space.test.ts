import { describe, expect, it } from "vitest";
import { drawnSpace } from "../src/ui/board";
import { fixturePack } from "./helpers";

const pack = fixturePack({
  boards: [{ id: "grid", name: "Grid" }],
  counters: [{ id: "spot", start: 0 }],
  spaces: [
    {
      id: "raft",
      name: "Raft",
      position: { board: "grid", x: 10, y: 10 },
      positionBy: {
        counter: "spot",
        positions: [
          { value: 1, board: "grid", x: 50, y: 20 },
          { value: 2, board: "grid", x: 80, y: 70 },
        ],
      },
    },
  ],
});
const raft = pack.base.spaces[0];

describe("drawn space positions", () => {
  it("follow the counter's value", () => {
    if (raft === undefined) throw new Error("missing space");
    expect(drawnSpace(raft, { spot: 2 }).position).toEqual({ board: "grid", x: 80, y: 70 });
    expect(drawnSpace(raft, { spot: 1 }).position).toEqual({ board: "grid", x: 50, y: 20 });
  });

  it("fall back to the fixed position when no entry matches", () => {
    if (raft === undefined) throw new Error("missing space");
    expect(drawnSpace(raft, { spot: 0 }).position).toEqual({ board: "grid", x: 10, y: 10 });
  });

  it("are checked against defined counters", () => {
    expect(() =>
      fixturePack({
        boards: [{ id: "grid", name: "Grid" }],
        spaces: [{ id: "raft", name: "Raft", positionBy: { counter: "missing", positions: [] } }],
      }),
    ).toThrow();
  });
});
