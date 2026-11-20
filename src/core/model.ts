import type { ExpressionContext } from "./expressions";
import type { UnitState } from "./graph";
import type {
  BoolExpr,
  CardFilter,
  CardPosition,
  Cost,
  Edge,
  Effect,
  Followers,
  Order,
  Outcome,
  PlayWindowEffect,
  Scope,
  SpaceRef,
  StepInstead,
  TieBreak,
} from "./pack";
import type { Rng } from "./rng";

export type { UnitPlacement, UnitState } from "./graph";

export type GameStatus = "awaitingDecision" | "finished" | "faulted";

export type Stage = "choices" | "setup" | "rounds";

export type ScopeStatus = "enter" | "body" | "exit" | "closing";

export type EffectsFrame = {
  kind: "effects";
  effects: Effect[];
  index: number;
  context: ExpressionContext;
  source: string | null;
};

export type ScopeFrame = {
  kind: "scope";
  scope: Scope;
  id: string;
  phaseId: string | null;
  child: number;
  status: ScopeStatus;
};

export type PlayWindowFrame = Omit<PlayWindowEffect, "type"> & { kind: "playWindow" };

export type FinishFrame = { kind: "finish"; endCondition: string };

export type MoveFrame = {
  kind: "move";
  unit: string;
  remaining: number;
  filter: string;
  /** toward: automatic steps to a target; choose: the player picks each step and may stop; forced: no stopping. */
  mode: "toward" | "choose" | "forced";
  target: SpaceRef | null;
  stopWhen: BoolExpr;
  freeWhen: BoolExpr;
  enterWhen: BoolExpr;
  /** Automatic moves: effects when every step toward the target was refused by `enterWhen`. */
  blocked: Effect[];
  /** Automatic moves: the move ends only on a space where this holds. */
  endWhen: BoolExpr;
  instead: StepInstead | null;
  /** Where the mover stood before a step resolved by `instead`, until its followers are offered. */
  insteadFrom: string | null;
  order: Order | null;
  followers: Followers | null;
  context: ExpressionContext;
};

export type FollowFrame = {
  kind: "follow";
  to: string;
  candidates: string[];
  remaining: number;
  /** Followers still required before the player may pass. */
  required: number;
};

export type SelectFrame = {
  kind: "select";
  groups: string[][];
  remaining: number | null;
  tieBreak: TieBreak;
  effects: Effect[];
  context: ExpressionContext;
  /** The unit the loop is working on now. */
  current: string | null;
  /** Per-group triggers that fire once the loop ends, each with the context of its first event. */
  deferred: DeferredTrigger[];
};

export type DeferredTrigger = { trigger: string; context: ExpressionContext };

export type DeliverFrame = {
  kind: "deliver";
  quantity: string;
  amount: number;
  recipient: string | null;
  applied: string[];
  declined: string[];
  offering: boolean;
  context: ExpressionContext;
};

export type Discarding = { from: string; to: string; remaining: number };

export type PayFrame = {
  kind: "pay";
  costs: Cost[];
  index: number;
  discarding: Discarding | null;
  context: ExpressionContext;
};

/** The player picks face-up cards out of a zone one at a time. */
export type PickFrame = {
  kind: "pick";
  from: string;
  to: string;
  remaining: number;
  cards: CardFilter;
  optional: boolean;
  position: CardPosition;
};

export type Die = { id: string; die: string; face: string; role: string | null };

export type RerollFrame = {
  kind: "reroll";
  pool: string;
  faces: string[] | null;
  marked: string[];
  max: number | null;
};

export type SetFaceFrame = {
  kind: "setFace";
  pool: string;
  faces: string[];
  toFace: string;
  remaining: number;
};

export type AssignFrame = {
  kind: "assign";
  pool: string;
  roles: { role: string; remaining: number }[];
};

export type Frame =
  | EffectsFrame
  | ScopeFrame
  | PlayWindowFrame
  | FinishFrame
  | MoveFrame
  | FollowFrame
  | SelectFrame
  | DeliverFrame
  | PayFrame
  | PickFrame
  | RerollFrame
  | SetFaceFrame
  | AssignFrame;

export type AbilityOffer = { card: string; ability: string };

export type OptionView = { id: string; label: string; cost: Cost[]; effects: Effect[] };

