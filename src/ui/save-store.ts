import type { Action } from "../core";

export type Save = {
  engineVersion: string;
  packId: string;
  packVersion: string;
  seed: number;
  actions: Action[];
};

export type SaveLoadResult = { type: "none" } | { type: "ok"; save: Save } | { type: "corrupt" };

export interface SaveStore {
  load(): SaveLoadResult;
  save(save: Save): void;
  clear(): void;
}

export type SaveIdentity = Pick<Save, "engineVersion" | "packId" | "packVersion">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is Action {
  if (!isRecord(value)) return false;
  switch (value["type"]) {
    case "pass":
      return true;
    case "pickModule":
      return typeof value["module"] === "string";
    case "chooseOption":
      return typeof value["option"] === "string";
    case "playCard":
    case "discardCard":
    case "buyCard":
      return typeof value["card"] === "string";
    case "useAbility":
      return typeof value["card"] === "string" && typeof value["ability"] === "string";
    case "moveTo":
      return typeof value["space"] === "string";
    case "pickUnit":
      return typeof value["unit"] === "string";
    case "pickCard":
      return typeof value["card"] === "string";
    case "pickDie":
      return typeof value["die"] === "string";
    default:
      return false;
  }
}

function isSave(value: unknown): value is Save {
  return (
    isRecord(value) &&
    typeof value["engineVersion"] === "string" &&
    typeof value["packId"] === "string" &&
    typeof value["packVersion"] === "string" &&
    Number.isInteger(value["seed"]) &&
    Array.isArray(value["actions"]) &&
    value["actions"].every(isAction)
  );
}

type SplitVersion = { core: string; addOns: Map<string, string> };

/** Splits a combined pack version (`core+id@version+...`) into the core's and each add-on's. */
function splitPackVersion(version: string): SplitVersion {
  const [core = "", ...parts] = version.split("+");
  const addOns = new Map<string, string>();
  for (const part of parts) {
    const at = part.lastIndexOf("@");
    if (at === -1) addOns.set(part, "");
    else addOns.set(part.slice(0, at), part.slice(at + 1));
  }
  return { core, addOns };
}

function describePackVersionChange(saved: string, current: string): string[] {
  const before = splitPackVersion(saved);
  const after = splitPackVersion(current);
  const lines: string[] = [];
  if (before.core !== after.core) lines.push(`Core: saved ${before.core}, now ${after.core}`);
  const added = [...after.addOns.keys()].filter((id) => !before.addOns.has(id));
  const removed = [...before.addOns.keys()].filter((id) => !after.addOns.has(id));
  const updated = [...after.addOns].flatMap(([id, version]) => {
    const old = before.addOns.get(id);
    return old === undefined || old === version ? [] : [`${id} ${old} to ${version}`];
  });
  if (added.length > 0) lines.push(`Add-ons added: ${added.join(", ")}`);
  if (removed.length > 0) lines.push(`Add-ons removed: ${removed.join(", ")}`);
  if (updated.length > 0) lines.push(`Add-ons updated: ${updated.join(", ")}`);
  return lines;
}

/** One line per difference between the save and the current game, or null when they match. */
export function describeSaveMismatch(save: Save, current: SaveIdentity): string[] | null {
  const lines: string[] = [];
  if (save.engineVersion !== current.engineVersion)
    lines.push(`Engine: saved ${save.engineVersion}, now ${current.engineVersion}`);
  if (save.packId !== current.packId)
    lines.push(`Pack: saved ${save.packId}, now ${current.packId}`);
  else if (save.packVersion !== current.packVersion)
    lines.push(...describePackVersionChange(save.packVersion, current.packVersion));
  return lines.length === 0 ? null : lines;
}

/** The core's part of a combined pack version. */
export function coreVersion(version: string): string {
  return splitPackVersion(version).core;
}

export class LocalStorageSaveStore implements SaveStore {
  constructor(
    private readonly key: string,
    private readonly storage: Storage,
  ) {}

  load(): SaveLoadResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return { type: "none" };
    }
    if (raw === null) {
      return { type: "none" };
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSave(parsed) ? { type: "ok", save: parsed } : { type: "corrupt" };
    } catch {
      return { type: "corrupt" };
    }
  }

  save(save: Save): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(save));
    } catch (error) {
      console.warn("Could not write save", error);
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch (error) {
      console.warn("Could not clear save", error);
    }
  }
}
