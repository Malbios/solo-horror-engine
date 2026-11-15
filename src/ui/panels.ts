import type { GameView, UnitState, ViewCard } from "../core";
import { h } from "./dom";
import type { Labels } from "./labels";

export type CardHandler = (card: ViewCard) => void;

export type LogEntry = { title: string; lines: string[] };

function stat(label: string, value: string): HTMLElement {
  return h("div", { className: "stat" }, [h("dt", { text: label }), h("dd", { text: value })]);
}

function counterValue(value: number, max: number | null): string {
  return max === null ? String(value) : `${value} / ${max}`;
}

function placementText(unit: UnitState, labels: Labels): string {
  switch (unit.placement.type) {
    case "space":
      return labels.space(unit.placement.space);
    case "inside":
      return `with ${labels.unit(unit.placement.unit)}`;
    case "offMap":
      return "off the board";
  }
}

function unitCard(unit: UnitState, labels: Labels): HTMLElement {
  const attributes = Object.entries(unit.attributes).map(([id, value]) =>
    stat(labels.attribute(unit.kind, id), String(value)),
  );
  return h("section", { className: "unit" }, [
    h("h3", { text: labels.unit(unit.id) }),
    h("p", { className: "muted", text: placementText(unit, labels) }),
    attributes.length === 0 ? null : h("dl", { className: "stats" }, attributes),
  ]);
}

export function renderTracks(shown: GameView, labels: Labels): HTMLElement {
  const counters = Object.entries(shown.counters).map(([id, value]) =>
    stat(labels.counter(id), counterValue(value, labels.rules.counterById.get(id)?.max ?? null)),
  );
  const pools = Object.entries(shown.pools).filter(([, dice]) => dice.length > 0);
  return h("div", { className: "panel-body" }, [
    h("dl", { className: "stats" }, [stat("Round", String(shown.round)), ...counters]),
    ...Object.values(shown.units).map((unit) => unitCard(unit, labels)),
    ...pools.map(([pool, dice]) =>
      h("section", { className: "pool" }, [
        h("h3", { text: pool }),
        h(
          "ul",
          { className: "dice" },
          dice.map((die) =>
            h("li", { className: "die", text: die.face, attrs: { title: die.id } }),
          ),
        ),
      ]),
    ),
  ]);
}

export function cardTile(card: ViewCard, labels: Labels, onOpen: CardHandler): HTMLButtonElement {
  const definition = labels.cardDefinition(card);
  return h(
    "button",
    {
      className: card.card === null ? "card card-back" : "card",
      attrs: { "aria-label": `${labels.card(card)}, details` },
      onClick: () => onOpen(card),
    },
    [
      h("span", { className: "card-name", text: labels.card(card) }),
      definition === null || definition.text === ""
        ? null
        : h("span", { className: "card-text", text: definition.text }),
    ],
  );
}

function zoneSection(
  zone: string,
  cards: readonly ViewCard[],
  labels: Labels,
  onOpen: CardHandler,
): HTMLElement {
  const allHidden = cards.length > 0 && cards.every((card) => card.card === null);
  const body = allHidden
    ? h("div", { className: "card card-back card-stack", attrs: { "aria-hidden": "true" } }, [
        h("span", { className: "card-name", text: `${cards.length}` }),
      ])
    : h(
        "div",
        { className: "card-row" },
        cards.map((card) => cardTile(card, labels, onOpen)),
      );
  return h("section", { className: "zone" }, [
    h("h3", {}, [labels.zone(zone), h("span", { className: "count", text: ` ${cards.length}` })]),
    cards.length === 0 ? h("p", { className: "muted", text: "Empty" }) : body,
  ]);
}

export function renderZones(shown: GameView, labels: Labels, onOpen: CardHandler): HTMLElement {
  return h(
    "div",
    { className: "panel-body" },
    Object.entries(shown.zones).map(([zone, cards]) => zoneSection(zone, cards, labels, onOpen)),
  );
}

export function renderLog(entries: readonly LogEntry[]): HTMLElement {
  return h("div", { className: "panel-body" }, [
    entries.length === 0
      ? h("p", { className: "muted", text: "Nothing yet." })
      : h(
          "ol",
          { className: "log" },
          [...entries].reverse().map((entry) =>
            h("li", { className: "log-entry" }, [
              h("h3", { text: entry.title }),
              entry.lines.length === 0
                ? null
                : h(
                    "ul",
                    { className: "log-lines" },
                    entry.lines.map((line) => h("li", { text: line })),
                  ),
            ]),
          ),
        ),
  ]);
}
