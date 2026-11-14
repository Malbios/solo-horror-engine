import { LAYERED_COLLECTIONS, type Content } from "./pack";

type ReferenceKind = "counter" | "zone" | "card" | "endCondition";

const REFERENCE_KEYS: ReadonlyMap<string, ReferenceKind> = new Map([
  ["counter", "counter"],
  ["zoneCount", "zone"],
  ["zone", "zone"],
  ["from", "zone"],
  ["to", "zone"],
  ["card", "card"],
  ["endCondition", "endCondition"],
]);

const DEFINING_COLLECTIONS: ReadonlyMap<ReferenceKind, (typeof LAYERED_COLLECTIONS)[number]> =
  new Map([
    ["counter", "counters"],
    ["zone", "zones"],
    ["card", "cards"],
    ["endCondition", "endConditions"],
  ]);

function referenceLabel(kind: ReferenceKind, id: string): string {
  return `${kind} "${id}"`;
}

function collectReferences(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, found);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const kind = REFERENCE_KEYS.get(key);
    if (kind !== undefined && typeof child === "string") {
      found.add(referenceLabel(kind, child));
    } else {
      collectReferences(child, found);
    }
  }
}

function definedReferences(contents: readonly Content[]): Set<string> {
  const defined = new Set<string>();
  for (const content of contents) {
    for (const [kind, collection] of DEFINING_COLLECTIONS) {
      const items: readonly { id: string }[] = content[collection];
      for (const item of items) defined.add(referenceLabel(kind, item.id));
    }
  }
  return defined;
}

/** Lists references used anywhere in `using` that no content in `defining` defines. */
export function findMissingReferences(
  using: readonly Content[],
  defining: readonly Content[],
): string[] {
  const used = new Set<string>();
  for (const content of using) collectReferences(content, used);
  const defined = definedReferences(defining);
  return [...used].filter((reference) => !defined.has(reference)).sort();
}
