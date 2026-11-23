import type { CounterShow, GameView, UnitState, ViewCard } from "../core";
import { h } from "./dom";
import { amountText, pinnedZone, type Labels } from "./labels";

/** Opening a card's details (tap) and previewing them while an element is hovered or keyboard-focused. */
export type CardHandlers = {
  open: (card: ViewCard) => void;
  preview: (target: HTMLElement, card: ViewCard) => void;
};

/** Attaches the card's preview to `element` and returns it. */
function previewed<T extends HTMLElement>(element: T, card: ViewCard, handlers: CardHandlers): T {
  handlers.preview(element, card);
  return element;
}

export type LogEntry = { title: string; lines: string[] };

function stat(label: string, value: string): HTMLElement {
  return h("div", { className: "stat" }, [h("dt", { text: label }), h("dd", { text: value })]);
}

/** The counters shown with a zone's cards, one line each; nothing when there are none. */
export function zoneNotesList(notes: readonly string[]): HTMLElement | null {
  return notes.length === 0
    ? null
    : h(
        "ul",
        { className: "zone-notes" },
        notes.map((note) => h("li", { text: note })),
      );
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

/** Attributes for the piece's card in the panel: shown ones that the status strip does not show already. */
export function panelAttributes(unit: UnitState, labels: Labels): [string, number][] {
  const definitions = labels.rules.unitKindById.get(unit.kind)?.attributes ?? [];
  return shownAttributes(unit, labels).filter(
    ([id]) => definitions.find((definition) => definition.id === id)?.show !== "main",
  );
}

function unitCard(unit: UnitState, labels: Labels): HTMLElement {
  const definitions = labels.rules.unitKindById.get(unit.kind)?.attributes ?? [];
  const attributes = panelAttributes(unit, labels).map(([id, value]) =>
    stat(
      labels.attribute(unit.kind, id),
      amountText(
        definitions.find((definition) => definition.id === id),
        value,
        false,
      ),
    ),
  );
  return h("section", { className: "unit" }, [
    h("h3", { text: labels.unit(unit.id) }),
    h("p", { className: "muted", text: placementText(unit, labels) }),
    attributes.length === 0 ? null : h("dl", { className: "stats" }, attributes),
  ]);
}

/** Remembers which "More" sections are open across re-renders. */
export type MoreState = { isOpen(key: string): boolean; setOpen(key: string, open: boolean): void };

/** The fold's label: what tapping it does next. */
export function moreLabel(open: boolean): string {
  return open ? "Less" : "More";
}

function moreSection(key: string, rows: HTMLElement[], more: MoreState): HTMLElement | null {
  if (rows.length === 0) return null;
  const open = more.isOpen(key);
  const summary = h("summary", { className: "more-summary", text: moreLabel(open) });
  const details = h("details", { className: "more" }, [
    summary,
    h("div", { className: "more-rows" }, rows),
  ]);
  details.open = open;
  details.addEventListener("toggle", () => {
    more.setOpen(key, details.open);
    summary.textContent = moreLabel(details.open);
  });
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
  return definition.hidden || pinnedZone(labels.rules, id) !== null ? "hidden" : definition.show;
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

export function renderTracks(shown: GameView, labels: Labels, more: MoreState): HTMLElement {
  const countersShown = (show: CounterShow) =>
    Object.entries(shown.counters).filter(([id]) => counterShow(id, labels) === show);
  const amount = (id: string, value: number) =>
    amountText(labels.rules.counterById.get(id), value, true);
  const counters = countersShown("normal").map(([id, value]) =>
    stat(labels.counter(id), amount(id, value)),
  );
  const minor = countersShown("minor").map(([id, value]) =>
    compactRow(labels.counter(id), amount(id, value)),
  );
  const pieces = piecesWithoutAttributes(shown, labels).map(({ name, count }) =>
    stat(`${name} pieces`, String(count)),
  );
  return h("div", { className: "panel-body" }, [
    counters.length + pieces.length === 0
      ? null
      : h("dl", { className: "stats" }, [...counters, ...pieces]),
    ...Object.values(shown.units)
      .filter((unit) => panelAttributes(unit, labels).length > 0)
      .map((unit) => unitCard(unit, labels)),
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
function veiledTile(card: ViewCard, labels: Labels, handlers: CardHandlers): HTMLButtonElement {
  const lines = card.revealed ?? [];
  const tile = h(
    "button",
    {
      className: "card card-veiled",
      attrs: { "aria-label": `${labels.card(card)}, ${lines.length} revealed, details` },
      onClick: () => handlers.open(card),
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
  return previewed(tile, card, handlers);
}

export function cardTile(
  card: ViewCard,
  labels: Labels,
  handlers: CardHandlers,
  copies = 1,
  flags: readonly string[] = [],
): HTMLButtonElement {
  if (card.card === null && (card.revealed?.length ?? 0) > 0)
    return veiledTile(card, labels, handlers);
  const definition = labels.cardDefinition(card);
  const copiesText = copies > 1 ? `, ${copies} copies` : "";
  const flagsText = flags.map((flag) => `, ${flag}`).join("");
  const className = card.card === null ? "card card-back" : "card";
  const tile = h(
    "button",
    {
      className: flags.length > 0 ? `${className} card-marked` : className,
      attrs: { "aria-label": `${labels.card(card)}${copiesText}${flagsText}, details` },
      onClick: () => handlers.open(card),
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
  return previewed(tile, card, handlers);
}

function zoneSection(
  zone: string,
  cards: readonly ViewCard[],
  labels: Labels,
  handlers: CardHandlers,
  more: MoreState,
): HTMLElement {
  const allHidden =
    cards.length > 0 && cards.every((card) => card.card === null && card.revealed === undefined);
  const flags = labels.zoneFlags(zone);
  const body = allHidden
    ? h("div", { className: "card card-back card-stack", attrs: { "aria-hidden": "true" } }, [
        h("span", { className: "card-name", text: `${cards.length}` }),
      ])
    : h(
        "div",
        { className: "card-row" },
        groupCopies(cards).map(({ card, copies }) =>
          cardTile(card, labels, handlers, copies, card.card === null ? [] : flags),
        ),
      );
  const heading = h("h3", {}, [
    labels.zone(zone),
    h("span", { className: "count", text: ` ${cards.length}` }),
  ]);
  const content = [
    zoneNotesList(labels.zoneNotes(zone)),
    cards.length === 0 ? h("p", { className: "muted", text: "Empty" }) : body,
  ];
  const folds = labels.rules.zones.find((candidate) => candidate.id === zone)?.fold ?? false;
  if (!folds) return h("section", { className: "zone" }, [heading, ...content]);
  const key = `folded:${zone}`;
  const details = h("details", { className: "zone zone-fold" }, [
    h("summary", { className: "zone-fold-summary" }, [heading]),
    ...content,
  ]);
  details.open = !more.isOpen(key);
  details.addEventListener("toggle", () => more.setOpen(key, !details.open));
  return details;
}

export type ZoneLayout = { rows: string[][]; empty: string[]; minor: string[] };

type PlacedZone = { id: string; group: number; order: number; row: string | null };

/** Rows to draw, in order: zones sharing a row side by side, where the first of them would be. */
function zoneRows(zones: readonly PlacedZone[]): string[][] {
  const rows: string[][] = [];
  const byRow = new Map<string, string[]>();
  for (const zone of zones) {
    const shared = zone.row === null ? undefined : byRow.get(zone.row);
    if (shared !== undefined) {
      shared.push(zone.id);
      continue;
    }
    const row = [zone.id];
    rows.push(row);
    if (zone.row !== null) byRow.set(zone.row, row);
  }
  return rows;
}

/**
 * Main zones and normal ones with cards, by `order` (none last), then main first, then pack order, in rows;
 * empty normal zones and minor zones are listed apart.
 */
export function zoneLayout(shown: GameView, labels: Labels): ZoneLayout {
  const drawn: PlacedZone[] = [];
  const empty: string[] = [];
  const minor: string[] = [];
  for (const [id, cards] of Object.entries(shown.zones)) {
    const zone = labels.rules.zones.find((candidate) => candidate.id === id);
    const show = zone?.show ?? "normal";
    if (show === "minor") minor.push(id);
    else if (show === "normal" && cards.length === 0) empty.push(id);
    else
      drawn.push({
        id,
        group: show === "main" ? 0 : 1,
        order: zone?.order ?? Number.MAX_SAFE_INTEGER,
        row: zone?.row ?? null,
      });
  }
  drawn.sort((a, b) => a.order - b.order || a.group - b.group);
  return { rows: zoneRows(drawn), empty, minor };
}

function minorZoneRow(
  zone: string,
  cards: readonly ViewCard[],
  labels: Labels,
  handlers: CardHandlers,
): HTMLElement {
  const faceUp = groupCopies(cards.filter((card) => card.card !== null));
  return compactRow(
    labels.zone(zone),
    String(cards.length),
    faceUp.map(({ card, copies }) =>
      previewed(
        h("button", {
          className: "chip",
          text: copies > 1 ? `${labels.card(card)} ×${copies}` : labels.card(card),
          attrs: { "aria-label": `${labels.card(card)}, details` },
          onClick: () => handlers.open(card),
        }),
        card,
        handlers,
      ),
    ),
  );
}

export function renderZones(
  shown: GameView,
  labels: Labels,
  handlers: CardHandlers,
  more: MoreState,
): HTMLElement {
  const layout = zoneLayout(shown, labels);
  const cardsIn = (zone: string) => shown.zones[zone] ?? [];
  const section = (zone: string) => zoneSection(zone, cardsIn(zone), labels, handlers, more);
  return h("div", { className: "panel-body" }, [
    ...layout.rows.map((row) =>
      row.length === 1
        ? section(row[0] ?? "")
        : h("div", { className: "zone-row" }, row.map(section)),
    ),
    layout.empty.length === 0
      ? null
      : h("p", {
          className: "muted",
          text: `Empty: ${layout.empty.map((zone) => labels.zone(zone)).join(", ")}`,
        }),
    moreSection(
      "zones",
      layout.minor.map((zone) => minorZoneRow(zone, cardsIn(zone), labels, handlers)),
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
