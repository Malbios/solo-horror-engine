import type { Content, Procedure } from "./pack";

type CallSite = { procedure: string; args: string[] };

type Usage = { calls: CallSite[]; argNames: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCall(value: Record<string, unknown>): boolean {
  return value["type"] === "call" && typeof value["procedure"] === "string";
}

function collectUsage(value: unknown, usage: Usage): void {
  if (Array.isArray(value)) {
    for (const item of value) collectUsage(item, usage);
    return;
  }
  if (!isRecord(value)) return;
  if (isCall(value)) {
    const args = isRecord(value["args"]) ? value["args"] : {};
    usage.calls.push({ procedure: String(value["procedure"]), args: Object.keys(args) });
  }
  const arg = value["arg"];
  if (typeof arg === "string" && Object.keys(value).length === 1) usage.argNames.push(arg);
  for (const child of Object.values(value)) collectUsage(child, usage);
}

function usageOf(value: unknown): Usage {
  const usage: Usage = { calls: [], argNames: [] };
  collectUsage(value, usage);
  return usage;
}

function callIssues(calls: readonly CallSite[], definitions: readonly Procedure[]): string[] {
  return calls.flatMap((call) =>
    definitions
      .filter((definition) => definition.id === call.procedure)
      .flatMap((definition) => [
        ...definition.params
          .filter((param) => !call.args.includes(param))
          .map((param) => `call to procedure "${call.procedure}" is missing arg "${param}"`),
        ...call.args
          .filter((arg) => !definition.params.includes(arg))
          .map((arg) => `call to procedure "${call.procedure}" has unknown arg "${arg}"`),
      ]),
  );
}

function outsideContent(content: Content): Content {
  return { ...content, procedures: [] };
}

function findCycle(edges: ReadonlyMap<string, ReadonlySet<string>>): string[] | null {
  const done = new Set<string>();
  const visit = (id: string, path: readonly string[]): string[] | null => {
    const start = path.indexOf(id);
    if (start >= 0) return [...path.slice(start), id];
    if (done.has(id)) return null;
    for (const next of edges.get(id) ?? []) {
      const cycle = visit(next, [...path, id]);
      if (cycle !== null) return cycle;
    }
    done.add(id);
    return null;
  };
  for (const id of [...edges.keys()].sort()) {
    const cycle = visit(id, []);
    if (cycle !== null) return cycle;
  }
  return null;
}

/**
 * Checks calls and arguments across all given contents: every call passes exactly the params of
 * each definition of its procedure, args are only read inside a procedure that declares them, and
 * procedures never call themselves directly or indirectly. Unknown procedures are left to the
 * reference check.
 */
export function procedureIssues(contents: readonly Content[]): string[] {
  const definitions = contents.flatMap((content) => content.procedures);
  const issues: string[] = [];
  const edges = new Map<string, Set<string>>();
  for (const content of contents) {
    const outside = usageOf(outsideContent(content));
    issues.push(...callIssues(outside.calls, definitions));
    issues.push(...outside.argNames.map((name) => `arg "${name}" is read outside a procedure`));
    for (const procedure of content.procedures) {
      const inside = usageOf(procedure.effects);
      issues.push(...callIssues(inside.calls, definitions));
      issues.push(
        ...inside.argNames
          .filter((name) => !procedure.params.includes(name))
          .map((name) => `procedure "${procedure.id}" reads undeclared arg "${name}"`),
      );
      const targets = edges.get(procedure.id) ?? new Set<string>();
      for (const call of inside.calls) targets.add(call.procedure);
      edges.set(procedure.id, targets);
    }
  }
  const cycle = findCycle(edges);
  if (cycle !== null) issues.push(`procedures call each other in a cycle: ${cycle.join(" -> ")}`);
  return [...new Set(issues)];
}
