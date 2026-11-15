import { describe, expect, it } from "vitest";
import { describeSaveMismatch, LocalStorageSaveStore, type Save } from "../src/ui/save-store";
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

  it("names each mismatched field", () => {
    const message = describeSaveMismatch(save, {
      ...identity,
      engineVersion: "2.0.0",
      packVersion: "1.1.0",
    });
    expect(message).toContain("engineVersion");
    expect(message).toContain("packVersion");
    expect(message).not.toContain("packId");
  });
});
