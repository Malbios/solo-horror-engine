import type { GameView } from "../core";
import { h } from "./dom";
import { pinnedZone, type Labels } from "./labels";

export type StatusItem = { label: string; value: string | null; flag: boolean };

/**
 * What the status strip shows: main counters, main attributes of each piece, and flag counters
 * that are not 0 (named only, with the value when it is more than 1).
 */
export function statusItems(shown: GameView, labels: Labels): StatusItem[] {
  const items: StatusItem[] = [];
  const flags: StatusItem[] = [];
  for (const [id, value] of Object.entries(shown.counters)) {
    const definition = labels.rules.counterById.get(id);
    if (definition === undefined || definition.hidden || pinnedZone(labels.rules, id) !== null)
      continue;
    if (definition.show === "main") {
      const max = definition.max === null ? "" : `/${definition.max}`;
      items.push({ label: definition.name, value: `${value}${max}`, flag: false });
    } else if (definition.show === "flag" && value !== 0) {
      flags.push({ label: definition.name, value: value === 1 ? null : String(value), flag: true });
    }
  }
  for (const unit of Object.values(shown.units)) {
    const kind = labels.rules.unitKindById.get(unit.kind);
    for (const [id, value] of Object.entries(unit.attributes)) {
      const attribute = kind?.attributes.find((candidate) => candidate.id === id);
      if (attribute?.show !== "main") continue;
      items.push({
        label: `${labels.piece(unit.id)} ${attribute.name}`,
        value: String(value),
        flag: false,
      });
    }
  }
  return [...items, ...flags];
}

export function renderStatus(shown: GameView, labels: Labels): HTMLElement[] {
  return statusItems(shown, labels).map((item) =>
    h("span", { className: item.flag ? "status-item status-flag" : "status-item" }, [
      h("span", { className: "status-label", text: item.label }),
      item.value === null ? null : h("span", { className: "status-value", text: item.value }),
    ]),
  );
}
