import type { ExpressionContext } from "./expressions";
import type { UnitState } from "./graph";
import type {
  BoolExpr,
  Cost,
  Edge,
  Effect,
  Order,
  Outcome,
  Scope,
  SpaceRef,
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

export type PlayWindowFrame = { kind: "playWindow"; from: string; to: string };

export type FinishFrame = { kind: "finish"; endCondition: string };

export type MoveFrame = {
  kind: "move";
  unit: string;
  remaining: number;
  filter: string;
  mode: "toward" | "choose";
  target: SpaceRef | null;
  stopWhen: BoolExpr;
  order: Order | null;
  context: ExpressionContext;
};

export type SelectFrame = {
  kind: "select";
  groups: string[][];
  remaining: number | null;
  tieBreak: TieBreak;
  effects: Effect[];
  context: ExpressionContext;
};

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

export type Die = { id: string; die: string; face: string; role: string | null };

export type RerollFrame = {
  kind: "reroll";
  pool: string;
  faces: string[] | null;
  marked: string[];
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
  | SelectFrame
  | DeliverFrame
  | PayFrame
  | RerollFrame
  | SetFaceFrame
  | AssignFrame;

export type OptionView = { id: string; label: string; cost: Cost[]; effects: Effect[] };

export type Decision =
  | { kind: "pickModule"; choice: string; options: string[]; canPass: boolean }
  | {
      kind: "chooseOption";
      options: OptionView[];
      canPass: boolean;
      context: ExpressionContext;
    }
  | { kind: "playCard"; cards: string[] }
  | { kind: "moveUnit"; unit: string; options: string[]; canPass: boolean }
  | { kind: "pickUnit"; options: string[] }
  | { kind: "pickCard"; cards: string[] }
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
  units: Record<string, UnitState>;
  unitSerial: number;
  retiredUnits: string[];
  edges: Record<string, Edge>;
  spaceCounters: Record<string, Record<string, number>>;
  pools: Record<string, Die[]>;
  firedTriggers: string[];
  stack: Frame[];
  pending: Decision | null;
};

export type Action =
  | { type: "pickModule"; module: string }
  | { type: "chooseOption"; option: string }
  | { type: "playCard"; card: string }
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
  | { type: "unitRemoved"; unit: string; kind: string }
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
