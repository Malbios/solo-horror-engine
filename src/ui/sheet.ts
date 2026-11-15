import type { Cost, GameView, NumExpr, Space, ViewCard } from "../core";
import { h, type Child } from "./dom";
import type { Labels } from "./labels";

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

function amountText(amount: NumExpr): string {
  return typeof amount === "number" ? String(amount) : "some";
}

function describeCost(cost: Cost, labels: Labels): string {
  if ("counter" in cost) return `${amountText(cost.amount)} ${labels.counter(cost.counter)}`;
  if ("attribute" in cost) return `${amountText(cost.amount)} ${cost.attribute}`;
  return `Discard from ${labels.zone(cost.discard.from)}`;
}

export function cardDetails(card: ViewCard, labels: Labels): Child[] {
  const definition = labels.cardDefinition(card);
  if (definition === null) return [h("p", { className: "muted", text: "Its face is hidden." })];
  return [
    definition.image === null
      ? null
      : h("img", {
          className: "card-image",
          attrs: { src: definition.image, alt: definition.name },
        }),
    definition.text === "" ? null : h("p", { className: "card-text-full", text: definition.text }),
    definition.cost.length === 0
      ? null
      : h("p", {
          className: "muted",
          text: `Cost: ${definition.cost.map((cost) => describeCost(cost, labels)).join(", ")}`,
        }),
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
  return [
    units.length === 0
      ? h("p", { className: "muted", text: "No pieces here." })
      : h(
          "ul",
          { className: "plain-list" },
          units.map((unit) => h("li", { text: labels.unit(unit.id) })),
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
