export const PACK_SCHEMA_VERSION = 2;

export type Scope = "step" | "phase" | "round";

export type ContextKey = "from" | "to" | "amount";

export type NumberPair = [NumExpr, NumExpr];

export type NumExpr =
  | number
  | { counter: string }
  | { zoneCount: string }
  | { context: ContextKey }
  | { add: NumExpr[] }
  | { sub: NumberPair }
  | { mul: NumberPair }
  | { min: NumExpr[] }
  | { max: NumExpr[] };

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
  | { not: BoolExpr };

export type ChooseOption = {
  id: string;
  label: string;
  when: BoolExpr;
  effects: Effect[];
};

export type CardPosition = "top" | "bottom";

export type Effect =
  | { type: "changeCounter"; counter: string; amount: NumExpr }
  | { type: "setCounter"; counter: string; value: NumExpr }
  | { type: "moveCards"; from: string; to: string; count: NumExpr; position: CardPosition }
  | { type: "createCards"; card: string; zone: string }
  | { type: "shuffle"; zone: string }
  | { type: "if"; condition: BoolExpr; then: Effect[]; else: Effect[] }
  | { type: "choose"; optional: boolean; options: ChooseOption[] }
  | { type: "playWindow"; from: string; to: string }
  | { type: "endScope"; scope: Scope }
  | { type: "endGame"; endCondition: string };

export type EventPattern =
  | { event: "counterChanged"; counter: string }
  | { event: "cardsMoved"; from: string | null; to: string | null }
  | { event: "scopeEntered"; scope: Scope; id: string | null }
  | { event: "scopeExited"; scope: Scope; id: string | null };

export type Counter = {
  id: string;
  start: number;
  min: number | null;
  max: number | null;
  resetScope: Scope | null;
  onOverflow: Effect[];
  onUnderflow: Effect[];
};

export type ZoneFace = "up" | "down";

export type Zone = { id: string; face: ZoneFace };

export type Card = {
  id: string;
  name: string;
  copies: number;
  playable: BoolExpr;
  effects: Effect[];
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

export type Check = { id: string; condition: BoolExpr; effects: Effect[] };

export type Outcome = "win" | "loss";

export type OutcomeRule = Outcome | { when: BoolExpr; then: Outcome; else: Outcome };

export type EndCondition = {
  id: string;
  condition: BoolExpr;
  sequence: Effect[];
  outcome: OutcomeRule;
};

export type Content = {
  counters: Counter[];
  zones: Zone[];
  cards: Card[];
  triggers: Trigger[];
  checks: Check[];
  endConditions: EndCondition[];
  setup: Effect[];
  round: ScopeHooks;
  phases: Phase[];
};

export const LAYERED_COLLECTIONS = [
  "counters",
  "zones",
  "cards",
  "triggers",
  "checks",
  "endConditions",
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
