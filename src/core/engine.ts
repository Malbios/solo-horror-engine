import type { Action, GameEvent, GameState, RuleError, StepOutcome } from "./model";
import type { Pack, TrackDefinition } from "./pack";
import { assertNever, err, ok, type Result } from "./result";
import { seedRng, shuffle } from "./rng";

export type Engine = {
  init(seed: number): GameState;
  step(state: GameState, action: Action): Result<StepOutcome, RuleError>;
  legalActions(state: GameState): Action[];
};

export function createEngine(pack: Pack): Engine {
  const trackById = new Map(pack.tracks.map((track) => [track.id, track]));

  function allTracksAtMaximum(tracks: Record<string, number>): boolean {
    return pack.tracks.every((track) => tracks[track.id] === track.max);
  }

  function init(seed: number): GameState {
    const [shuffledCardIds, rng] = shuffle(
      seedRng(seed),
      pack.deck.cards.map((card) => card.id),
    );
    const zones = Object.fromEntries(pack.zones.map((zone) => [zone.id, [] as string[]]));
    zones[pack.deck.startZone] = shuffledCardIds;
    const tracks = Object.fromEntries(pack.tracks.map((track) => [track.id, track.start]));
    return {
      packId: pack.meta.id,
      status: allTracksAtMaximum(tracks) ? "finished" : "playing",
      rng,
      zones,
      tracks,
    };
  }

  function advanceTrack(
    state: GameState,
    track: TrackDefinition | undefined,
    trackId: string,
  ): Result<StepOutcome, RuleError> {
    if (track === undefined) {
      return err({ type: "unknownTrack", trackId });
    }
    const current = state.tracks[trackId] ?? track.start;
    if (current >= track.max) {
      return err({ type: "trackAtMaximum", trackId });
    }
    const value = current + 1;
    const tracks = { ...state.tracks, [trackId]: value };
    const events: GameEvent[] = [{ type: "trackAdvanced", trackId, value }];
    const finished = allTracksAtMaximum(tracks);
    if (finished) {
      events.push({ type: "gameFinished" });
    }
    return ok({ state: { ...state, tracks, status: finished ? "finished" : "playing" }, events });
  }

  function step(state: GameState, action: Action): Result<StepOutcome, RuleError> {
    if (state.status === "finished") {
      return err({ type: "gameFinished" });
    }
    switch (action.type) {
      case "advanceTrack":
        return advanceTrack(state, trackById.get(action.trackId), action.trackId);
      default:
        return assertNever(action.type);
    }
  }

  function legalActions(state: GameState): Action[] {
    if (state.status === "finished") {
      return [];
    }
    return pack.tracks
      .filter((track) => (state.tracks[track.id] ?? track.start) < track.max)
      .map((track) => ({ type: "advanceTrack", trackId: track.id }));
  }

  return { init, step, legalActions };
}
