import type { CounterShow, Die, GameView, UnitState, ViewCard } from "../core";
import { h } from "./dom";
import { symbolCounts, type Labels } from "./labels";

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

/** Attributes to show: never hidden ones, and "flag" ones only while not 0. */
export function shownAttributes(unit: UnitState, labels: Labels): [string, number][] {
  const definitions = labels.rules.unitKindById.get(unit.kind)?.attributes ?? [];
  return Object.entries(unit.attributes).filter(([id, value]) => {
    const definition = definitions.find((candidate) => candidate.id === id);
    if (definition === undefined) return true;
    if (definition.hidden) return false;
    return definition.show !== "flag" || value !== 0;
  });
}

function unitCard(unit: UnitState, labels: Labels): HTMLElement {
  const attributes = shownAttributes(unit, labels).map(([id, value]) =>
    stat(labels.attribute(unit.kind, id), String(value)),
  );
  return h("section", { className: "unit" }, [
    h("h3", { text: labels.unit(unit.id) }),
    h("p", { className: "muted", text: placementText(unit, labels) }),
    attributes.length === 0 ? null : h("dl", { className: "stats" }, attributes),
  ]);
}

/** Remembers which "More" sections are open across re-renders. */
export type MoreState = { isOpen(key: string): boolean; setOpen(key: string, open: boolean): void };

function moreSection(key: string, rows: HTMLElement[], more: MoreState): HTMLElement | null {
  if (rows.length === 0) return null;
  const details = h("details", { className: "more" }, [
    h("summary", { className: "more-summary", text: "More" }),
    h("div", { className: "more-rows" }, rows),
  ]);
  details.open = more.isOpen(key);
  details.addEventListener("toggle", () => more.setOpen(key, details.open));
  return details;
}

function compactRow(label: string, value: string, extra: HTMLElement[] = []): HTMLElement {
  return h("div", { className: "compact-row" }, [
    h("span", { className: "compact-label", text: label }),
    h("span", { className: "compact-value", text: value }),
    ...extra,
  ]);
}

function counterShow(id: string, labels: Labels): CounterShow | "hidden" {
  const definition = labels.rules.counterById.get(id);
  if (definition === undefined) return "normal";
  return definition.hidden ? "hidden" : definition.show;
}

/** Pieces without attributes are counted per kind instead of listed one by one. */
export function piecesWithoutAttributes(
  shown: GameView,
  labels: Labels,
): { kind: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const unit of Object.values(shown.units)) {
    if (shownAttributes(unit, labels).length > 0) continue;
    counts.set(unit.kind, (counts.get(unit.kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, count]) => ({ kind, name: labels.unitKind(kind), count }));
}

function poolTitle(pool: string, dice: readonly Die[], labels: Labels): string {
  const name = labels.rules.pools.find((candidate) => candidate.id === pool)?.name ?? pool;
  const counts = symbolCounts(dice, labels.rules);
  return counts === "" ? name : `${name}: ${counts}`;
}

export function renderTracks(shown: GameView, labels: Labels, more: MoreState): HTMLElement {
  const countersShown = (show: CounterShow) =>
    Object.entries(shown.counters).filter(([id]) => counterShow(id, labels) === show);
  const maxOf = (id: string) => labels.rules.counterById.get(id)?.max ?? null;
  const counters = countersShown("normal").map(([id, value]) =>
    stat(labels.counter(id), counterValue(value, maxOf(id))),
  );
  const minor = countersShown("minor").map(([id, value]) =>
    compactRow(labels.counter(id), counterValue(value, maxOf(id))),
  );
  const pieces = piecesWithoutAttributes(shown, labels).map(({ name, count }) =>
    stat(`${name} pieces`, String(count)),
  );
  const pools = Object.entries(shown.pools).filter(([, dice]) => dice.length > 0);
  return h("div", { className: "panel-body" }, [
    counters.length + pieces.length === 0
      ? null
      : h("dl", { className: "stats" }, [...counters, ...pieces]),
    ...Object.values(shown.units)
      .filter((unit) => shownAttributes(unit, labels).length > 0)
      .map((unit) => unitCard(unit, labels)),
    ...pools.map(([pool, dice]) =>
      h("section", { className: "pool" }, [
        h("h3", { text: poolTitle(pool, dice, labels) }),
        h(
          "ul",
          { className: "dice" },
          dice.map((die) =>
            h("li", { className: "die", text: die.face, attrs: { title: die.id } }),
          ),
        ),
      ]),
    ),
    moreSection("tracks", minor, more),
  ]);
}

export type CardGroup = { card: ViewCard; copies: number };

