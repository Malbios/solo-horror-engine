import type { ExpressionContext } from "./expressions";
import type { Effect, Outcome, Scope } from "./pack";
import type { Rng } from "./rng";

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

export type Frame = EffectsFrame | ScopeFrame | PlayWindowFrame | FinishFrame;

export type OptionView = { id: string; label: string; effects: Effect[] };

export type Decision =
  | { kind: "pickModule"; choice: string; options: string[]; canPass: boolean }
  | {
      kind: "chooseOption";
      options: OptionView[];
      canPass: boolean;
      context: ExpressionContext;
    }
  | { kind: "playCard"; cards: string[] };

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
  cardSerials: Record<string, number>;
  firedTriggers: string[];
  stack: Frame[];
  pending: Decision | null;
};

export type Action =
  | { type: "pickModule"; module: string }
  | { type: "chooseOption"; option: string }
  | { type: "playCard"; card: string }
  | { type: "pass" };

export type GameEvent =
  | { type: "moduleChosen"; module: string }
  | { type: "counterChanged"; counter: string; from: number; to: number }
  | { type: "cardsMoved"; from: string | null; to: string; cards: string[] }
  | { type: "scopeEntered"; scope: Scope; id: string }
  | { type: "scopeExited"; scope: Scope; id: string }
  | { type: "gameFinished"; outcome: Outcome; endCondition: string };

export type RuleError =
  | { type: "gameFinished" }
  | { type: "notPending" }
  | { type: "illegalAction"; action: Action }
  | { type: "engineFault"; reason: string };

export type StepOutcome = { state: GameState; events: GameEvent[] };
