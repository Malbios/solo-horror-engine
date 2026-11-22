import { parseAddOn, parsePack, type PackIssue } from "../content";
import { err, ok, type AddOn, type Pack, type Result } from "../core";
import { LIBRARY_STORE, readStored, writeStored } from "./idb";

const ISSUES_SHOWN = 5;

/** The files a player has loaded: at most one core and any number of add-ons, kept as text. */
export interface LibraryStore {
  loadCore(): string | null;
  saveCore(text: string): boolean;
  clearCore(): void;
  loadAddOns(): string[];
  saveAddOns(texts: readonly string[]): boolean;
}

export class LocalStorageLibraryStore implements LibraryStore {
  constructor(
    private readonly coreKey: string,
    private readonly addOnsKey: string,
    private readonly storage: Storage,
  ) {}

  loadCore(): string | null {
    try {
      return this.storage.getItem(this.coreKey);
    } catch {
      return null;
    }
  }

  saveCore(text: string): boolean {
    return this.write(this.coreKey, text);
  }

  clearCore(): void {
    try {
      this.storage.removeItem(this.coreKey);
    } catch (error) {
      console.warn("Could not clear the stored core", error);
    }
  }

  /** Drops the core and the add-ons (after they were moved elsewhere). */
  clear(): void {
    this.clearCore();
    try {
      this.storage.removeItem(this.addOnsKey);
    } catch (error) {
      console.warn("Could not clear the stored add-ons", error);
    }
  }

