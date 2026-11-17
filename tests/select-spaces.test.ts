import { describe, expect, it } from "vitest";
import { createEngine } from "../src/core";
import { fixturePack, PAUSE_PHASE } from "./helpers";

const SPACES = ["a", "b", "c", "d"];

function packWith(select: object) {
  return fixturePack({
    spaces: SPACES.map((id) => ({ id, name: id })),
    edges: SPACES.slice(1).map((id, index) => ({
      id: `e${index}`,
      fromSpace: SPACES[index],
      toSpace: id,
    })),
    edgeFilters: [{ id: "any" }],
    unitKinds: [
      { id: "pawn", name: "Pawn" },
      { id: "flag", name: "Flag" },
    ],
    setup: [
      { type: "createUnit", kind: "pawn", id: "p", placement: { onSpace: { space: "b" } } },
      select,
    ],
    phases: [PAUSE_PHASE],
  });
}

const flagsOn = (state: ReturnType<ReturnType<typeof createEngine>["init"]>) =>
  Object.values(state.units)
    .filter((unit) => unit.kind === "flag")
    .map((unit) => (unit.placement.type === "space" ? unit.placement.space : null))
    .sort();

const placeFlag = { type: "createUnit", kind: "flag", placement: { onSpace: "candidate" } };

describe("selectSpaces", () => {
  it("picks spaces where the condition holds, best first by the order", () => {
    const engine = createEngine(
      packWith({
        type: "selectSpaces",
        where: { eq: [{ countUnits: { kind: "pawn", at: "candidate" } }, 0] },
        order: {
          sortBy: [
            {
              key: {
                distance: {
                  origin: { space: "b" },
                  destination: "candidate",
                  filter: "any",
                  ifUnreachable: 99,
                },
              },
              direction: "desc",
            },
          ],
          tieBreak: "id",
        },
        count: 2,
        effects: [placeFlag],
      }),
    );
    expect(flagsOn(engine.init(1))).toEqual(["a", "d"]);
  });

  it("breaks ties at random with the seed", () => {
    const engine = createEngine(
      packWith({
        type: "selectSpaces",
        where: true,
        order: { sortBy: [], tieBreak: "random" },
        count: 3,
        effects: [placeFlag],
      }),
    );
    const first = flagsOn(engine.init(1));
    expect(first).toHaveLength(3);
    expect(flagsOn(engine.init(1))).toEqual(first);
  });
});
