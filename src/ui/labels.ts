import {
  assertNever,
  composeRules,
  type Action,
  type Board,
  type Card,
  type Cost,
  type CostDue,
  type Counter,
  type Die,
  type DieSymbol,
  type Edge,
  type EdgeMark,
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
  /** The card's buy price as it stands now (while a buy window offers its zone), else null. */
  price(card: ViewCard): CostDue[] | null;
  /** A piece named so the player can tell it apart, e.g. "Walker 2 at Mill". */
  unit(id: string): string;
  /** A piece named among those on its own space, e.g. "Walker 2". */
  piece(id: string): string;
  unitKind(kind: string): string;
  /** Helper pieces (markers, tie-break options), never logged or played back. */
  isBookkeeping(kind: string): boolean;
  /** Pieces that come along with others; their moves between spaces get no playback beat of their own. */
  comesAlong(kind: string): boolean;
  attribute(kind: string, id: string): string;
  boards(): Board[];
  markedEdges(): MarkedEdge[];
  spaces(): Space[];
  module(id: string): string;
  moduleNote(id: string): string | null;
  moduleImage(id: string): string | null;
  /** Lines for the non-flag counters shown with a zone's cards (see `pinnedZone`). */
  zoneNotes(zone: string): string[];
  /** Names of the zone's flag counters that are set; its cards are marked while there are any. */
  zoneFlags(zone: string): string[];
  /** The flags and notes of the zone a face-up card lies in; none for a face-down card. */
  cardNotes(card: ViewCard): string[];
};

/** The zone a counter is shown with instead of the strip or panels, if any. */
export function pinnedZone(rules: Rules, counter: string): string | null {
  return rules.counterById.get(counter)?.zone ?? null;
}

function counterNote(rules: Rules, id: string, value: number): string | null {
  const definition = rules.counterById.get(id);
  if (definition === undefined || definition.hidden) return null;
  if (definition.show === "flag") {
    if (value === 0) return null;
    return value === 1 ? definition.name : `${definition.name} ${value}`;
  }
  return `${definition.name}: ${amountText(definition, value, true)}`;
}

/**
 * A counter or attribute value: as icons plus the number when it has `icons`, else the number (and its max
 * when `withMax`).
 */
export function amountText(
  definition: Counter | undefined,
  value: number,
  withMax: boolean,
): string {
  const max = definition?.max ?? null;
  const icons = definition?.icons ?? null;
  if (icons === null) return withMax && max !== null ? `${value} / ${max}` : String(value);
  const full = icons.full.repeat(Math.max(0, value));
  const empty =
    icons.empty === null || max === null ? "" : icons.empty.repeat(Math.max(0, max - value));
  const drawn = full + empty;
  return drawn === "" ? String(value) : `${drawn} (${value})`;
}

export type ModuleInfo = { name: string; note: string | null; image: string | null };

export type MarkedEdge = { edge: Edge; mark: EdgeMark };

function markEdges(rules: Rules, shown: GameView): MarkedEdge[] {
  return Object.values(shown.edges).flatMap((edge) => {
    const mark = rules.edgeMarks.find((candidate) => edge.tags.includes(candidate.tag));
    return mark === undefined ? [] : [{ edge, mark }];
  });
}

/** How a marked edge reads from one of its end spaces, e.g. "Rope bridge to Mill". */
export function describeMarkFrom(marked: MarkedEdge, space: string, labels: Labels): string {
  const other = marked.edge.fromSpace === space ? marked.edge.toSpace : marked.edge.fromSpace;
  return `${marked.mark.name} to ${labels.space(other)}`;
}

/** Display name (falling back to the id) and note of every module in the pack. */
export function moduleInfo(pack: Pack): ReadonlyMap<string, ModuleInfo> {
  return new Map(
    pack.modules.map((module) => [
      module.id,
      { name: module.name ?? module.id, note: module.note, image: module.image },
    ]),
  );
}

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

