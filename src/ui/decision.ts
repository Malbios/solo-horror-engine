import type { Action, GameView, ViewCard } from "../core";
import { h } from "./dom";
import { describeAction, describeDecision, knownCosts, priceText, type Labels } from "./labels";

export type DecisionHandlers = {
  takeAction: (action: Action) => void;
  openCard: (card: ViewCard) => void;
  /** Shows the card's details while `target` is hovered or keyboard-focused. */
  previewCard: (target: HTMLElement, card: ViewCard) => void;
  newGame: () => void;
};

function offeredCards(shown: GameView): ViewCard[] {
  const pending = shown.pending;
  if (pending?.kind === "pickCard") return pending.cards;
  if (pending?.kind === "window") return [...pending.play, ...pending.discard, ...pending.buy];
  return Object.values(shown.zones).flat();
}

function offeredCard(action: Action, shown: GameView): ViewCard | null {
  if (!("card" in action)) return null;
  return (
    offeredCards(shown).find((card) => card.ref === action.card) ?? { ref: action.card, card: null }
  );
}

/** The cards an action of this type chooses among, so copies can be counted. */
function cardsChosenAmong(action: Action, shown: GameView): readonly ViewCard[] {
  const pending = shown.pending;
  if (pending?.kind === "pickCard") return pending.cards;
  if (pending?.kind !== "window") return [];
  if (action.type === "playCard") return pending.play;
  if (action.type === "discardCard") return pending.discard;
  if (action.type === "buyCard") return pending.buy;
  return [];
}

function copiesOffered(action: Action, shown: GameView): number {
  const card = offeredCard(action, shown);
  if (card === null || card.card === null) return 0;
  return cardsChosenAmong(action, shown).filter((other) => other.card === card.card).length;
}

export function actionLabel(action: Action, shown: GameView, labels: Labels): string {
  const pending = shown.pending;
  if (action.type === "pickDie" && pending?.kind === "pickDie") {
    const die = shown.pools[pending.pool]?.find((candidate) => candidate.id === action.die);
    return die === undefined
      ? describeAction(action, shown, labels)
      : `Pick ${die.face} (${die.id})`;
  }
  const label = describeAction(action, shown, labels);
  const copies = copiesOffered(action, shown);
  return copies > 1 && action.type !== "buyCard" ? `${label} (${copies})` : label;
}

/** The card's price as it stands now, or the part of it known without the current state. */
function currentPrice(card: ViewCard, labels: Labels): string {
  return priceText(
    labels.price(card) ?? knownCosts(labels.cardDefinition(card)?.buyCost ?? []),
    labels,
  );
}

