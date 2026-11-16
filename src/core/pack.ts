export const PACK_SCHEMA_VERSION = 2;

export type Scope = "step" | "phase" | "round";

export type ContextKey = "from" | "to" | "amount";

export type NumberPair = [NumExpr, NumExpr];

export type UnitRef =
  | "self"
  | { id: string }
  | { closest: { kind: string; origin: SpaceRef; filter: string } }
  | { farthest: { kind: string; origin: SpaceRef; filter: string } };

export type SpaceRef =
  "candidate" | { space: string } | { locationOf: UnitRef; fallback: SpaceRef | null };

export type Placement = { onSpace: SpaceRef } | { inside: UnitRef } | { offMap: true };

export type NumExpr =
  | number
  | { counter: string }
  | { zoneCount: string }
  | { context: ContextKey }
  | { arg: string }
  | { add: NumExpr[] }
  | { sub: NumberPair }
  | { mul: NumberPair }
  | { min: NumExpr[] }
  | { max: NumExpr[] }
  | { attribute: string; of: UnitRef }
  | { diceCount: { pool: string; symbol: string | null; role: string | null } }
  | { spaceCounter: string; at: SpaceRef }
  | { countUnits: { kind: string | null; at: SpaceRef | null } }
  | { countCards: { zone: string; card: string | null; tag: string | null } }
  /** A counter on the card in context ("this card"); 0 without one. */
  | { cardCounter: string }
  | {
      distance: { origin: SpaceRef; destination: SpaceRef; filter: string; ifUnreachable: NumExpr };
    };

export type BoolExpr =
  | boolean
  | { eq: NumberPair }
  | { ne: NumberPair }
  | { lt: NumberPair }
  | { lte: NumberPair }
  | { gt: NumberPair }
  | { gte: NumberPair }
  | { and: BoolExpr[] }
  | { or: BoolExpr[] }
  | { not: BoolExpr }
  | { unitExists: UnitRef }
  | { spaceHasTag: { at: SpaceRef; tag: string } }
  | { unitIsKind: { unit: UnitRef; kind: string } }
  | { sameSpace: [UnitRef, UnitRef] }
  /** The zone's top card is face up (false when the zone is empty). */
  | { topFaceUp: string }
  /** This card lies in the zone and/or has the tag; false without a card in context. */
  | { thisCard: { zone: string | null; tag: string | null } };

export type SortKey = { key: NumExpr; direction: "asc" | "desc" };

export type TieBreak = "id" | "random" | "decision";

export type Order = { sortBy: SortKey[]; tieBreak: TieBreak };

export type UnitSet = { kind: string | null; at: SpaceRef | null; where: BoolExpr };

export type Followers = {
  units: { kind: string | null; where: BoolExpr };
  max: NumExpr;
  when: BoolExpr;
};

export type Cost =
  | { counter: string; amount: NumExpr; floor: NumExpr | null }
  | { attribute: string; of: UnitRef; amount: NumExpr }
  | { discard: { from: string; to: string; count: NumExpr } };

export type ChooseOption = {
  id: string;
  label: string;
  when: BoolExpr;
  cost: Cost[];
  effects: Effect[];
};

export type CardPosition = "top" | "bottom";

export type CardFilter = { requireTags: string[]; excludeTags: string[] };

export type WindowPlay = { from: string; to: string; cards: CardFilter };

export type WindowDiscard = { from: string; to: string; effects: Effect[] };

export type WindowBuy = {
  from: string;
  to: string;
  cards: CardFilter;
  when: BoolExpr;
  free: boolean;
};

export type PlayWindowEffect = {
  type: "playWindow";
  play: WindowPlay | null;
  discard: WindowDiscard | null;
  buy: WindowBuy | null;
  abilitiesFrom: string[];
  repeat: boolean;
  /** When this holds as the window would open (again), it closes without a decision. */
  until: BoolExpr;
};

export type UseLimit = { uses: number; per: Scope | "game" };

export type Ability = {
  id: string;
  label: string;
  when: BoolExpr;
  cost: Cost[];
  effects: Effect[];
  limit: UseLimit | null;
};

export type DiceRole = { role: string; count: NumExpr };

export type LookupEntry = { min: number; max: number; effects: Effect[] };

export type TableEntry = { id: string; weight: NumExpr; when: BoolExpr; effects: Effect[] };

