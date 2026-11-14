import demoPackData from "../../content/demo/pack.json";
import { parsePack } from "../content";
import {
  createEngine,
  ENGINE_VERSION,
  replay,
  type Action,
  type Engine,
  type GameState,
  type Pack,
} from "../core";
import {
  describeSaveMismatch,
  LocalStorageSaveStore,
  type Save,
  type SaveStore,
} from "./save-store";

const SAVE_KEY = "solo-horror-engine:save";

type Session = { seed: number; actions: Action[]; state: GameState };

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

function start(pack: Pack, engine: Engine, store: SaveStore): void {
  const statusText = requireElement("status", HTMLParagraphElement);
  const actButton = requireElement("act", HTMLButtonElement);
  const newGameButton = requireElement("new-game", HTMLButtonElement);
  const identity = {
    engineVersion: ENGINE_VERSION,
    packId: pack.meta.id,
    packVersion: pack.meta.version,
  };
  let session: Session | null = null;

  function render(message: string): void {
    statusText.textContent = message;
    actButton.disabled = session === null || engine.legalActions(session.state).length === 0;
    if (session !== null) {
      console.log("state", session.state);
    }
  }

  function persist(current: Session): void {
    const save: Save = { ...identity, seed: current.seed, actions: current.actions };
    store.save(save);
  }

  function newGame(): void {
    const seed = randomSeed();
    session = { seed, actions: [], state: engine.init(seed) };
    persist(session);
    render(`New game, seed ${seed}.`);
  }

  function resume(): void {
    const loaded = store.load();
    switch (loaded.type) {
      case "none":
        newGame();
        return;
      case "corrupt":
        render("Saved game is unreadable. Start a new game.");
        return;
      case "ok": {
        const mismatch = describeSaveMismatch(loaded.save, identity);
        if (mismatch !== null) {
          render(`Saved game is from a different version (${mismatch}). Start a new game.`);
          return;
        }
        const replayed = replay(engine, loaded.save.seed, loaded.save.actions);
        if (!replayed.ok) {
          render("Saved game could not be replayed. Start a new game.");
          return;
        }
        session = { seed: loaded.save.seed, actions: loaded.save.actions, state: replayed.value };
        render(`Resumed game after ${session.actions.length} actions.`);
        return;
      }
    }
  }

  actButton.addEventListener("click", () => {
    if (session === null) return;
    const [action] = engine.legalActions(session.state);
    if (action === undefined) return;
    const outcome = engine.step(session.state, action);
    if (!outcome.ok) {
      render(`Action rejected: ${outcome.error.type}`);
      return;
    }
    session = { ...session, actions: [...session.actions, action], state: outcome.value.state };
    persist(session);
    console.log("events", outcome.value.events);
    render(`Action ${session.actions.length} applied. Status: ${session.state.status}.`);
  });

  newGameButton.addEventListener("click", newGame);

  resume();
}

const parsed = parsePack(demoPackData);
if (parsed.ok) {
  start(
    parsed.value,
    createEngine(parsed.value),
    new LocalStorageSaveStore(SAVE_KEY, localStorage),
  );
} else {
  console.error("Demo pack is invalid", parsed.error);
}
