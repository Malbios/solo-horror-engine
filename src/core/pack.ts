export const PACK_SCHEMA_VERSION = 2;

export type Scope = "step" | "phase" | "round";

export type ContextKey = "from" | "to" | "amount";

export type NumberPair = [NumExpr, NumExpr];

export type UnitRef =
  "self" | { id: string } | { closest: { kind: string; origin: SpaceRef; filter: string } };

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
  | { sameSpace: [UnitRef, UnitRef] };

export type SortKey = { key: NumExpr; direction: "asc" | "desc" };

export type TieBreak = "id" | "random" | "decision";

export type Order = { sortBy: SortKey[]; tieBreak: TieBreak };

export type UnitSet = { kind: string | null; at: SpaceRef | null; where: BoolExpr };

export type Cost =
  | { counter: string; amount: NumExpr }
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
  | { type: "playWindow"; from: string; to: string }
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
    }
  | { type: "stepMove"; unit: UnitRef; steps: NumExpr; filter: string }
  | { type: "changeAttribute"; unit: UnitRef; attribute: string; amount: NumExpr }
  | { type: "setAttribute"; unit: UnitRef; attribute: string; value: NumExpr }
  | { type: "changeSpaceCounter"; at: SpaceRef; spaceCounter: string; amount: NumExpr }
  | { type: "setSpaceCounter"; at: SpaceRef; spaceCounter: string; value: NumExpr }
  | { type: "forEachUnit"; units: UnitSet; order: Order; effects: Effect[] }
  | { type: "selectUnits"; units: UnitSet; order: Order; count: NumExpr; effects: Effect[] }
  | { type: "deliver"; quantity: string; amount: NumExpr; recipient: UnitRef | null }
  | { type: "rollDice"; pool: string; die: string; count: NumExpr }
  | { type: "addDice"; pool: string; die: string; count: NumExpr }
  | { type: "rerollDice"; pool: string; faces: string[] | null; mode: "all" | "choose" }
  | { type: "setDieFace"; pool: string; faces: string[]; toFace: string; count: NumExpr }
  | { type: "assignDice"; pool: string; roles: DiceRole[] }
  | { type: "lookup"; value: NumExpr; entries: LookupEntry[]; otherwise: Effect[] }
  | { type: "randomTable"; entries: TableEntry[]; ifNone: Effect[] }
  | { type: "addEdge"; edge: Edge }
  | { type: "removeEdge"; edge: string }
  | { type: "retargetEdge"; edge: string; toSpace: string }
  | { type: "call"; procedure: string; args: Record<string, NumExpr> };

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

export type Edge = {
  id: string;
  fromSpace: string;
  toSpace: string;
  directed: boolean;
  tags: string[];
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
  start: number;
  min: number | null;
  max: number | null;
  resetScope: Scope | null;
  onOverflow: Effect[];
  onUnderflow: Effect[];
};

export type ZoneFace = "up" | "down";

export type Zone = { id: string; name: string; face: ZoneFace };

export type Card = {
  id: string;
  name: string;
  text: string;
  image: string | null;
  copies: number;
  playable: BoolExpr;
  cost: Cost[];
  effects: Effect[];
};

export type DieFace = { id: string; symbols: Record<string, number> };

export type DieType = { id: string; faces: DieFace[] };

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

export type UnitKind = { id: string; name: string; image: string | null; attributes: Counter[] };

export type Content = {
  boards: Board[];
  spaces: Space[];
  edges: Edge[];
  edgeFilters: EdgeFilter[];
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
  round: ScopeHooks;
  phases: Phase[];
};

export const LAYERED_COLLECTIONS = [
  "boards",
  "spaces",
  "edges",
  "edgeFilters",
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
  kind: string;
  precedence: number;
  content: Content;
  remove: Removal;
};

export type Choice = { id: string; options: string[]; min: number; max: number };

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
