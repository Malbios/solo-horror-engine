import type { Cost, GameView, Space, ViewCard } from "../core";
import { h, type Child } from "./dom";
import { describeCost, describeMarkFrom, type Labels } from "./labels";

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

function costLine(title: string, costs: readonly Cost[], labels: Labels): Child {
  if (costs.length === 0) return null;
  const text = `${title}: ${costs.map((cost) => describeCost(cost, labels)).join(", ")}`;
  return h("p", { className: "muted", text });
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
    definition.text === "" ? null : h("p", { className: "card-text-full", text: definition.text }),
    costLine("Cost", definition.cost, labels),
    costLine("Price", definition.buyCost, labels),
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