export function createLabels(
  rules: Rules,
  shown: GameView,
  modules: ReadonlyMap<string, ModuleInfo> = new Map(),
): Labels {
  const kindName = (kind: string): string => rules.unitKindById.get(kind)?.name ?? kind;
  const spaceName = (id: string): string => rules.spaceById.get(id)?.name ?? id;
  const spaceOf = (unit: UnitState): string | null =>
    unit.placement.type === "space" ? unit.placement.space : null;
  const sameKindAs = (unit: UnitState): UnitState[] =>
    Object.values(shown.units).filter((other) => other.kind === unit.kind);
  const pieceName = (unit: UnitState): string => {
    const neighbours = sameKindAs(unit)
      .filter((other) => spaceOf(other) === spaceOf(unit))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const name = kindName(unit.kind);
    return neighbours.length > 1 ? `${name} ${neighbours.indexOf(unit) + 1}` : name;
  };
  const unitName = (unit: UnitState): string => {
    const space = spaceOf(unit);
    const name = pieceName(unit);
    return space === null || sameKindAs(unit).length === 1
      ? name
      : `${name} at ${spaceName(space)}`;
  };
  const cardDefinition = (card: ViewCard): Card | null =>
    card.card === null ? null : (rules.cardById.get(card.card) ?? null);
  const counterName = (definition: Card | null, id: string): string =>
    definition?.counters.find((counter) => counter.id === id)?.name ?? id;
  const cardName = (card: ViewCard): string => {
    const definition = cardDefinition(card);
    const name = definition?.name ?? card.card ?? HIDDEN_CARD_NAME;
    const counters = Object.entries(card.counters ?? {});
    if (counters.length === 0) return name;
    const shownCounters = counters.map(([id, value]) => `${counterName(definition, id)} ${value}`);
    return `${name} (${shownCounters.join(", ")})`;
  };
  const pinnedNotes = (zone: string, flags: boolean): string[] =>
    Object.entries(shown.counters).flatMap(([id, value]) => {
      if (pinnedZone(rules, id) !== zone) return [];
      if ((rules.counterById.get(id)?.show === "flag") !== flags) return [];
      const note = counterNote(rules, id, value);
      return note === null ? [] : [note];
    });
  const zoneNotes = (zone: string): string[] => pinnedNotes(zone, false);
  const zoneFlags = (zone: string): string[] => pinnedNotes(zone, true);
  return {
    rules,
    counter: (id) => rules.counterById.get(id)?.name ?? id,
    zone: (id) => rules.zones.find((zone) => zone.id === id)?.name ?? id,
    space: (id) => rules.spaceById.get(id)?.name ?? id,
    spaceCounter: (id) => rules.spaceCounterById.get(id)?.name ?? id,
    card: cardName,
    cardDefinition,
    price: (card) =>
      shown.pending?.kind === "window" ? (shown.pending.buyPrices[card.ref] ?? null) : null,
    unit: (id) => {
      const unit = shown.units[id];
      return unit === undefined ? id : unitName(unit);
    },
    piece: (id) => {
      const unit = shown.units[id];
      return unit === undefined ? id : pieceName(unit);
    },
    unitKind: kindName,
    isBookkeeping: (kind) => rules.unitKindById.get(kind)?.bookkeeping === true,
    comesAlong: (kind) => rules.unitKindById.get(kind)?.comesAlong === true,
    attribute: (kind, id) =>
      rules.unitKindById.get(kind)?.attributes.find((attribute) => attribute.id === id)?.name ?? id,
    boards: () => rules.boards,
    markedEdges: () => markEdges(rules, shown),
    spaces: () => rules.spaces,
    module: (id) => modules.get(id)?.name ?? id,
    moduleNote: (id) => modules.get(id)?.note ?? null,
    moduleImage: (id) => modules.get(id)?.image ?? null,
    zoneNotes,
    zoneFlags,
    cardNotes: (card) => {
      if (card.card === null) return [];
      const zone = Object.entries(shown.zones).find(([, cards]) =>
        cards.some((each) => each.ref === card.ref),
      )?.[0];
      return zone === undefined ? [] : [...zoneFlags(zone), ...zoneNotes(zone)];
    },
  };
}

function abilityLabel(ref: string, ability: string, shown: GameView, labels: Labels): string {
  const card = cardsByRef(shown).get(ref) ?? { ref, card: null };
  const label =
    labels.cardDefinition(card)?.abilities.find((candidate) => candidate.id === ability)?.label ??
    ability;
  return `${labels.card(card)}: ${label}`;
}

