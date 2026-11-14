import type { Rng } from "./rng";

export type GameStatus = "playing" | "finished";

export type GameState = {
  packId: string;
  status: GameStatus;
  rng: Rng;
  zones: Record<string, string[]>;
  tracks: Record<string, number>;
};

export type Action = { type: "advanceTrack"; trackId: string };

export type GameEvent =
  { type: "trackAdvanced"; trackId: string; value: number } | { type: "gameFinished" };

export type RuleError =
  | { type: "gameFinished" }
  | { type: "unknownTrack"; trackId: string }
  | { type: "trackAtMaximum"; trackId: string };

export type StepOutcome = { state: GameState; events: GameEvent[] };