export type Effect =
  | { type: "changeCounter"; counter: string; amount: NumExpr }
  | { type: "setCounter"; counter: string; value: NumExpr }
  | { type: "moveCards"; from: string; to: string; count: NumExpr; position: CardPosition }
  | { type: "createCards"; card: string; zone: string }
  | { type: "shuffle"; zone: string }
  | { type: "peek"; zone: string; count: NumExpr }
  | { type: "turnCards"; zone: string; count: NumExpr; face: ZoneFace }
  | { type: "if"; condition: BoolExpr; then: Effect[]; else: Effect[] }
  | { type: "choose"; optional: boolean; options: ChooseOption[] }
  | PlayWindowEffect
  | { type: "resolveCard"; zone: string; to: string | null; ifEmpty: Effect[] }
  | { type: "endScope"; scope: Scope }
  | { type: "endGame"; endCondition: string }
  | { type: "createUnit"; kind: string; id: string | null; placement: Placement }
  | { type: "removeUnit"; unit: UnitRef }
  | { type: "changeKind"; unit: UnitRef; kind: string }
  | { type: "placeUnit"; unit: UnitRef; placement: Placement }
  | {
      type: "moveToward";
      unit: UnitRef;
      target: SpaceRef;
      steps: NumExpr;
      filter: string;
      stopWhen: BoolExpr;
      order: Order;
      followers: Followers | null;
    }
  | {
      type: "stepMove";
      unit: UnitRef;
      steps: NumExpr;
      filter: string;
      followers: Followers | null;
      /** No stopping early: a single possible step is taken without asking. */
      forced: boolean;
    }
  | { type: "changeAttribute"; unit: UnitRef; attribute: string; amount: NumExpr }
  | { type: "setAttribute"; unit: UnitRef; attribute: string; value: NumExpr }
  | { type: "changeSpaceCounter"; at: SpaceRef; spaceCounter: string; amount: NumExpr }
  | { type: "setSpaceCounter"; at: SpaceRef; spaceCounter: string; value: NumExpr }
  | { type: "forEachUnit"; units: UnitSet; order: Order; effects: Effect[] }
  | { type: "selectUnits"; units: UnitSet; order: Order; count: NumExpr; effects: Effect[] }
  | { type: "deliver"; quantity: string; amount: NumExpr; recipient: UnitRef | null }
  | { type: "rollDice"; pool: string; die: string; count: NumExpr }
  | { type: "addDice"; pool: string; die: string; count: NumExpr }
  | {
      type: "rerollDice";
      pool: string;
      faces: string[] | null;
      mode: "all" | "choose";
      /** In choose mode, the most dice the player may pick (null: no limit). */
      max: NumExpr | null;
    }
  | { type: "setDieFace"; pool: string; faces: string[]; toFace: string; count: NumExpr }
  | { type: "assignDice"; pool: string; roles: DiceRole[] }
  | { type: "lookup"; value: NumExpr; entries: LookupEntry[]; otherwise: Effect[] }
  | { type: "randomTable"; entries: TableEntry[]; ifNone: Effect[] }
  | { type: "addEdge"; edge: Edge }
  | { type: "removeEdge"; edge: string }
  | { type: "retargetEdge"; edge: string; toSpace: string }
  | { type: "call"; procedure: string; args: Record<string, NumExpr> }
  | { type: "changeCardCounter"; cardCounter: string; amount: NumExpr }
  | { type: "moveThisCard"; to: string; position: CardPosition }
  | {
      type: "pickCards";
      from: string;
      to: string;
      count: NumExpr;
      cards: CardFilter;
      optional: boolean;
      position: CardPosition;
    }
  | { type: "forEachCard"; zone: string; cards: CardFilter; effects: Effect[] };

export type EventPattern =
  | { event: "counterChanged"; counter: string }
  | { event: "cardsMoved"; from: string | null; to: string | null }
  | { event: "scopeEntered"; scope: Scope; id: string | null }
  | { event: "scopeExited"; scope: Scope; id: string | null }
  | { event: "unitCreated"; kind: string | null }
  | { event: "unitRemoved"; kind: string | null }
  | { event: "unitMoved"; kind: string | null; toSpace: string | null }
  | { event: "attributeChanged"; kind: string | null; attribute: string }
  | { event: "spaceCounterChanged"; spaceCounter: string }
  | { event: "quantityDelivered"; quantity: string; kind: string | null }
  | { event: "diceRolled"; pool: string | null };

export type SpacePosition = { board: string; x: number; y: number };

export type Space = { id: string; name: string; tags: string[]; position: SpacePosition | null };

export type Board = { id: string; name: string; image: string | null; aspect: number };

/** Display only: edges carrying `tag` are drawn in `color` and badged on both end spaces. */
export type EdgeMark = {
  id: string;
  tag: string;
  badge: string;
  name: string;
  color: string | null;
};

export type Edge = {
  id: string;
  fromSpace: string;
  toSpace: string;
  directed: boolean;
  tags: string[];
  /** Extra tags that count only when the edge is left from `fromSpace`. */
  fromTags: string[];
  /** Extra tags that count only when the edge is left from `toSpace`. */
  toTags: string[];
  gate: BoolExpr;
  cost: Cost[];
};

export type EdgeFilter = {
  id: string;
  requireTags: string[];
  excludeTags: string[];
  useGates: boolean;
};

export type Counter = {
  id: string;
  name: string;
  /** Display only: bookkeeping the player does not need to see. */
  hidden: boolean;
  start: number;
  min: number | null;
  max: number | null;
  resetScope: Scope | null;
  onOverflow: Effect[];
  onUnderflow: Effect[];
};

export type ZoneFace = "up" | "down";

