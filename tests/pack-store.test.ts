import { describe, expect, it } from "vitest";
import demoPackData from "../content/demo/pack.json";
import {
  addOnGroups,
  EMPTY_LIBRARY,
  parseAddOnText,
  libraryFromFolder,
  LocalStorageLibraryStore,
  migrateLibrary,
  parseLibraryFile,
  parsePackText,
  refreshLibrary,
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

  it("drops both the core and the add-ons on clear", () => {
    const library = store();
    library.saveCore("{}");
    library.saveAddOns(["a"]);
    library.clear();
    expect(library.loadCore()).toBeNull();
    expect(library.loadAddOns()).toEqual([]);
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

describe("refreshLibrary", () => {
  const core = JSON.stringify(demoPackData);
  const newerCore = JSON.stringify({
    ...demoPackData,
    meta: { ...demoPackData.meta, version: "9.9.9" },
  });

  it("swaps each stored file for the found file with the same id, keeping order", () => {
    const refreshed = refreshLibrary(
      core,
      [addOnText("lamp"), addOnText("rope")],
      ["not json", addOnText("rope", "2.0.0"), newerCore, addOnText("lamp", "3.0.0")],
    );
    expect(refreshed).toEqual({
      core: newerCore,
      addOns: [addOnText("lamp", "3.0.0"), addOnText("rope", "2.0.0")],
      missing: [],
    });
  });

  it("keeps and names stored files the folder lacks, and adds nothing new", () => {
    const refreshed = refreshLibrary(
      core,
      [addOnText("lamp")],
      [addOnText("kite"), addOnText("lamp", "2.0.0")],
    );
    expect(refreshed.core).toBe(core);
    expect(refreshed.addOns).toEqual([addOnText("lamp", "2.0.0")]);
    expect(refreshed.missing).toEqual([demoPackData.meta.name]);
  });

  it("leaves an empty library empty", () => {
    expect(refreshLibrary(null, [], [newerCore, addOnText("lamp")])).toEqual({
      core: null,
      addOns: [],
      missing: [],
    });
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

describe("migrateLibrary", () => {
  const legacy = { core: "core-text", addOns: ["lamp-text"] };

  it("moves files an older version kept when nothing is stored yet", () => {
    expect(migrateLibrary(null, legacy)).toEqual({ library: legacy, migrate: true });
  });

  it("keeps the stored library and leaves the old files alone", () => {
    const stored = { core: null, addOns: ["rope-text"] };
    expect(migrateLibrary(stored, legacy)).toEqual({ library: stored, migrate: false });
    expect(migrateLibrary(EMPTY_LIBRARY, legacy)).toEqual({
      library: EMPTY_LIBRARY,
      migrate: false,
    });
  });

  it("starts empty with nothing anywhere", () => {
    expect(migrateLibrary(null, EMPTY_LIBRARY)).toEqual({ library: EMPTY_LIBRARY, migrate: false });
  });
});

describe("libraryFromFolder", () => {
  const coreText = JSON.stringify(demoPackData);
  const otherCore = (id: string) =>
    JSON.stringify({ ...demoPackData, meta: { ...demoPackData.meta, id, name: id } });
  const foreignAddOn = JSON.stringify({
    meta: { id: "far", version: "1.0.0", schemaVersion: 2, name: "far", core: "elsewhere" },
    module: { id: "far", kind: "extra", precedence: 1 },
  });

  it("takes the one core and every add-on made for it, skipping other files", () => {
    const found = [
      addOnText("lamp"),
      "not json",
      JSON.stringify({ notes: true }),
      coreText,
      foreignAddOn,
      addOnText("rope"),
    ];
    expect(libraryFromFolder(found)).toEqual({
      ok: true,
      value: { core: coreText, addOns: [addOnText("lamp"), addOnText("rope")] },
    });
  });

  it("keeps the newest version of an add-on found twice", () => {
    const found = [
      coreText,
      addOnText("lamp", "1.2.0"),
      addOnText("lamp", "1.10.0"),
      addOnText("lamp", "1.3.0"),
    ];
    const library = libraryFromFolder(found);
    expect(library.ok && library.value.addOns).toEqual([addOnText("lamp", "1.10.0")]);
  });

  it("refuses a folder without a core or with several", () => {
    const none = libraryFromFolder([addOnText("lamp")]);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error[0]).toMatch(/No core/);
    const two = libraryFromFolder([coreText, otherCore("second")]);
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error[0]).toMatch(/more than one core.*second/);
  });
});

describe("addOnGroups", () => {
  const addOn = (id: string, name: string, kind: string) => {
    const parsed = parseAddOnText(
      JSON.stringify({
        meta: { id, version: "1.0.0", schemaVersion: 2, name, core: "demo" },
        module: { id, kind, precedence: 1 },
      }),
    );
    if (parsed === null) throw new Error("invalid add-on fixture");
    return parsed;
  };

  it("groups by kind in the given order, others after by id, names sorted", () => {
    const groups = addOnGroups(
      [
        addOn("lamp", "Lamp", "tool"),
        addOn("cellar", "Cellar", "room"),
        addOn("axe", "Axe", "tool"),
        addOn("wisp", "Wisp", "side-quest"),
        addOn("bell", "Bell", "charm"),
      ],
      ["room", "tool"],
    );
    expect(groups.map((group) => group.title)).toEqual([
      "Rooms (1)",
      "Tools (2)",
      "Charms (1)",
      "Side quests (1)",
    ]);
    expect(groups[1]?.addOns.map((member) => member.meta.id)).toEqual(["axe", "lamp"]);
  });

  it("gives no groups without add-ons", () => {
    expect(addOnGroups([], ["room"])).toEqual([]);
  });
});
