import { parsePack, type PackIssue } from "../content";
import { err, ok, type Pack, type Result } from "../core";

const ISSUES_SHOWN = 5;

export interface PackStore {
  load(): string | null;
  save(text: string): boolean;
  clear(): void;
}

export class LocalStoragePackStore implements PackStore {
  constructor(
    private readonly key: string,
    private readonly storage: Storage,
  ) {}

  load(): string | null {
    try {
      return this.storage.getItem(this.key);
    } catch {
      return null;
    }
  }

  save(text: string): boolean {
    try {
      this.storage.setItem(this.key, text);
      return true;
    } catch (error) {
      console.warn("Could not store pack", error);
      return false;
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch (error) {
      console.warn("Could not clear stored pack", error);
    }
  }
}

function describeIssues(issues: PackIssue[]): string[] {
  const shown = issues
    .slice(0, ISSUES_SHOWN)
    .map((issue) => `${issue.path === "" ? "(pack)" : issue.path}: ${issue.message}`);
  const hidden = issues.length - shown.length;
  return hidden > 0 ? [...shown, `and ${hidden} more`] : shown;
}

export function parsePackText(text: string): Result<Pack, string[]> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return err([`The file is not valid JSON (${reason}).`]);
  }
  const parsed = parsePack(data);
  if (parsed.ok) return ok(parsed.value);
  return err(["The file is not a valid pack.", ...describeIssues(parsed.error.issues)]);
}
