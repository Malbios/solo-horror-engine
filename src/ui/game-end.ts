import { h } from "./dom";
import type { OutcomeText } from "./labels";

export type GameEndHandlers = { newGame: () => void };

export type GameEnd = {
  show: (outcome: OutcomeText, handlers: GameEndHandlers) => void;
  close: () => void;
};

/** How the game ended, on a modal dialog above everything: start a new game, or close it to look at the board. */
export function createGameEnd(dialog: HTMLDialogElement): GameEnd {
  const close = () => dialog.close();
  return {
    show(outcome, handlers) {
      dialog.dataset["result"] = outcome.result;
      dialog.replaceChildren(
        h("div", { className: "game-end-inner" }, [
          h("h2", {
            className: "game-end-title",
            text: outcome.title,
            attrs: { id: "game-end-title" },
          }),
          outcome.text === null ? null : h("p", { className: "game-end-text", text: outcome.text }),
          h("div", { className: "actions game-end-actions" }, [
            h("button", {
              className: "action",
              text: "New game",
              onClick: () => {
                close();
                handlers.newGame();
              },
            }),
            h("button", { className: "action action-pass", text: "See the board", onClick: close }),
          ]),
        ]),
      );
      if (!dialog.open) dialog.showModal();
    },
    close,
  };
}
