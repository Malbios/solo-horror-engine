import { describe, expect, it } from "vitest";
import { parsePack } from "../src/content";
import { composeRules } from "../src/core";
import { fixturePack } from "./helpers";

const meta = { id: "fixture", version: "1.0.0", schemaVersion: 2, name: "Fixture" };

describe("pack display data", () => {
  it("fills names, text and positions when a pack leaves them out", () => {
    const pack = fixturePack({
      spaces: [{ id: "yard", name: "Yard" }],
      counters: [{ id: "tally", start: 0 }],
      zones: [{ id: "heap" }],
      cards: [{ id: "token", name: "Token" }],
      unitKinds: [{ id: "piece", name: "Piece" }],
    });
    expect(pack.base.boards).toEqual([]);
    expect(pack.base.spaces[0]?.position).toBeNull();
    expect(pack.base.counters[0]?.name).toBe("tally");
    expect(pack.base.zones[0]?.name).toBe("heap");
    expect(pack.base.cards[0]).toMatchObject({ text: "", image: null });
    expect(pack.base.unitKinds[0]?.image).toBeNull();
  });

  it("keeps given display data", () => {
    const pack = fixturePack({
      boards: [{ id: "grid", name: "Grid", image: "art/grid.png", aspect: 1.5 }],
      spaces: [{ id: "yard", name: "Yard", position: { board: "grid", x: 10, y: 90 } }],
      counters: [{ id: "tally", name: "Tally", start: 0 }],
      cards: [{ id: "token", name: "Token", text: "Does a thing.", image: "art/token.png" }],
    });
    expect(pack.base.boards[0]).toEqual({
      id: "grid",
      name: "Grid",
      image: "art/grid.png",
      aspect: 1.5,
    });
    expect(pack.base.spaces[0]?.position).toEqual({ board: "grid", x: 10, y: 90 });
    expect(pack.base.counters[0]?.name).toBe("Tally");
    expect(pack.base.cards[0]).toMatchObject({ text: "Does a thing.", image: "art/token.png" });
  });

  it("rejects a position on an undefined board or outside the board", () => {
    const missing = parsePack({
      meta,
      base: { spaces: [{ id: "yard", name: "Yard", position: { board: "nowhere", x: 1, y: 1 } }] },
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(JSON.stringify(missing.error)).toContain('undefined board \\"nowhere\\"');
    }
    const outside = parsePack({
      meta,
      base: {
        boards: [{ id: "grid", name: "Grid" }],
        spaces: [{ id: "yard", name: "Yard", position: { board: "grid", x: 101, y: 1 } }],
      },
    });
    expect(outside.ok).toBe(false);
  });

  it("keeps edge marks, whose colour defaults to none, and lets a module remove one", () => {
    const mark = { id: "rope", tag: "rope", badge: "R", name: "Rope bridge" };
    const pack = fixturePack(
      { edgeMarks: [mark] },
      {
        modules: [
          {
            id: "calm",
            kind: "variant",
            precedence: 1,
            content: {},
            remove: { edgeMarks: ["rope"] },
          },
        ],
        choices: [{ id: "variant", options: ["calm"], min: 0, max: 1 }],
      },
    );
    expect(pack.base.edgeMarks).toEqual([{ ...mark, color: null }]);
    const rules = composeRules(pack, ["calm"]);
    expect(rules.ok && rules.value.edgeMarks).toEqual([]);
    expect(parsePack({ meta, base: { edgeMarks: [{ ...mark, badge: "ROPE" }] } }).ok).toBe(false);
  });

  it("lets a module replace a board by id", () => {
    const pack = fixturePack(
      { boards: [{ id: "grid", name: "Grid" }] },
      {
        modules: [
          {
            id: "night",
            kind: "variant",
            precedence: 1,
            content: { boards: [{ id: "grid", name: "Dark grid", aspect: 2 }] },
          },
        ],
        choices: [{ id: "variant", options: ["night"], min: 0, max: 1 }],
      },
    );
    const rules = composeRules(pack, ["night"]);
    expect(rules.ok && rules.value.boardById.get("grid")).toEqual({
      id: "grid",
      name: "Dark grid",
      image: null,
      aspect: 2,
    });
  });
});
