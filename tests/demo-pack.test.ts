import { describe, expect, it } from "vitest";
import demoPackData from "../content/demo/pack.json";
import { parsePack } from "../src/content";

function variant(change: (pack: typeof demoPackData) => unknown): unknown {
  return change(structuredClone(demoPackData));
}

describe("demo pack", () => {
  it("validates", () => {
    expect(parsePack(demoPackData).ok).toBe(true);
  });

  it.each([
    ["unknown start zone", variant((p) => ({ ...p, deck: { ...p.deck, startZone: "nowhere" } }))],
    [
      "duplicate card id",
      variant((p) => ({ ...p, deck: { ...p.deck, cards: [...p.deck.cards, p.deck.cards[0]] } })),
    ],
    ["track start above max", variant((p) => ({ ...p, tracks: [{ ...p.tracks[0], start: 99 }] }))],
    ["unknown field", variant((p) => ({ ...p, extra: true }))],
    ["wrong schema version", variant((p) => ({ ...p, meta: { ...p.meta, schemaVersion: 2 } }))],
    ["not an object", "pack"],
  ])("rejects %s", (_label, input) => {
    const result = parsePack(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("invalidPack");
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});