  loadAddOns(): string[] {
    try {
      const raw = this.storage.getItem(this.addOnsKey);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  saveAddOns(texts: readonly string[]): boolean {
    return this.write(this.addOnsKey, JSON.stringify(texts));
  }

  private write(key: string, text: string): boolean {
    try {
      this.storage.setItem(key, text);
      return true;
    } catch (error) {
      console.warn("Could not store a loaded file", error);
      return false;
    }
  }
}

function describeIssues(issues: PackIssue[]): string[] {
  const shown = issues
    .slice(0, ISSUES_SHOWN)
    .map((issue) => `${issue.path === "" ? "(file)" : issue.path}: ${issue.message}`);
  const hidden = issues.length - shown.length;
  return hidden > 0 ? [...shown, `and ${hidden} more`] : shown;
}

export type LibraryFile = { type: "core"; pack: Pack } | { type: "addOn"; addOn: AddOn };

function parseJson(text: string): Result<unknown, string[]> {
  try {
    return ok(JSON.parse(text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return err([`The file is not valid JSON (${reason}).`]);
  }
}

/** Reads a loaded file as a core or, when it carries a single module, as an add-on. */
export function parseLibraryFile(text: string): Result<LibraryFile, string[]> {
  const data = parseJson(text);
  if (!data.ok) return data;
  const isAddOn = typeof data.value === "object" && data.value !== null && "module" in data.value;
  if (isAddOn) {
    const parsed = parseAddOn(data.value);
    if (parsed.ok) return ok({ type: "addOn", addOn: parsed.value });
    return err(["The file is not a valid add-on.", ...describeIssues(parsed.error.issues)]);
  }
  const parsed = parsePack(data.value);
  if (parsed.ok) return ok({ type: "core", pack: parsed.value });
  return err(["The file is not a valid core.", ...describeIssues(parsed.error.issues)]);
}

export function parsePackText(text: string): Result<Pack, string[]> {
  const parsed = parseLibraryFile(text);
  if (!parsed.ok) return parsed;
  return parsed.value.type === "core"
    ? ok(parsed.value.pack)
    : err(["The file is an add-on, not a core."]);
}

export function parseAddOnText(text: string): AddOn | null {
  const parsed = parseLibraryFile(text);
  return parsed.ok && parsed.value.type === "addOn" ? parsed.value.addOn : null;
}

/** The stored add-on texts with the one carrying `addOn`'s id replaced or appended. */
export function withAddOn(texts: readonly string[], text: string, addOn: AddOn): string[] {
  const others = texts.filter((stored) => parseAddOnText(stored)?.meta.id !== addOn.meta.id);
  return [...others, text];
}

export type RefreshedLibrary = { core: string | null; addOns: string[]; missing: string[] };

/**
 * Swaps each stored core and add-on for the found file with the same id. Found files that match
 * nothing stored are ignored; `missing` names the stored ones no found file replaced.
 */
export function refreshLibrary(
  core: string | null,
  addOns: readonly string[],
  found: readonly string[],
): RefreshedLibrary {
  const foundFiles = found.flatMap((text) => {
    const parsed = parseLibraryFile(text);
    return parsed.ok ? [{ text, file: parsed.value }] : [];
  });
  const foundCore = (id: string) =>
    foundFiles.find(({ file }) => file.type === "core" && file.pack.meta.id === id)?.text;
  const foundAddOn = (id: string) =>
    foundFiles.find(({ file }) => file.type === "addOn" && file.addOn.meta.id === id)?.text;
  const missing: string[] = [];
  const storedCore = core === null ? null : parsePackText(core);
  let nextCore = core;
  if (storedCore?.ok === true) {
    const replacement = foundCore(storedCore.value.meta.id);
    if (replacement === undefined) missing.push(storedCore.value.meta.name);
    nextCore = replacement ?? core;
  }
  const nextAddOns = addOns.map((text) => {
    const addOn = parseAddOnText(text);
    if (addOn === null) return text;
    const replacement = foundAddOn(addOn.meta.id);
    if (replacement === undefined) missing.push(addOn.meta.name);
    return replacement ?? text;
  });
  return { core: nextCore, addOns: nextAddOns, missing };
}

export function withoutAddOn(texts: readonly string[], id: string): string[] {
  return texts.filter((stored) => parseAddOnText(stored)?.meta.id !== id);
}

/** The loaded files: the core (null for the demo core) and the add-ons, as text. */
export type LibrarySnapshot = { core: string | null; addOns: string[] };

export const EMPTY_LIBRARY: LibrarySnapshot = { core: null, addOns: [] };

/**
 * The library to use at start: the stored one, else the files an older version kept in localStorage
 * (`migrate` then says they should be copied over and the old copies dropped).
 */
export function migrateLibrary(
  stored: LibrarySnapshot | null,
  legacy: LibrarySnapshot,
): { library: LibrarySnapshot; migrate: boolean } {
  if (stored !== null) return { library: stored, migrate: false };
  const hasLegacy = legacy.core !== null || legacy.addOns.length > 0;
  return { library: hasLegacy ? legacy : EMPTY_LIBRARY, migrate: hasLegacy };
}

function isSnapshot(value: unknown): value is LibrarySnapshot {
  if (typeof value !== "object" || value === null) return false;
  const { core, addOns } = value as Record<string, unknown>;
  return (
    (core === null || typeof core === "string") &&
    Array.isArray(addOns) &&
    addOns.every((text) => typeof text === "string")
  );
}

/** The library kept in the browser database, which holds far more than localStorage. */
export class IndexedDbLibraryStore {
  private static readonly KEY = "library";

  /** The stored library, or null when none was ever stored (or it cannot be read). */
  async load(): Promise<LibrarySnapshot | null> {
    try {
      const stored = await readStored(LIBRARY_STORE, IndexedDbLibraryStore.KEY);
      return isSnapshot(stored) ? stored : null;
    } catch (error) {
      console.warn("Could not read the stored packs", error);
      return null;
    }
  }

  async save(library: LibrarySnapshot): Promise<boolean> {
    try {
      await writeStored(LIBRARY_STORE, IndexedDbLibraryStore.KEY, library);
      return true;
    } catch (error) {
      console.warn("Could not store the loaded packs", error);
      return false;
    }
  }
}

export type AddOnGroup = { kind: string; title: string; addOns: AddOn[] };

function groupTitle(kind: string, count: number): string {
  const words = kind.replaceAll("-", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}s (${count})`;
}

/**
 * The add-ons grouped by their module's kind: kinds named in `kindOrder` first, in that order, then
 * the others by id; each group sorted by name.
 */
export function addOnGroups(addOns: readonly AddOn[], kindOrder: readonly string[]): AddOnGroup[] {
  const byKind = new Map<string, AddOn[]>();
  for (const addOn of addOns) {
    const kind = addOn.module.kind;
    byKind.set(kind, [...(byKind.get(kind) ?? []), addOn]);
  }
  const rank = (kind: string) => {
    const index = kindOrder.indexOf(kind);
    return index === -1 ? kindOrder.length : index;
  };
  const kinds = [...byKind.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return kinds.map((kind) => {
    const members = [...(byKind.get(kind) ?? [])].sort((a, b) =>
      a.meta.name.localeCompare(b.meta.name),
    );
    return { kind, title: groupTitle(kind, members.length), addOns: members };
  });
}

function versionParts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function isNewer(version: string, than: string): boolean {
  const a = versionParts(version);
  const b = versionParts(than);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/**
 * Every pack found in a folder as a library: its one core and each add-on made for that core (the
 * newest version per id). Files that are not packs are skipped.
 */
export function libraryFromFolder(found: readonly string[]): Result<LibrarySnapshot, string[]> {
  const files = found.flatMap((text) => {
    const parsed = parseLibraryFile(text);
    return parsed.ok ? [{ text, file: parsed.value }] : [];
  });
  const cores = files.flatMap(({ text, file }) =>
    file.type === "core" ? [{ text, pack: file.pack }] : [],
  );
  const [core, ...others] = cores;
  if (core === undefined) return err(["No core file was found in that folder."]);
  if (others.length > 0) {
    const names = cores.map(({ pack }) => `${pack.meta.name} ${pack.meta.version}`).join(", ");
    return err([`That folder holds more than one core (${names}). Pick a folder with one core.`]);
  }
  const newest = new Map<string, { text: string; version: string }>();
  for (const { text, file } of files) {
    if (file.type !== "addOn" || file.addOn.meta.core !== core.pack.meta.id) continue;
    const { id, version } = file.addOn.meta;
    const kept = newest.get(id);
    if (kept === undefined || isNewer(version, kept.version)) newest.set(id, { text, version });
  }
  return ok({ core: core.text, addOns: [...newest.values()].map(({ text }) => text) });
}