export type Zone = { id: string; name: string; face: ZoneFace; backEffects: Effect[] };

export type Card = {
  id: string;
  name: string;
  text: string;
  image: string | null;
  copies: number;
  tags: string[];
  playable: BoolExpr;
  cost: Cost[];
  buyCost: Cost[];
  effects: Effect[];
  abilities: Ability[];
  /** Counters each copy of the card carries, read and changed as "this card". */
  counters: CardCounter[];
};

export type CardCounter = {
  id: string;
  name: string;
  start: number;
  min: number | null;
  max: number | null;
};

export type DieFace = { id: string; symbols: Record<string, number> };

/** Display only: a face symbol named so the log can count it, e.g. "1 hit". */
export type DieSymbol = { id: string; name: string; plural: string | null };

export type DieType = { id: string; faces: DieFace[]; symbols: DieSymbol[] };

export type Pool = { id: string };

export type QuantityType = {
  id: string;
  target: { counter: string } | { attribute: string };
  direction: "increase" | "decrease";
};

export type ModifierAction =
  | { prevent: true }
  | { reduce: NumExpr }
  | { increase: NumExpr }
  | { convertTo: string }
  | { substitute: Effect[] };

export type Modifier = {
  id: string;
  quantity: string;
  priority: number;
  condition: BoolExpr;
  optional: boolean;
  action: ModifierAction;
  onApply: Effect[];
};

export type ScopeHooks = { onEnter: Effect[]; onExit: Effect[] };

export type Step = { id: string; effects: Effect[] };

export type Phase = { id: string; onEnter: Effect[]; onExit: Effect[]; steps: Step[] };

export type Trigger = {
  id: string;
  on: EventPattern;
  condition: BoolExpr;
  effects: Effect[];
  once: boolean;
};

export type Procedure = { id: string; params: string[]; effects: Effect[] };

export type Check = { id: string; condition: BoolExpr; effects: Effect[] };

export type Outcome = "win" | "loss";

export type OutcomeRule = Outcome | { when: BoolExpr; then: Outcome; else: Outcome };

export type EndCondition = {
  id: string;
  condition: BoolExpr;
  sequence: Effect[];
  outcome: OutcomeRule;
};

export type UnitKind = {
  id: string;
  name: string;
  image: string | null;
  /** Display only: the colour of this kind's pieces on the board. */
  color: string | null;
  /** Display only: the short text on this kind's pieces; defaults to the name's first letter. */
  badge: string | null;
  attributes: Counter[];
  /** Other kinds a unit of this kind also counts as wherever a kind is matched. */
  countsAs: string[];
};

export type Content = {
  boards: Board[];
  spaces: Space[];
  edges: Edge[];
  edgeFilters: EdgeFilter[];
  edgeMarks: EdgeMark[];
  unitKinds: UnitKind[];
  spaceCounters: Counter[];
  counters: Counter[];
  zones: Zone[];
  cards: Card[];
  quantityTypes: QuantityType[];
  modifiers: Modifier[];
  dice: DieType[];
  pools: Pool[];
  triggers: Trigger[];
  checks: Check[];
  endConditions: EndCondition[];
  procedures: Procedure[];
  setup: Effect[];
  setupEnd: Effect[];
  round: ScopeHooks;
  phases: Phase[];
};

export const LAYERED_COLLECTIONS = [
  "boards",
  "spaces",
  "edges",
  "edgeFilters",
  "edgeMarks",
  "unitKinds",
  "spaceCounters",
  "counters",
  "zones",
  "cards",
  "quantityTypes",
  "modifiers",
  "dice",
  "pools",
  "triggers",
  "checks",
  "endConditions",
  "procedures",
  "phases",
] as const;

export type LayeredCollection = (typeof LAYERED_COLLECTIONS)[number];

export type Removal = Record<LayeredCollection, string[]>;

export type Module = {
  id: string;
  name: string | null;
  /** A short line shown when the module is offered (display only). */
  note: string | null;
  kind: string;
  precedence: number;
  content: Content;
  remove: Removal;
};

export type Choice = {
  id: string;
  options: string[];
  kind: string | null;
  min: number;
  max: number;
};

export type PackMeta = {
  id: string;
  version: string;
  schemaVersion: typeof PACK_SCHEMA_VERSION;
  name: string;
};

export type Pack = {
  meta: PackMeta;
  base: Content;
  modules: Module[];
  choices: Choice[];
};

export type AddOnMeta = {
  id: string;
  version: string;
  schemaVersion: typeof PACK_SCHEMA_VERSION;
  name: string;
  core: string;
};

/** One module shipped on its own, extending the core named in its meta. */
export type AddOn = { meta: AddOnMeta; module: Module };

/** The modules a choice offers: its listed options, then every other module of its kind. */
export function offeredModules(pack: Pack, choice: Choice): string[] {
  const ofKind = pack.modules
    .filter((module) => choice.kind !== null && module.kind === choice.kind)
    .map((module) => module.id)
    .filter((id) => !choice.options.includes(id));
  return [...choice.options, ...ofKind];
}