/** The second line of a buy button: its price (unless free) and how many copies are left. */
export function buyNote(action: Action, shown: GameView, labels: Labels): string | null {
  if (action.type !== "buyCard") return null;
  const pending = shown.pending;
  const free = pending?.kind === "window" && pending.buyFree;
  const card = offeredCard(action, shown);
  const price = free || card === null ? null : currentPrice(card, labels);
  const copies = copiesOffered(action, shown);
  const left = copies > 1 ? `${copies} left` : null;
  const parts = [price, left].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * Keeps the engine's grouping by action type but orders card actions by name, so a card keeps its
 * place when one of its copies is taken.
 */
export function stableOrder(actions: readonly Action[], shown: GameView, labels: Labels): Action[] {
  const typeRank = new Map<string, number>();
  actions.forEach((action, index) => {
    if (!typeRank.has(action.type)) typeRank.set(action.type, index);
  });
  const cardName = (action: Action): string => {
    const card = offeredCard(action, shown);
    return card === null ? "" : labels.card(card);
  };
  return actions
    .map((action, index) => ({ action, index, name: cardName(action) }))
    .sort(
      (a, b) =>
        (typeRank.get(a.action.type) ?? 0) - (typeRank.get(b.action.type) ?? 0) ||
        (a.name === "" || b.name === "" ? 0 : a.name.localeCompare(b.name)) ||
        a.index - b.index,
    )
    .map(({ action }) => action);
}

/** The pass to take for the player when a shop window offers nothing but passing. */
export function automaticPass(shown: GameView, actions: readonly Action[]): Action | null {
  const pending = shown.pending;
  if (pending?.kind !== "window" || pending.buyFrom === null) return null;
  const [only, ...rest] = actions;
  return only?.type === "pass" && rest.length === 0 ? only : null;
}

/** Face-up cards in the shop zone that cannot be bought right now, one per card name. */
export function unavailableBuys(shown: GameView): ViewCard[] {
  const pending = shown.pending;
  if (pending?.kind !== "window" || pending.buyFrom === null) return [];
  const offered = new Set(pending.buy.map((card) => card.card));
  const seen = new Set<string>();
  return (shown.zones[pending.buyFrom] ?? []).filter((card) => {
    if (card.card === null || offered.has(card.card) || seen.has(card.card)) return false;
    seen.add(card.card);
    return true;
  });
}

function unavailableControl(
  card: ViewCard,
  shown: GameView,
  labels: Labels,
  handlers: DecisionHandlers,
): HTMLElement {
  const pending = shown.pending;
  const shopCards =
    pending?.kind === "window" && pending.buyFrom !== null
      ? (shown.zones[pending.buyFrom] ?? [])
      : [];
  const copies = shopCards.filter((other) => other.card === card.card).length;
  const parts = [currentPrice(card, labels), copies > 1 ? `${copies} left` : null];
  const note = parts.filter((part) => part !== null).join(" · ");
  const greyed = h(
    "button",
    {
      className: "action action-unavailable",
      attrs: { disabled: "", "aria-label": `Buy ${labels.card(card)}, ${note}, not available` },
    },
    [`Buy ${labels.card(card)}`, h("span", { className: "action-note", text: note })],
  );
  const row = h("div", { className: "action-with-info" }, [
    greyed,
    h("button", {
      className: "info",
      text: "i",
      attrs: { "aria-label": `${labels.card(card)}, details` },
      onClick: () => handlers.openCard(card),
    }),
  ]);
  handlers.previewCard(row, card);
  return row;
}

/** Buy buttons and the greyed-out cards that cannot be bought, together in name order. */
function withUnavailableBuys(
  ordered: readonly Action[],
  shown: GameView,
  labels: Labels,
  handlers: DecisionHandlers,
  discardFor: ReadonlyMap<Action, Action>,
): HTMLElement[] {
  const nameOf = (card: ViewCard | null) => (card === null ? "" : labels.card(card));
  const buys = [
    ...ordered
      .filter((action) => action.type === "buyCard")
      .map((action) => ({
        name: nameOf(offeredCard(action, shown)),
        element: actionControl(action, shown, labels, handlers),
      })),
    ...unavailableBuys(shown).map((card) => ({
      name: nameOf(card),
      element: unavailableControl(card, shown, labels, handlers),
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const others = ordered.filter((action) => action.type !== "buyCard");
  const firstBuy = ordered.findIndex((action) => action.type === "buyCard");
  const passAt = others.findIndex((action) => action.type === "pass");
  const insertAt =
    firstBuy !== -1
      ? ordered.slice(0, firstBuy).filter((action) => action.type !== "buyCard").length
      : passAt === -1
        ? others.length
        : passAt;
  const controls = others.map((action) =>
    actionControl(action, shown, labels, handlers, discardFor.get(action) ?? null),
  );
  controls.splice(insertAt, 0, ...buys.map(({ element }) => element));
  return controls;
}

/** Pairs each played card with the discard of the same card, so both share one row. */
export function discardsBesidePlays(
  ordered: readonly Action[],
  shown: GameView,
): { actions: Action[]; discardFor: Map<Action, Action> } {
  const definitionOf = (action: Action) => offeredCard(action, shown)?.card ?? null;
  const discards = ordered.filter((action) => action.type === "discardCard");
  const discardFor = new Map<Action, Action>();
  for (const play of ordered.filter((action) => action.type === "playCard")) {
    const definition = definitionOf(play);
    const discard = discards.find(
      (candidate) =>
        definition !== null &&
        definitionOf(candidate) === definition &&
        ![...discardFor.values()].includes(candidate),
    );
    if (discard !== undefined) discardFor.set(play, discard);
  }
  const paired = new Set(discardFor.values());
  return { actions: ordered.filter((action) => !paired.has(action)), discardFor };
}

function discardBeside(
  discard: Action,
  card: ViewCard,
  labels: Labels,
  handlers: DecisionHandlers,
) {
  return h("button", {
    className: "action action-secondary",
    text: "Discard",
    attrs: { "aria-label": `Discard ${labels.card(card)}` },
    onClick: () => handlers.takeAction(discard),
  });
}

function actionControl(
  action: Action,
  shown: GameView,
  labels: Labels,
  handlers: DecisionHandlers,
  discard: Action | null = null,
): HTMLElement {
  const note =
    action.type === "pickModule"
      ? labels.moduleNote(action.module)
      : buyNote(action, shown, labels);
  const take = h(
    "button",
    {
      className: action.type === "pass" ? "action action-pass" : "action",
      onClick: () => handlers.takeAction(action),
    },
    [
      actionLabel(action, shown, labels),
      note === null ? null : h("span", { className: "action-note", text: note }),
    ],
  );
  const card = offeredCard(action, shown);
  if (card === null || card.card === null) return take;
  const row = h("div", { className: "action-with-info" }, [
    take,
    discard === null ? null : discardBeside(discard, card, labels, handlers),
    h("button", {
      className: "info",
      text: "i",
      attrs: { "aria-label": `${labels.card(card)}, details` },
      onClick: () => handlers.openCard(card),
    }),
  ]);
  handlers.previewCard(row, card);
  return row;
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
  const rows = discardsBesidePlays(stableOrder(actions, shown, labels), shown);
  return [
    prompt,
    h(
      "div",
      { className: "actions" },
      withUnavailableBuys(rows.actions, shown, labels, handlers, rows.discardFor),
    ),
  ];
}

export type PlaybackHandlers = {
  next: () => void;
  skip: () => void;
};

/** The pinned bar while automatic steps play out (the toasts describe them): go on, or skip to now. */
export function renderPlayback(
  position: { index: number; count: number },
  handlers: PlaybackHandlers,
): HTMLElement[] {
  const last = position.index + 1 >= position.count;
  return [
    h("p", { className: "prompt", text: `Watching: ${position.index + 1} of ${position.count}` }),
    h("div", { className: "actions" }, [
      h("button", { className: "action", text: last ? "Done" : "Next", onClick: handlers.next }),
      h("button", { className: "action action-pass", text: "Skip to now", onClick: handlers.skip }),
    ]),
  ];
}
