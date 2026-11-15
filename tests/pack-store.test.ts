import { describe, expect, it } from "vitest";
import demoPackData from "../content/demo/pack.json";
import { LocalStoragePackStore, parsePackText } from "../src/ui/pack-store";
import { MemoryStorage } from "./memory-storage";

class FullStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error("quota exceeded");
  }
}

describe("LocalStoragePackStore", () => {
  it("returns null when nothing is stored", () => {
    expect(new LocalStoragePackStore("k", new MemoryStorage()).load()).toBeNull();
  });

  it("round-trips pack text and clears it", () => {
    const store = new LocalStoragePackStore("k", new MemoryStorage());
    expect(store.save("{}")).toBe(true);
    expect(store.load()).toBe("{}");
    store.clear();
    expect(store.load()).toBeNull();
  });

  it("reports a failed write", () => {
    expect(new LocalStoragePackStore("k", new FullStorage()).save("{}")).toBe(false);
  });
});

describe("parsePackText", () => {
  it("parses a valid pack", () => {
    const parsed = parsePackText(JSON.stringify(demoPackData));
    expect(parsed.ok && parsed.value.meta.id).toBe("demo");
  });

  it("explains text that is not JSON", () => {
    const parsed = parsePackText("{ not json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error[0]).toMatch(/not valid JSON/);
  });

  it("lists schema problems with their paths", () => {
    const broken = { ...demoPackData, meta: { ...demoPackData.meta, schemaVersion: 99 } };
    const parsed = parsePackText(JSON.stringify(broken));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error[0]).toBe("The file is not a valid pack.");
      expect(parsed.error.some((line) => line.startsWith("meta.schemaVersion:"))).toBe(true);
    }
  });

  it("caps the number of listed problems", () => {
    const parsed = parsePackText(JSON.stringify({ meta: 1, base: 2, modules: 3, choices: 4 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.length).toBeLessThanOrEqual(7);
  });
});
