import {
  assertNever,
  composeRules,
  type Action,
  type Board,
  type Card,
  type GameEvent,
  type GameView,
  type Pack,
  type Rules,
  type Space,
  type UnitState,
  type ViewCard,
} from "../core";

export const HIDDEN_CARD_NAME = "Face-down card";

export type Labels = {
  rules: Rules;
  counter(id: string): string;
  zone(id: string): string;
  space(id: string): string;
  spaceCounter(id: string): string;
  card(card: ViewCard): string;
  cardDefinition(card: ViewCard): Card | null;
  unit(id: string): string;
  attribute(kind: string, id: string): string;
  boards(): Board[];
  spaces(): Space[];
};

function cardsByRef(shown: GameView): Map<string, ViewCard> {
  return new Map(
    Object.values(shown.zones).flatMap((cards) => cards.map((card) => [card.ref, card])),
  );
}

/** Composes the rules for the chosen modules; display names come from these, not the base pack. */
export function displayRules(pack: Pack, modules: readonly string[]): Rules {
  const composed = composeRules(pack, modules);
  if (!composed.ok) throw new Error(composed.error);
  return composed.value;
}

export function createLabels(rules: Rules, shown: GameView): Labels {
  const unitName = (unit: UnitState): string => {
    const kindName = rules.unitKindById.get(unit.kind)?.name ?? unit.kind;
    const sameKind = Object.values(shown.units).filter((other) => other.kind === unit.kind);
    return sameKind.length > 1 ? `${kindName} (${unit.id})` : kindName;
  };
  const cardDefinition = (card: ViewCard): Card | null =>
    card.card === null ? null : (rules.cardById.get(card.card) ?? null);
  return {
    rules,
    counter: (id) => rules.counterById.get(id)?.name ?? id,
    zone: (id) => rules.zones.find((zone) => zone.id === id)?.name ?? id,
    space: (id) => rules.spaceById.get(id)?.name ?? id,
    spaceCounter: (id) => rules.spaceCounterById.get(id)?.name ?? id,
    card: (card) => cardDefinition(card)?.name ?? card.card ?? HIDDEN_CARD_NAME,
    cardDefinition,
    unit: (id) => {
      const unit = shown.units[id];
      return unit === undefined ? id : unitName(unit);
    },
    attribute: (kind, id) =>
      rules.unitKindById.get(kind)?.attributes.find((attribute) => attribute.id === id)?.name ?? id,
    boards: () => rules.boards,
    spaces: () => rules.spaces,
  };
}

function abilityLabel(ref: string, ability: string, shown: GameView, labels: Labels): string {
  const card = cardsByRef(shown).get(ref) ?? { ref, card: null };
  const label =
    labels.cardDefinition(card)?.abilities.find((candidate) => candidate.id === ability)?.label ??
    ability;
  return `${labels.card(card)}: ${label}`;
}

function cardLabel(ref: string, shown: GameView, labels: Labels): string {
  return labels.card(cardsByRef(shown).get(ref) ?? { ref, card: null });
}

export function describeAction(action: Action, shown: GameView, labels: Labels): string {
  switch (action.type) {
    case "pickModule":
      return `Add ${action.module}`;
    case "chooseOption": {
      const pending = shown.pending;
      const option =
        pending?.kind === "chooseOption"
          ? pending.options.find((candidate) => candidate.id === action.option)
          : undefined;
      return option?.label ?? action.option;
    }
    case "playCard":
      return `Play ${cardLabel(action.card, shown, labels)}`;
    case "discardCard":
      return `Discard ${cardLabel(action.card, shown, labels)}`;
    case "useAbility":
      return `Use ${abilityLabel(action.card, action.ability, shown, labels)}`;
    case "pickCard":
      return `Pick ${cardLabel(action.card, shown, labels)}`;
    case "moveTo":
      return `Move to ${labels.space(action.space)}`;
    case "pickUnit":
      return `Pick ${labels.unit(action.unit)}`;
    case "pickDie":
      return `Pick die ${action.die}`;
    case "pass":
      return "Pass";
    default:
      return assertNever(action);
  }
}

