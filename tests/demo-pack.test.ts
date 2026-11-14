import { describe, expect, it } from "vitest";
import demoPackData from "../content/demo/pack.json";
import { parsePack } from "../src/content";

function variant(change: (pack: Record<string, unknown>) => unknown): unknown {
  return change(structuredClone(demoPackData));
}

function withBase(extra: Record<string, unknown>): unknown {
  return variant((pack) => ({ ...pack, base: { ...(pack["base"] as object), ...extra } }));
}

describe("demo pack", () => {
  it("validates", () => {
    expect(parsePack(demoPackData).ok).toBe(true);
  });

  it.each([
    ["unknown zone reference", withBase({ setup: [{ type: "shuffle", zone: "nowhere" }] })],
    [
      "duplicate counter id",
      withBase({
        counters: [
          { id: "a", start: 0 },
          { id: "a", start: 1 },
        ],
      }),
    ],
    ["counter start above max", withBase({ counters: [{ id: "a", start: 5, max: 2 }] })],
    ["unknown field", variant((pack) => ({ ...pack, extra: true }))],
    [
      "wrong schema version",
      variant((pack) => ({ ...pack, meta: { ...(pack["meta"] as object), schemaVersion: 1 } })),
    ],
    [
      "choice offering an unknown module",
      variant((pack) => ({ ...pack, choices: [{ id: "c", options: ["ghost"], min: 0, max: 1 }] })),
    ],
    ["not an object", "pack"],
  ])("rejects %s", (_label, input) => {
    const result = parsePack(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("invalidPack");
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects two modules at the same precedence defining the same id", () => {
    const module = (id: string) => ({
      id,
      kind: "extra",
      precedence: 1,
      content: { counters: [{ id: "shared", start: 0 }] },
    });
    const input = variant((pack) => ({
      ...pack,
      modules: [module("one"), module("two")],
      choices: [],
    }));
    expect(parsePack(input).ok).toBe(false);
  });

  it("rejects nesting deeper than the limit", () => {
    let deep: unknown = true;
    for (let level = 0; level < 70; level++) deep = { not: deep };
    const input = withBase({
      checks: [{ id: "deep", condition: deep, effects: [] }],
    });
    expect(parsePack(input).ok).toBe(false);
  });
});
