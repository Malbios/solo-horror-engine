import type { Action, GameView, ViewCard } from "../core";
import { h } from "./dom";
import { describeAction, describeDecision, type Labels } from "./labels";

export type DecisionHandlers = {
  takeAction: (action: Action) => void;
  openCard: (card: ViewCard) => void;
  newGame: () => void;
};

function offeredCard(action: Action, shown: GameView): ViewCard | null {
  if (action.type !== "playCard" && action.type !== "pickCard") return null;
  const pending = shown.pending;
  if (pending?.kind !== "playCard" && pending?.kind !== "pickCard") return null;
  return pending.cards.find((card) => card.ref === action.card) ?? { ref: action.card, card: null };
}

function actionLabel(action: Action, shown: GameView, labels: Labels): string {
  const pending = shown.pending;
  if (action.type === "pickDie" && pending?.kind === "pickDie") {
    const die = shown.pools[pending.pool]?.find((candidate) => candidate.id === action.die);
    return die === undefined
      ? describeAction(action, shown, labels)
      : `Pick ${die.face} (${die.id})`;
  }
  return describeAction(action, shown, labels);
}

function actionControl(
  action: Action,
  shown: GameView,
  labels: Labels,
  handlers: DecisionHandlers,
): HTMLElement {
  const take = h("button", {
    className: action.type === "pass" ? "action action-pass" : "action",
    text: actionLabel(action, shown, labels),
    onClick: () => handlers.takeAction(action),
  });
  const card = offeredCard(action, shown);
  if (card === null || card.card === null) return take;
  return h("div", { className: "action-with-info" }, [
    take,
    h("button", {
      className: "info",
      text: "i",
      attrs: { "aria-label": `${labels.card(card)}, details` },
      onClick: () => handlers.openCard(card),
    }),
  ]);
}

/** The pinned bar: what the game is waiting for and one button per offered action. */
export function renderDecision(
  shown: GameView,
  actions: readonly Action[],
  labels: Labels,
  handlers: DecisionHandlers,
): HTMLElement[] {
  const prompt = h("p", {
    className: "prompt",
    text: describeDecision(shown, labels),
    attrs: { "aria-live": "polite" },
  });
  if (shown.status === "finished") {
    return [
      prompt,
      h("div", { className: "actions" }, [
        h("button", { className: "action", text: "New game", onClick: handlers.newGame }),
      ]),
    ];
  }
  if (shown.status === "faulted") {
    return [
      h("p", {
        className: "prompt",
        text: `The pack stopped the game: ${shown.fault ?? "unknown"}`,
      }),
      h("div", { className: "actions" }, [
        h("button", { className: "action", text: "New game", onClick: handlers.newGame }),
      ]),
    ];
  }
  return [
    prompt,
    h(
      "div",
      { className: "actions" },
      actions.map((action) => actionControl(action, shown, labels, handlers)),
    ),
  ];
}
