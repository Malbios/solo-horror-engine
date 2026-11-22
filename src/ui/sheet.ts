import type { Cost, CostDue, GameView, Space, ViewCard } from "../core";
import { h, type Child } from "./dom";
import { describeMarkFrom, knownCosts, priceText, type Labels } from "./labels";
import { zoneNotesList } from "./panels";

export type Sheet = {
  open: (title: string, body: readonly Child[]) => void;
  close: () => void;
};

/** A bottom sheet on a modal dialog: opens on tap, stays until closed by button, Escape or backdrop. */
export function createSheet(dialog: HTMLDialogElement): Sheet {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return {
    open(title, body) {
      dialog.replaceChildren(
        h("div", { className: "sheet-inner" }, [
          h("header", { className: "sheet-header" }, [
            h("h2", { text: title }),
            h("button", {
              className: "close",
              text: "Close",
              onClick: () => dialog.close(),
            }),
          ]),
          h("div", { className: "sheet-body" }, body),
        ]),
      );
      if (!dialog.open) dialog.showModal();
    },
    close() {
      dialog.close();
    },
  };
}

/** A cost line: the current amounts when known, else only the amounts fixed in the card; nothing left, no line. */
function costLine(
  title: string,
  costs: readonly Cost[],
  current: CostDue[] | null,
  labels: Labels,
): Child {
  const dues = current ?? knownCosts(costs);
  const text = priceText(dues, labels);
  if (current === null && text === "Free") return null;
  return h("p", { className: "muted", text: `${title}: ${text}` });
}

export type TextPart = { heading: string | null; body: string };

/**
 * A card text split into parts at blank lines; a part of several lines takes its first line as its heading.
 */
export function textParts(text: string): TextPart[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const [first = "", ...rest] = part.split("\n");
      return rest.length === 0
        ? { heading: null, body: first }
        : { heading: first.trim(), body: rest.join("\n").trim() };
    });
}

function cardTextParts(text: string): HTMLElement {
  return h(
    "div",
    { className: "card-parts" },
    textParts(text).map(({ heading, body }) =>
      h("section", { className: "card-part" }, [
        heading === null ? null : h("p", { className: "card-part-heading", text: heading }),
        h("p", { className: "card-part-body", text: body }),
      ]),
    ),
  );
}

export function cardDetails(card: ViewCard, labels: Labels): Child[] {
  const definition = labels.cardDefinition(card);
  const revealed = card.revealed ?? [];
  if (definition === null) {
    return [
      h("p", { className: "muted", text: "Its face is hidden." }),
      revealed.length === 0
        ? null
        : h(
            "ol",
            { className: "veil-lines veil-lines-sheet" },
            revealed.map((text) => h("li", { className: "veil-line", text })),
          ),
    ];
  }
  return [
    definition.image === null
      ? null
      : h("img", {
          className: "card-image",
          attrs: { src: definition.image, alt: definition.name },
        }),
    definition.text === "" ? null : cardTextParts(definition.text),
    zoneNotesList(labels.cardNotes(card)),
    costLine("Cost", definition.cost, null, labels),
    definition.buyCost.length === 0
      ? null
      : costLine("Price", definition.buyCost, labels.price(card), labels),
    definition.abilities.length === 0
      ? null
      : h(
          "ul",
          { className: "card-abilities" },
          definition.abilities.map((ability) => h("li", { text: ability.label })),
        ),
  ];
}

export function spaceDetails(space: Space, shown: GameView, labels: Labels): Child[] {
  const units = Object.values(shown.units).filter(
    (unit) => unit.placement.type === "space" && unit.placement.space === space.id,
  );
  const counters = Object.entries(shown.spaceCounters[space.id] ?? {}).filter(
    ([, value]) => value !== 0,
  );
  const marks = labels
    .markedEdges()
    .filter((marked) => marked.edge.fromSpace === space.id || marked.edge.toSpace === space.id);
  return [
    units.length === 0
      ? h("p", { className: "muted", text: "No pieces here." })
      : h(
          "ul",
          { className: "plain-list" },
          units
            .map((unit) => labels.piece(unit.id))
            .sort((a, b) => a.localeCompare(b))
            .map((name) => h("li", { text: name })),
        ),
    marks.length === 0
      ? null
      : h(
          "ul",
          { className: "plain-list" },
          marks.map((marked) => h("li", { text: describeMarkFrom(marked, space.id, labels) })),
        ),
    counters.length === 0
      ? null
      : h(
          "dl",
          { className: "stats" },
          counters.map(([id, value]) =>
            h("div", { className: "stat" }, [
              h("dt", { text: labels.spaceCounter(id) }),
              h("dd", { text: String(value) }),
            ]),
          ),
        ),
  ];
}
