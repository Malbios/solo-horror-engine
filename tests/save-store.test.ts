import { describe, expect, it } from "vitest";
import {
  coreVersion,
  describeSaveMismatch,
  LocalStorageSaveStore,
  type Save,
} from "../src/ui/save-store";
import { MemoryStorage } from "./memory-storage";

const save: Save = {
  engineVersion: "1.0.0",
  packId: "demo",
  packVersion: "1.0.0",
  seed: 42,
  actions: [{ type: "pickModule", module: "bonus-cards" }, { type: "pass" }],
};

describe("LocalStorageSaveStore", () => {
  it("returns none when nothing is saved", () => {
    expect(new LocalStorageSaveStore("k", new MemoryStorage()).load()).toEqual({ type: "none" });
  });

  it("round-trips a save", () => {
    const store = new LocalStorageSaveStore("k", new MemoryStorage());
    store.save(save);
    expect(store.load()).toEqual({ type: "ok", save });
  });

  it("clears a save", () => {
    const store = new LocalStorageSaveStore("k", new MemoryStorage());
    store.save(save);
    store.clear();
    expect(store.load()).toEqual({ type: "none" });
  });

  it.each([
    ["not json {"],
    [JSON.stringify({ ...save, seed: "x" })],
    [JSON.stringify({ ...save, actions: [{}] })],
  ])("reports corrupt data %#", (raw) => {
    const storage = new MemoryStorage();
    storage.setItem("k", raw);
    expect(new LocalStorageSaveStore("k", storage).load()).toEqual({ type: "corrupt" });
  });
});

describe("describeSaveMismatch", () => {
  const identity = { engineVersion: "1.0.0", packId: "demo", packVersion: "1.0.0" };

  it("returns null when versions match", () => {
    expect(describeSaveMismatch(save, identity)).toBeNull();
  });

  it("gives one line per mismatch", () => {
    const lines = describeSaveMismatch(save, {
      ...identity,
      engineVersion: "2.0.0",
      packVersion: "1.1.0",
    });
    expect(lines).toEqual(["Engine: saved 1.0.0, now 2.0.0", "Core: saved 1.0.0, now 1.1.0"]);
  });

  it("names another pack without comparing versions", () => {
    expect(
      describeSaveMismatch(save, { ...identity, packId: "other", packVersion: "9.0.0" }),
    ).toEqual(["Pack: saved demo, now other"]);
  });

  it("lists added, removed and updated add-ons, leaving unchanged ones out", () => {
    const saved = { ...save, packVersion: "1.0.0+lamp@1.0.0+rope@1.0.0+axe@1.0.0" };
    const lines = describeSaveMismatch(saved, {
      ...identity,
      packVersion: "1.0.0+axe@1.0.0+bell@0.1.0+cellar@0.1.0+lamp@1.2.0",
    });
    expect(lines).toEqual([
      "Add-ons added: bell, cellar",
      "Add-ons removed: rope",
      "Add-ons updated: lamp 1.0.0 to 1.2.0",
    ]);
  });

  it("reads the core version of a combined version", () => {
    expect(coreVersion("2.1.0+lamp@1.0.0")).toBe("2.1.0");
    expect(coreVersion("2.1.0")).toBe("2.1.0");
  });
});