/** Face-up cards that look the same (definition and counters) as one group, in first-seen order. */
export function groupCopies(cards: readonly ViewCard[]): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const card of cards) {
    const key =
      card.card === null
        ? `hidden:${card.ref}`
        : `${card.card}:${JSON.stringify(card.counters ?? {})}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { card, copies: 1 });
    else group.copies += 1;
  }
  return [...groups.values()];
}

/** Revealed lines already shown once, so only a newly revealed line plays its reveal. */
const shownLines = new Set<string>();

function revealedLine(card: ViewCard, text: string, index: number): HTMLElement {
  const key = `${card.ref}:${index}`;
  const fresh = !shownLines.has(key);
  shownLines.add(key);
  return h("li", { className: fresh ? "veil-line veil-line-new" : "veil-line", text });
}

/** A face-down card with some parts revealed: the revealed lines over a veil hiding the rest. */
function veiledTile(card: ViewCard, labels: Labels, onOpen: CardHandler): HTMLButtonElement {
  const lines = card.revealed ?? [];
  return h(
    "button",
    {
      className: "card card-veiled",
      attrs: { "aria-label": `${labels.card(card)}, ${lines.length} revealed, details` },
      onClick: () => onOpen(card),
    },
    [
      h("span", { className: "card-name", text: labels.card(card) }),
      h(
        "ol",
        { className: "veil-lines" },
        lines.map((text, index) => revealedLine(card, text, index)),
      ),
      h("span", { className: "veil-rest", attrs: { "aria-hidden": "true" } }),
    ],
  );
}

export function cardTile(
  card: ViewCard,
  labels: Labels,
  onOpen: CardHandler,
  copies = 1,
): HTMLButtonElement {
  if (card.card === null && (card.revealed?.length ?? 0) > 0)
    return veiledTile(card, labels, onOpen);
  const definition = labels.cardDefinition(card);
  const copiesText = copies > 1 ? `, ${copies} copies` : "";
  return h(
    "button",
    {
      className: card.card === null ? "card card-back" : "card",
      attrs: { "aria-label": `${labels.card(card)}${copiesText}, details` },
      onClick: () => onOpen(card),
    },
    [
      h("span", { className: "card-name" }, [
        labels.card(card),
        copies > 1 ? h("span", { className: "card-copies", text: `×${copies}` }) : null,
      ]),
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
  const allHidden =
    cards.length > 0 && cards.every((card) => card.card === null && card.revealed === undefined);
  const body = allHidden
    ? h("div", { className: "card card-back card-stack", attrs: { "aria-hidden": "true" } }, [
        h("span", { className: "card-name", text: `${cards.length}` }),
      ])
    : h(
        "div",
        { className: "card-row" },
        groupCopies(cards).map(({ card, copies }) => cardTile(card, labels, onOpen, copies)),
      );
  return h("section", { className: "zone" }, [
    h("h3", {}, [labels.zone(zone), h("span", { className: "count", text: ` ${cards.length}` })]),
    cards.length === 0 ? h("p", { className: "muted", text: "Empty" }) : body,
  ]);
}

export type ZoneLayout = { main: string[]; normal: string[]; empty: string[]; minor: string[] };

/** Main zones first, then normal ones with cards; empty normal zones and minor zones are listed apart. */
export function zoneLayout(shown: GameView, labels: Labels): ZoneLayout {
  const showOf = (id: string) =>
    labels.rules.zones.find((zone) => zone.id === id)?.show ?? "normal";
  const layout: ZoneLayout = { main: [], normal: [], empty: [], minor: [] };
  for (const [zone, cards] of Object.entries(shown.zones)) {
    const show = showOf(zone);
    if (show === "main") layout.main.push(zone);
    else if (show === "minor") layout.minor.push(zone);
    else if (cards.length === 0) layout.empty.push(zone);
    else layout.normal.push(zone);
  }
  return layout;
}

function minorZoneRow(
  zone: string,
  cards: readonly ViewCard[],
  labels: Labels,
  onOpen: CardHandler,
): HTMLElement {
  const faceUp = groupCopies(cards.filter((card) => card.card !== null));
  return compactRow(
    labels.zone(zone),
    String(cards.length),
    faceUp.map(({ card, copies }) =>
      h("button", {
        className: "chip",
        text: copies > 1 ? `${labels.card(card)} ×${copies}` : labels.card(card),
        attrs: { "aria-label": `${labels.card(card)}, details` },
        onClick: () => onOpen(card),
      }),
    ),
  );
}

export function renderZones(
  shown: GameView,
  labels: Labels,
  onOpen: CardHandler,
  more: MoreState,
): HTMLElement {
  const layout = zoneLayout(shown, labels);
  const cardsIn = (zone: string) => shown.zones[zone] ?? [];
  const section = (zone: string) => zoneSection(zone, cardsIn(zone), labels, onOpen);
  return h("div", { className: "panel-body" }, [
    ...layout.main.map(section),
    ...layout.normal.map(section),
    layout.empty.length === 0
      ? null
      : h("p", {
          className: "muted",
          text: `Empty: ${layout.empty.map((zone) => labels.zone(zone)).join(", ")}`,
        }),
    moreSection(
      "zones",
      layout.minor.map((zone) => minorZoneRow(zone, cardsIn(zone), labels, onOpen)),
      more,
    ),
  ]);
}

export function renderLog(entries: readonly LogEntry[]): HTMLElement {
  return h("div", { className: "panel-body" }, [
    entries.length === 0
      ? h("p", { className: "muted", text: "Nothing yet." })
      : h(
          "ol",
          { className: "log" },
          entries.map((entry) =>
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
