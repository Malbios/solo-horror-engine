import type {
  Card,
  Content,
  Counter,
  DieType,
  EdgeFilter,
  EndCondition,
  Module,
  Pack,
  Phase,
  QuantityType,
  Space,
  UnitKind,
} from "./pack";
import { findMissingReferences } from "./references";
import { err, ok, type Result } from "./result";

export type Rules = Content & {
  counterById: ReadonlyMap<string, Counter>;
  cardById: ReadonlyMap<string, Card>;
  endConditionById: ReadonlyMap<string, EndCondition>;
  phaseById: ReadonlyMap<string, Phase>;
  spaceById: ReadonlyMap<string, Space>;
  edgeFilterById: ReadonlyMap<string, EdgeFilter>;
  unitKindById: ReadonlyMap<string, UnitKind>;
  spaceCounterById: ReadonlyMap<string, Counter>;
  quantityTypeById: ReadonlyMap<string, QuantityType>;
  dieById: ReadonlyMap<string, DieType>;
};

function layer<T extends { id: string }>(
  current: readonly T[],
  additions: readonly T[],
  removals: readonly string[],
): T[] {
  const result = current.filter((item) => !removals.includes(item.id));
  for (const item of additions) {
    const index = result.findIndex((existing) => existing.id === item.id);
    if (index >= 0) {
      result[index] = item;
    } else {
      result.push(item);
    }
  }
  return result;
}

function applyModule(content: Content, module: Module): Content {
  const { content: added, remove } = module;
  return {
    spaces: layer(content.spaces, added.spaces, remove.spaces),
    edges: layer(content.edges, added.edges, remove.edges),
    edgeFilters: layer(content.edgeFilters, added.edgeFilters, remove.edgeFilters),
    unitKinds: layer(content.unitKinds, added.unitKinds, remove.unitKinds),
    spaceCounters: layer(content.spaceCounters, added.spaceCounters, remove.spaceCounters),
    counters: layer(content.counters, added.counters, remove.counters),
    zones: layer(content.zones, added.zones, remove.zones),
    cards: layer(content.cards, added.cards, remove.cards),
    quantityTypes: layer(content.quantityTypes, added.quantityTypes, remove.quantityTypes),
    modifiers: layer(content.modifiers, added.modifiers, remove.modifiers),
    dice: layer(content.dice, added.dice, remove.dice),
    pools: layer(content.pools, added.pools, remove.pools),
    triggers: layer(content.triggers, added.triggers, remove.triggers),
    checks: layer(content.checks, added.checks, remove.checks),
    endConditions: layer(content.endConditions, added.endConditions, remove.endConditions),
    phases: layer(content.phases, added.phases, remove.phases),
    setup: [...content.setup, ...added.setup],
    round: {
      onEnter: [...content.round.onEnter, ...added.round.onEnter],
      onExit: [...content.round.onExit, ...added.round.onExit],
    },
  };
}

function indexById<T extends { id: string }>(items: readonly T[]): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Applies the chosen modules to the base content, lowest precedence first. */
export function composeRules(pack: Pack, moduleIds: readonly string[]): Result<Rules, string> {
  const chosen: Module[] = [];
  for (const moduleId of moduleIds) {
    const module = pack.modules.find((candidate) => candidate.id === moduleId);
    if (module === undefined) return err(`Unknown module "${moduleId}"`);
    chosen.push(module);
  }
  const ordered = [...chosen].sort(
    (a, b) => a.precedence - b.precedence || pack.modules.indexOf(a) - pack.modules.indexOf(b),
  );
  const content = ordered.reduce(applyModule, pack.base);
  const missing = findMissingReferences([content], [content]);
  if (missing.length > 0) {
    return err(`Composed rules reference undefined ids: ${missing.join(", ")}`);
  }
  return ok({
    ...content,
    counterById: indexById(content.counters),
    cardById: indexById(content.cards),
    endConditionById: indexById(content.endConditions),
    phaseById: indexById(content.phases),
    spaceById: indexById(content.spaces),
    edgeFilterById: indexById(content.edgeFilters),
    unitKindById: indexById(content.unitKinds),
    spaceCounterById: indexById(content.spaceCounters),
    quantityTypeById: indexById(content.quantityTypes),
    dieById: indexById(content.dice),
  });
}
