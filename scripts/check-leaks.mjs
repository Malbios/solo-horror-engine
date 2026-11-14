#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DEFAULT_TERMS_FILE = ".private-terms.txt";
const PRIVATE_PATHSPEC = ":(icase)content/private";
const BYTE_ORDER_MARK_PREFIX = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const EM_DASH = String.fromCharCode(0x2014);

function parseArgs(argv) {
  const options = { termsFile: DEFAULT_TERMS_FILE, commitMsgFile: null, scanDir: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === "--terms") options.termsFile = value;
    else if (flag === "--commit-msg") options.commitMsgFile = value;
    else if (flag === "--scan-dir") options.scanDir = value;
    else throw new Error(`Unknown argument ${flag}`);
    i++;
  }
  return options;
}

function git(args) {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function normalise(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function loadTerms(termsFile) {
  if (!existsSync(termsFile)) return null;
  const terms = readFileSync(termsFile, "utf8")
    .replace(BYTE_ORDER_MARK_PREFIX, "")
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map(normalise)
    .filter((term) => term !== "");
  if (terms.length === 0) {
    throw new Error(`${termsFile} exists but contains no terms; refusing to pass silently.`);
  }
  return terms;
}

function findTerms(text, terms) {
  const haystack = ` ${normalise(text)} `;
  return terms.filter((term) => haystack.includes(term));
}

function stagedAddedLinesByFile() {
  const diff = git(["diff", "--cached", "--no-color", "--no-ext-diff", "-U0", "--no-renames"]);
  const byFile = new Map();
  let currentFile = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      currentFile = line === "+++ /dev/null" ? null : line.slice("+++ b/".length);
      if (currentFile !== null && !byFile.has(currentFile)) byFile.set(currentFile, []);
    } else if (currentFile !== null && line.startsWith("+")) {
      byFile.get(currentFile).push(line.slice(1));
    }
  }
  return byFile;
}

function listFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map((entry) => join(dir, String(entry)))
    .filter((path) => statSync(path).isFile());
}

function checkTrackedPrivateFiles(problems) {
  const tracked = git(["ls-files", "--", PRIVATE_PATHSPEC]).trim();
  if (tracked !== "") {
    problems.push(`Private files are tracked by git:\n${tracked}`);
  }
}

function checkStaged(terms, problems) {
  const stagedPaths = git(["diff", "--cached", "--name-only", "--no-renames"])
    .split("\n")
    .filter(Boolean);
  if (terms !== null) {
    for (const path of stagedPaths) {
      for (const term of findTerms(path, terms))
        problems.push(`Staged path ${path} matches "${term}"`);
    }
  }
  for (const [file, lines] of stagedAddedLinesByFile()) {
    if (lines.some((line) => line.includes(EM_DASH))) {
      problems.push(`${file}: added lines contain an em dash (U+2014)`);
    }
    if (terms !== null) {
      for (const term of findTerms(lines.join(" "), terms)) {
        problems.push(`${file}: added lines match "${term}"`);
      }
    }
  }
}

function checkCommitMessage(file, terms, problems) {
  const message = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  if (message.includes(EM_DASH)) problems.push("Commit message contains an em dash (U+2014)");
  if (terms !== null) {
    for (const term of findTerms(message, terms)) problems.push(`Commit message matches "${term}"`);
  }
}

function checkDirectory(dir, terms, problems) {
  if (terms === null) return;
  for (const path of listFiles(dir)) {
    for (const term of findTerms(readFileSync(path, "utf8"), terms)) {
      problems.push(`${relative(process.cwd(), path)} matches "${term}"`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const terms = loadTerms(options.termsFile);
  const problems = [];
  if (options.commitMsgFile !== null) {
    checkCommitMessage(options.commitMsgFile, terms, problems);
  } else if (options.scanDir !== null) {
    checkDirectory(options.scanDir, terms, problems);
  } else {
    checkTrackedPrivateFiles(problems);
    checkStaged(terms, problems);
  }
  if (problems.length > 0) {
    console.error(`check:leaks failed:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  const termNote = terms === null ? "no private terms file" : `${terms.length} private terms`;
  console.log(`check:leaks passed (${termNote}).`);
}

try {
  main();
} catch (error) {
  console.error(`check:leaks error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