export type Decision =
  | { kind: "pickModule"; choice: string; options: string[]; canPass: boolean }
  | {
      kind: "chooseOption";
      options: OptionView[];
      canPass: boolean;
      context: ExpressionContext;
    }
  | {
      kind: "window";
      play: string[];
      discard: string[];
      buy: string[];
      /** The zone cards are bought from, so the player can see what is not affordable. */
      buyFrom: string | null;
      buyFree: boolean;
      abilities: AbilityOffer[];
    }
  | { kind: "moveUnit"; unit: string; options: string[]; canPass: boolean }
  | { kind: "pickUnit"; options: string[]; canPass: boolean }
  | { kind: "pickCard"; cards: string[]; canPass: boolean }
  | { kind: "pickDie"; pool: string; dice: string[]; canPass: boolean };

export type GameOutcome = { result: Outcome; endCondition: string };

export type GameState = {
  packId: string;
  status: GameStatus;
  outcome: GameOutcome | null;
  fault: string | null;
  rng: Rng;
  stage: Stage;
  choiceIndex: number;
  modules: string[];
  round: number;
  counters: Record<string, number>;
  zones: Record<string, string[]>;
  faceUp: Record<string, boolean>;
  handles: Record<string, string>;
  handleSerial: number;
  known: Record<string, true>;
  cardSerials: Record<string, number>;
  /** Counters carried by card instances, by card then counter id. */
  cardCounters: Record<string, Record<string, number>>;
  /** Parts of cards revealed so far, by card, in reveal order (the text the player has seen). */
  revealedParts: Record<string, { part: string; text: string }[]>;
  units: Record<string, UnitState>;
  unitSerial: number;
  retiredUnits: string[];
  edges: Record<string, Edge>;
  spaceCounters: Record<string, Record<string, number>>;
  pools: Record<string, Die[]>;
  firedTriggers: string[];
  abilityUses: Record<string, number>;
  stack: Frame[];
  pending: Decision | null;
};

export type Action =
  | { type: "pickModule"; module: string }
  | { type: "chooseOption"; option: string }
  | { type: "playCard"; card: string }
  | { type: "discardCard"; card: string }
  | { type: "buyCard"; card: string }
  | { type: "useAbility"; card: string; ability: string }
  | { type: "moveTo"; space: string }
  | { type: "pickUnit"; unit: string }
  | { type: "pickCard"; card: string }
  | { type: "pickDie"; die: string }
  | { type: "pass" };

export type GameEvent =
  | { type: "moduleChosen"; module: string }
  | { type: "counterChanged"; counter: string; from: number; to: number }
  | { type: "cardsMoved"; from: string | null; to: string; cards: string[] }
  | { type: "scopeEntered"; scope: Scope; id: string }
  | { type: "scopeExited"; scope: Scope; id: string }
  | { type: "gameFinished"; outcome: Outcome; endCondition: string }
  | { type: "unitCreated"; unit: string; kind: string }
  | { type: "unitRemoved"; unit: string; kind: string; fromSpace: string | null }
  | {
      type: "unitMoved";
      unit: string;
      kind: string;
      fromSpace: string | null;
      toSpace: string | null;
    }
  | { type: "unitKindChanged"; unit: string; from: string; to: string }
  | {
      type: "attributeChanged";
      unit: string;
      kind: string;
      attribute: string;
      from: number;
      to: number;
    }
  | { type: "spaceCounterChanged"; space: string; spaceCounter: string; from: number; to: number }
  | { type: "edgeChanged"; edge: string; change: "added" | "removed" | "retargeted" }
  | { type: "diceRolled"; pool: string; dice: Die[] }
  | { type: "abilityUsed"; card: string; ability: string }
  | { type: "cardResolved"; card: string }
  | { type: "cardBought"; card: string }
  | { type: "cardCounterChanged"; card: string; counter: string; from: number; to: number }
  | {
      type: "quantityDelivered";
      quantity: string;
      unit: string | null;
      kind: string | null;
      amount: number;
    };

export type RuleError =
  | { type: "gameFinished" }
  | { type: "notPending" }
  | { type: "illegalAction"; action: Action }
  | { type: "engineFault"; reason: string };

export type StepOutcome = { state: GameState; events: GameEvent[]; undoBarrier: boolean };
