import type { Edge } from "./pack";

export type UnitPlacement =
  { type: "space"; space: string } | { type: "inside"; unit: string } | { type: "offMap" };

export type UnitState = {
  id: string;
  kind: string;
  placement: UnitPlacement;
  attributes: Record<string, number>;
};

export type Traversable = (edge: Edge) => boolean;

type Direction = "outgoing" | "incoming";

function sortedEdges(edges: Readonly<Record<string, Edge>>): Edge[] {
  return Object.values(edges).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function adjacent(
  edges: Readonly<Record<string, Edge>>,
  space: string,
  traversable: Traversable,
  direction: Direction,
): string[] {
  const found = new Set<string>();
  for (const edge of sortedEdges(edges)) {
    if (!traversable(edge)) continue;
    const [near, far] =
      direction === "outgoing" ? [edge.fromSpace, edge.toSpace] : [edge.toSpace, edge.fromSpace];
    if (near === space) found.add(far);
    if (!edge.directed && far === space) found.add(near);
  }
  return [...found].sort();
}

/** Spaces reachable in one step from `space`, sorted by id. */
export function neighbours(
  edges: Readonly<Record<string, Edge>>,
  space: string,
  traversable: Traversable,
): string[] {
  return adjacent(edges, space, traversable, "outgoing");
}

/** Traversable edges that lead from `from` to `to` in one step, sorted by id. */
export function edgesBetween(
  edges: Readonly<Record<string, Edge>>,
  from: string,
  to: string,
  traversable: Traversable,
): Edge[] {
  return sortedEdges(edges).filter(
    (edge) =>
      traversable(edge) &&
      ((edge.fromSpace === from && edge.toSpace === to) ||
        (!edge.directed && edge.fromSpace === to && edge.toSpace === from)),
  );
}

function breadthFirst(
  edges: Readonly<Record<string, Edge>>,
  start: string,
  traversable: Traversable,
  direction: Direction,
): Map<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index] as string;
    const distance = distances.get(current) ?? 0;
    for (const next of adjacent(edges, current, traversable, direction)) {
      if (!distances.has(next)) {
        distances.set(next, distance + 1);
        queue.push(next);
      }
    }
  }
  return distances;
}

/** Steps needed to reach each space from `origin`. Unreachable spaces are absent. */
export function distancesFrom(
  edges: Readonly<Record<string, Edge>>,
  origin: string,
  traversable: Traversable,
): Map<string, number> {
  return breadthFirst(edges, origin, traversable, "outgoing");
}

/** Steps needed from each space to reach `target`. Unreachable spaces are absent. */
export function distancesTo(
  edges: Readonly<Record<string, Edge>>,
  target: string,
  traversable: Traversable,
): Map<string, number> {
  return breadthFirst(edges, target, traversable, "incoming");
}

/** The space a unit is on, following containers; null when it or a container is off the map. */
export function spaceOfUnit(
  units: Readonly<Record<string, UnitState>>,
  unitId: string,
): string | null {
  const visited = new Set<string>();
  let current = units[unitId];
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    const placement = current.placement;
    if (placement.type === "space") return placement.space;
    if (placement.type === "offMap") return null;
    current = units[placement.unit];
  }
  return null;
}

/** True when `unitId` is `containerId` or is somewhere inside it. */
export function containsOrIs(
  units: Readonly<Record<string, UnitState>>,
  containerId: string,
  unitId: string,
): boolean {
  const visited = new Set<string>();
  let current: string | undefined = unitId;
  while (current !== undefined && !visited.has(current)) {
    if (current === containerId) return true;
    visited.add(current);
    const placement: UnitPlacement | undefined = units[current]?.placement;
    current = placement?.type === "inside" ? placement.unit : undefined;
  }
  return false;
}