/** A card's name; one the player cannot identify is named with the zone it lies in (public anyway). */
function cardLabel(ref: string, shown: GameView, labels: Labels): string {
  const card = cardsByRef(shown).get(ref) ?? { ref, card: null };
  const name = labels.card(card);
  if (card.card !== null) return name;
  const zone = Object.entries(shown.zones).find(([, cards]) =>
    cards.some((each) => each.ref === ref),
  )?.[0];
  return zone === undefined ? name : `${name} (${labels.zone(zone)})`;
}

function choiceName(choice: string): string {
  const words = choice.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function describeAction(action: Action, shown: GameView, labels: Labels): string {
  switch (action.type) {
    case "pickModule": {
      const pending = shown.pending;
      const module = labels.module(action.module);
      return pending?.kind === "pickModule" ? `${choiceName(pending.choice)}: ${module}` : module;
    }
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
    case "buyCard": {
      const free = shown.pending?.kind === "window" && shown.pending.buyFree;
      return `${free ? "Take" : "Buy"} ${cardLabel(action.card, shown, labels)}`;
    }
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

/** "1 success, 0 partials": each symbol the rolled die types name, summed over the dice. */
export function symbolCounts(dice: readonly Die[], rules: Rules): string {
  const totals = new Map<DieSymbol, number>();
  for (const die of dice) {
    const type = rules.dieById.get(die.die);
    const face = type?.faces.find((candidate) => candidate.id === die.face);
    for (const symbol of type?.symbols ?? []) {
      totals.set(symbol, (totals.get(symbol) ?? 0) + (face?.symbols[symbol.id] ?? 0));
    }
  }
  return [...totals]
    .map(
      ([symbol, total]) => `${total} ${total === 1 ? symbol.name : (symbol.plural ?? symbol.name)}`,
    )
    .join(", ");
}

export type RolledDieIcon = { label: string; color: string | null; labelColor: string | null };

/** Each die as its icon shows it: the face's label (else its id) in the die type's colours. */
export function rolledDice(dice: readonly Die[], rules: Rules): RolledDieIcon[] {
  return dice.map((die) => {
    const type = rules.dieById.get(die.die);
    const face = type?.faces.find((candidate) => candidate.id === die.face);
    return {
      label: face?.label ?? die.face,
      color: type?.color ?? null,
      labelColor: type?.labelColor ?? null,
    };
  });
}

/** A piece by name while it is on record, else by its kind (a piece already gone has no other name). */
function pieceOrKind(unit: string, kind: string, shown: GameView, labels: Labels): string {
  return shown.units[unit] === undefined ? labels.unitKind(kind) : labels.unit(unit);
}

/** One line for the game log, or null for bookkeeping events the player does not need to see. */
export function describeEvent(event: GameEvent, shown: GameView, labels: Labels): string | null {
  switch (event.type) {
    case "moduleChosen":
      return null;
    case "counterChanged":
      if (labels.rules.counterById.get(event.counter)?.hidden === true) return null;
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
      if (labels.isBookkeeping(event.kind)) return null;
      return `${pieceOrKind(event.unit, event.kind, shown, labels)} appears`;
    case "unitRemoved":
      if (labels.isBookkeeping(event.kind)) return null;
      return event.fromSpace === null
        ? `${labels.unitKind(event.kind)} removed`
        : `${labels.unitKind(event.kind)} removed from ${labels.space(event.fromSpace)}`;
    case "unitMoved": {
      if (labels.isBookkeeping(event.kind)) return null;
      const from = event.fromSpace === null ? "" : ` from ${labels.space(event.fromSpace)}`;
      return event.toSpace === null
        ? `${labels.unitKind(event.kind)} leaves the board${from}`
        : `${labels.unitKind(event.kind)} moves${from} to ${labels.space(event.toSpace)}`;
    }
    case "unitKindChanged":
      if (labels.isBookkeeping(event.from) && labels.isBookkeeping(event.to)) return null;
      return `${pieceOrKind(event.unit, event.from, shown, labels)} changes`;
    case "attributeChanged":
      if (labels.isBookkeeping(event.kind)) return null;
      return `${labels.unit(event.unit)} ${labels.attribute(event.kind, event.attribute)} ${signed(event.from, event.to)} (now ${event.to})`;
    case "spaceCounterChanged":
      return `${labels.space(event.space)} ${labels.spaceCounter(event.spaceCounter)} ${signed(event.from, event.to)}`;
    case "edgeChanged":
      return `A path was ${event.change}`;
    case "diceRolled": {
      const faces = `Rolled ${event.dice.map((die) => die.face).join(", ")}`;
      const counts = symbolCounts(event.dice, labels.rules);
      return counts === "" ? faces : `${faces}: ${counts}`;
    }
    case "cardResolved":
      return `Resolved ${cardLabel(event.card, shown, labels)}`;
    case "cardBought":
      return `Got ${cardLabel(event.card, shown, labels)}`;
    case "triggerDone":
      return null;
    case "triggerFired": {
      const name =
        labels.rules.triggers.find((trigger) => trigger.id === event.trigger)?.name ?? null;
      return name === null ? null : `${name} takes effect`;
    }
    case "abilityUsed":
      return `Used ${abilityLabel(event.card, event.ability, shown, labels)}`;
    case "cardCounterChanged":
      return `${cardLabel(event.card, shown, labels)}: ${signed(event.from, event.to)}`;
    case "quantityDelivered":
      return event.unit === null
        ? `${event.amount} ${event.quantity}`
        : `${labels.unit(event.unit)} takes ${event.amount} ${event.quantity}`;
    default:
      return assertNever(event);
  }
}

export function describeDue(due: CostDue, labels: Labels): string {
  if ("counter" in due) return `${due.amount} ${labels.counter(due.counter)}`;
  if ("attribute" in due) return `${due.amount} ${due.attribute}`;
  return `Discard ${due.count} from ${labels.zone(due.discard)}`;
}

function shownDue(due: CostDue, labels: Labels): boolean {
  if ("counter" in due)
    return due.amount !== 0 && labels.rules.counterById.get(due.counter)?.hidden !== true;
  if ("attribute" in due) return due.amount !== 0;
  return due.count !== 0;
}

/** A price for the player: parts that are 0 and costs on hidden counters are left out; nothing left is "Free". */
export function priceText(dues: readonly CostDue[], labels: Labels): string {
  const parts = dues.filter((due) => shownDue(due, labels)).map((due) => describeDue(due, labels));
  return parts.length === 0 ? "Free" : parts.join(", ");
}

/**
 * The costs whose amount is known without the current state (a plain number), worked out; costs given by an
 * expression are left out rather than guessed.
 */
export function knownCosts(costs: readonly Cost[]): CostDue[] {
  return costs.flatMap((cost): CostDue[] => {
    if ("counter" in cost)
      return typeof cost.amount === "number"
        ? [{ counter: cost.counter, amount: cost.amount }]
        : [];
    if ("attribute" in cost)
      return typeof cost.amount === "number"
        ? [{ attribute: cost.attribute, amount: cost.amount }]
        : [];
    return typeof cost.discard.count === "number"
      ? [{ discard: cost.discard.from, count: cost.discard.count }]
      : [];
  });
}

export function describeOutcome(shown: GameView): string | null {
  if (shown.outcome === null) return null;
  return shown.outcome.result === "win" ? "You win" : "You lose";
}

/** Replaces each `{counter}` with that counter's current value; unknown ids stay as written. */
function fillCounters(text: string, shown: GameView): string {
  return text.replace(/\{([a-z0-9-]+)\}/g, (whole: string, id: string) => {
    const value = shown.counters[id];
    return value === undefined ? whole : String(value);
  });
}

export function describeDecision(shown: GameView, labels: Labels): string {
  const pending = shown.pending;
  if (pending === null) return describeOutcome(shown) ?? "";
  switch (pending.kind) {
    case "pickModule":
      return `Choose: ${pending.choice.replaceAll("-", " ")}`;
    case "chooseOption":
      return "Choose one";
    case "window":
      return pending.prompt === null
        ? "Choose an action or pass"
        : fillCounters(pending.prompt, shown);
    case "pickCard":
      return pending.canPass ? "Pick a card, or pass" : "Pick a card";
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
