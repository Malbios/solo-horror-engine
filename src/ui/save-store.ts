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
      return typeof value["card"] === "string";
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

export function describeSaveMismatch(save: Save, current: SaveIdentity): string | null {
  const fields = ["engineVersion", "packId", "packVersion"] as const;
  const mismatches = fields
    .filter((field) => save[field] !== current[field])
    .map((field) => `${field}: saved ${save[field]}, current ${current[field]}`);
  return mismatches.length === 0 ? null : mismatches.join("; ");
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
