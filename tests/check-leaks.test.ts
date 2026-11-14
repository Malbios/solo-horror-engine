import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/check-leaks.mjs");
const syntheticTerm = "Zebra Lantern";
const emDash = String.fromCharCode(0x2014);
let repo: string;

function run(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

function git(...args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}

function stage(path: string, content: string): void {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), content);
  git("add", "--", path);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "check-leaks-"));
  git("init", "--quiet");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("check-leaks", () => {
  it("passes a clean repo without a terms file", () => {
    stage("notes.txt", "nothing to see\n");
    expect(run(repo).status).toBe(0);
  });

  it("fails when a private file is tracked", () => {
    stage("Content/Private/thing.txt", "x\n");
    const result = run(repo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Private files are tracked");
  });

  it("fails on a staged term despite case, hyphens and line breaks", () => {
    const byteOrderMark = String.fromCharCode(0xfeff);
    writeFileSync(
      join(repo, ".private-terms.txt"),
      `${byteOrderMark}# comment\r\n${syntheticTerm}\r\n\r\n`,
    );
    stage("doc.md", "the zebra-\nLANTERN appears\n");
    const result = run(repo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("zebra lantern");
  });

  it("matches whole words and plurals, not fragments inside words", () => {
    writeFileSync(join(repo, ".private-terms.txt"), "Lant\nZebra Lantern\n");
    stage("ok.ts", "const lantern = slantedValue + zebraLanternish;\n");
    expect(run(repo).status).toBe(0);
    stage("bad.ts", "const count = zebraLanterns.length;\n");
    expect(run(repo).status).toBe(1);
  });

  it("fails on a staged path matching a term", () => {
    writeFileSync(join(repo, ".private-terms.txt"), `${syntheticTerm}\n`);
    stage("zebra_lantern.txt", "fine\n");
    expect(run(repo).status).toBe(1);
  });

  it("refuses a terms file with no terms", () => {
    writeFileSync(join(repo, ".private-terms.txt"), "# only comments\n\n");
    expect(run(repo).status).toBe(2);
  });

  it("fails on an em dash in staged lines", () => {
    stage("doc.md", `a ${emDash} b\n`);
    expect(run(repo).status).toBe(1);
  });

  it("checks commit messages and ignores comment lines", () => {
    writeFileSync(join(repo, ".private-terms.txt"), `${syntheticTerm}\n`);
    writeFileSync(join(repo, "ok-msg"), "Add thing\n# zebra lantern in a comment\n");
    writeFileSync(join(repo, "bad-msg"), "Add zebra lantern\n");
    writeFileSync(join(repo, "dash-msg"), `Add a ${emDash} b\n`);
    expect(run(repo, "--commit-msg", "ok-msg").status).toBe(0);
    expect(run(repo, "--commit-msg", "bad-msg").status).toBe(1);
    expect(run(repo, "--commit-msg", "dash-msg").status).toBe(1);
  });

  it("scans a directory with an explicit terms file", () => {
    writeFileSync(join(repo, "terms.txt"), `${syntheticTerm}\n`);
    mkdirSync(join(repo, "out", "assets"), { recursive: true });
    writeFileSync(join(repo, "out", "assets", "a.js"), "const x = 'Zebra Lantern';");
    expect(run(repo, "--terms", "terms.txt", "--scan-dir", "out").status).toBe(1);
    writeFileSync(join(repo, "out", "assets", "a.js"), "const x = 1;");
    expect(run(repo, "--terms", "terms.txt", "--scan-dir", "out").status).toBe(0);
  });
});
