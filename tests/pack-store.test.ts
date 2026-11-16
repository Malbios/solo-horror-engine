import { describe, expect, it } from "vitest";
import demoPackData from "../content/demo/pack.json";
import {
  LocalStorageLibraryStore,
  parseLibraryFile,
  parsePackText,
  withAddOn,
  withoutAddOn,
} from "../src/ui/pack-store";
import { MemoryStorage } from "./memory-storage";

class FullStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error("quota exceeded");
  }
}

const addOnText = (id: string, version = "1.0.0") =>
  JSON.stringify({
    meta: { id, version, schemaVersion: 2, name: id, core: "demo" },
    module: { id, kind: "extra", precedence: 1 },
  });

const store = () => new LocalStorageLibraryStore("core", "add-ons", new MemoryStorage());

describe("LocalStorageLibraryStore", () => {
  it("returns nothing when nothing is stored", () => {
    expect(store().loadCore()).toBeNull();
    expect(store().loadAddOns()).toEqual([]);
  });

  it("round-trips the core and the add-ons, and clears the core", () => {
    const library = store();
    expect(library.saveCore("{}")).toBe(true);
    expect(library.saveAddOns(["a", "b"])).toBe(true);
    expect(library.loadCore()).toBe("{}");
    expect(library.loadAddOns()).toEqual(["a", "b"]);
    library.clearCore();
    expect(library.loadCore()).toBeNull();
    expect(library.loadAddOns()).toEqual(["a", "b"]);
  });

  it("reports a failed write", () => {
    const full = new LocalStorageLibraryStore("core", "add-ons", new FullStorage());
    expect(full.saveCore("{}")).toBe(false);
    expect(full.saveAddOns([])).toBe(false);
  });
});

describe("library files", () => {
  it("tells a core from an add-on", () => {
    const core = parseLibraryFile(JSON.stringify(demoPackData));
    const addOn = parseLibraryFile(addOnText("lamp"));
    expect(core.ok && core.value.type).toBe("core");
    expect(addOn.ok && addOn.value.type).toBe("addOn");
  });

  it("replaces an add-on with the same id and removes one by id", () => {
    const first = addOnText("lamp");
    const newer = addOnText("lamp", "2.0.0");
    const parsed = parseLibraryFile(newer);
    if (!parsed.ok || parsed.value.type !== "addOn") throw new Error("not an add-on");
    const texts = withAddOn([first, addOnText("rope")], newer, parsed.value.addOn);
    expect(texts).toEqual([addOnText("rope"), newer]);
    expect(withoutAddOn(texts, "rope")).toEqual([newer]);
  });
});

describe("parsePackText", () => {
  it("parses a valid core", () => {
    const parsed = parsePackText(JSON.stringify(demoPackData));
    expect(parsed.ok && parsed.value.meta.id).toBe("demo");
  });

  it("refuses an add-on where a core is needed", () => {
    expect(parsePackText(addOnText("lamp")).ok).toBe(false);
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
      expect(parsed.error[0]).toBe("The file is not a valid core.");
      expect(parsed.error.some((line) => line.startsWith("meta.schemaVersion:"))).toBe(true);
    }
  });

  it("caps the number of listed problems", () => {
    const parsed = parsePackText(JSON.stringify({ meta: 1, base: 2, modules: 3, choices: 4 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.length).toBeLessThanOrEqual(7);
  });
});