function describeCards(cards: readonly string[], shown: GameView, labels: Labels): string {
  const known = cardsByRef(shown);
  const visible = cards.map((ref) => known.get(ref));
  if (visible.length > 0 && visible.every((card) => card !== undefined && card.card !== null)) {
    return visible.map((card) => (card === undefined ? "" : labels.card(card))).join(", ");
  }
  return cards.length === 1 ? "1 card" : `${cards.length} cards`;
}

function signed(from: number, to: number): string {
  const change = to - from;
  return change >= 0 ? `+${change}` : `${change}`;
}

/** One line for the game log, or null for bookkeeping events the player does not need to see. */
export function describeEvent(event: GameEvent, shown: GameView, labels: Labels): string | null {
  switch (event.type) {
    case "moduleChosen":
      return `Added ${event.module}`;
    case "counterChanged":
      return `${labels.counter(event.counter)} ${signed(event.from, event.to)} (now ${event.to})`;
    case "cardsMoved": {
      const cards = describeCards(event.cards, shown, labels);
      return event.from === null
        ? `${cards} added to ${labels.zone(event.to)}`
        : `${cards}: ${labels.zone(event.from)} to ${labels.zone(event.to)}`;
    }
    case "scopeEntered":
      return event.scope === "round" ? `Round ${shown.round} begins` : null;
    case "scopeExited":
      return null;
    case "gameFinished":
      return event.outcome === "win" ? "You win" : "You lose";
    case "unitCreated":
      return `${labels.unit(event.unit)} appears`;
    case "unitRemoved":
      return `${event.unit} removed`;
    case "unitMoved":
      return event.toSpace === null
        ? `${labels.unit(event.unit)} leaves the board`
        : `${labels.unit(event.unit)} moves to ${labels.space(event.toSpace)}`;
    case "unitKindChanged":
      return `${labels.unit(event.unit)} changes`;
    case "attributeChanged":
      return `${labels.unit(event.unit)} ${labels.attribute(event.kind, event.attribute)} ${signed(event.from, event.to)} (now ${event.to})`;
    case "spaceCounterChanged":
      return `${labels.space(event.space)} ${labels.spaceCounter(event.spaceCounter)} ${signed(event.from, event.to)}`;
    case "edgeChanged":
      return `A path was ${event.change}`;
    case "diceRolled":
      return `Rolled ${event.dice.map((die) => die.face).join(", ")}`;
    case "cardResolved":
      return `Resolved ${cardLabel(event.card, shown, labels)}`;
    case "abilityUsed":
      return `Used ${abilityLabel(event.card, event.ability, shown, labels)}`;
    case "quantityDelivered":
      return event.unit === null
        ? `${event.amount} ${event.quantity}`
        : `${labels.unit(event.unit)} takes ${event.amount} ${event.quantity}`;
    default:
      return assertNever(event);
  }
}

export function describeOutcome(shown: GameView): string | null {
  if (shown.outcome === null) return null;
  return shown.outcome.result === "win" ? "You win" : "You lose";
}

export function describeDecision(shown: GameView, labels: Labels): string {
  const pending = shown.pending;
  if (pending === null) return describeOutcome(shown) ?? "";
  switch (pending.kind) {
    case "pickModule":
      return "Choose optional content";
    case "chooseOption":
      return "Choose one";
    case "window":
      return "Choose an action or pass";
    case "pickCard":
      return "Pick a card";
    case "moveUnit":
      return `Move ${labels.unit(pending.unit)}: tap a highlighted space`;
    case "pickUnit":
      return pending.canPass ? "Pick a piece to come along, or pass" : "Pick a piece";
    case "pickDie":
      return "Pick a die";
    default:
      return assertNever(pending);
  }
}
