import demoPackData from "../../content/demo/pack.json";
import { combineAddOns, parsePack } from "../content";
import {
  canUndo,
  createEngine,
  ENGINE_VERSION,
  replay,
  undo,
  view,
  viewActions,
  viewError,
  viewEvents,
  type Action,
  type AddOn,
  type Engine,
  type GameState,
  type GameView,
  type Pack,
  type Rules,
} from "../core";
import { renderMap } from "./board";
import { renderDecision } from "./decision";
import { h, requireElement } from "./dom";
import { createLabels, describeAction, describeEvent, displayRules, type Labels } from "./labels";
import { renderLog, renderTracks, renderZones, type LogEntry } from "./panels";
import {
  describeSaveMismatch,
  LocalStorageSaveStore,
  type Save,
  type SaveStore,
} from "./save-store";
import {
  LocalStorageLibraryStore,
  parseAddOnText,
  parseLibraryFile,
  parsePackText,
  withAddOn,
  withoutAddOn,
  type LibraryStore,
} from "./pack-store";
import { cardDetails, createSheet, spaceDetails } from "./sheet";
import "./style.css";

const PACK_KEY = "solo-horror-engine:pack";
const ADD_ONS_KEY = "solo-horror-engine:add-ons";
const SAVE_KEY_PREFIX = "solo-horror-engine:save:";
const LOG_LIMIT = 100;

type ActivePack = { pack: Pack; fromFile: boolean; addOns: AddOn[]; notice: string };
const PANELS = ["tracks", "cards", "log"] as const;
type Panel = (typeof PANELS)[number];
const PANEL_TITLES: Record<Panel, string> = { tracks: "Tracks", cards: "Cards", log: "Log" };

type Session = {
  seed: number;
  actions: Action[];
  state: GameState;
  undoable: boolean;
  log: LogEntry[];
};

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

function start(active: ActivePack, library: LibraryStore, engine: Engine, store: SaveStore): void {
  const { pack } = active;
  const roundText = requireElement("round", HTMLSpanElement);
  const undoButton = requireElement("undo", HTMLButtonElement);
  const menuButton = requireElement("menu", HTMLButtonElement);
  const mapArea = requireElement("map", HTMLElement);
  const tabs = requireElement("tabs", HTMLElement);
  const panels = requireElement("panels", HTMLElement);
  const decisionBar = requireElement("decision", HTMLElement);
  const notice = requireElement("notice", HTMLParagraphElement);
  const sheet = createSheet(requireElement("sheet", HTMLDialogElement));
  const identity = {
    engineVersion: ENGINE_VERSION,
    packId: pack.meta.id,
    packVersion: pack.meta.version,
  };
  let session: Session | null = null;
  let activePanel: Panel = "cards";
  let rulesCache: { key: string; rules: Rules } | null = null;

  function labelsFor(shown: GameView): Labels {
    const key = shown.modules.join("|");
    if (rulesCache === null || rulesCache.key !== key) {
      rulesCache = { key, rules: displayRules(pack, shown.modules) };
    }
    return createLabels(rulesCache.rules, shown);
  }

  function renderTabs(): void {
    tabs.replaceChildren(
      ...PANELS.map((panel) =>
        h("button", {
          className: panel === activePanel ? "tab tab-active" : "tab",
          text: PANEL_TITLES[panel],
          attrs: { "aria-pressed": String(panel === activePanel) },
          onClick: () => {
            activePanel = panel;
            render();
          },
        }),
      ),
    );
    panels.dataset["active"] = activePanel;
  }

  function render(message = ""): void {
    notice.textContent = message;
    notice.hidden = message === "";
    renderTabs();
    const current = session;
    if (current === null) {
      roundText.textContent = "";
      undoButton.disabled = true;
      mapArea.replaceChildren();
      panels.replaceChildren();
      decisionBar.replaceChildren(
        h("div", { className: "actions" }, [
          h("button", { className: "action", text: "New game", onClick: newGame }),
        ]),
      );
      return;
    }
    const shown = view(current.state);
    const actions = viewActions(current.state);
    const labels = labelsFor(shown);
    const openCard = (card: Parameters<typeof cardDetails>[0]) =>
      sheet.open(labels.card(card), cardDetails(card, labels));
    roundText.textContent = shown.round > 0 ? `Round ${shown.round}` : "Setup";
    undoButton.disabled = !current.undoable;
    mapArea.replaceChildren(
      ...renderMap(shown, actions, labels, {
        takeAction: take,
        showSpace: (space) => sheet.open(space.name, spaceDetails(space, shown, labels)),
      }),
    );
    panels.replaceChildren(
      panelSection("tracks", renderTracks(shown, labels)),
      panelSection("cards", renderZones(shown, labels, openCard)),
      panelSection("log", renderLog(current.log)),
    );
    decisionBar.replaceChildren(
      ...renderDecision(shown, actions, labels, {
        takeAction: take,
        openCard,
        newGame: confirmNewGame,
      }),
    );
  }

  function panelSection(panel: Panel, body: HTMLElement): HTMLElement {
    return h("section", { className: "panel", attrs: { "data-panel": panel } }, [
      h("h2", { className: "panel-title", text: PANEL_TITLES[panel] }),
      body,
    ]);
  }

  function focusDecision(): void {
    decisionBar.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }

  function take(action: Action): void {
    if (session === null) return;
    const outcome = engine.step(session.state, action);
    if (!outcome.ok) {
      render(`That action was refused (${viewError(outcome.error, session.state).type}).`);
      return;
    }
    const before = view(session.state);
    const title = describeAction(action, before, labelsFor(before));
    const { state, events, undoBarrier } = outcome.value;
    const shown = view(state);
    const labels = labelsFor(shown);
    const lines = viewEvents(events, state).flatMap((event) => {
      const line = describeEvent(event, shown, labels);
      return line === null ? [] : [line];
    });
    session = {
      ...session,
      actions: [...session.actions, action],
      state,
      undoable: !undoBarrier,
      log: [...session.log, { title, lines }].slice(-LOG_LIMIT),
    };
    persist(session);
    sheet.close();
    render();
    focusDecision();
  }

  function takeBack(): void {
    if (session === null) return;
    const undone = undo(engine, session.seed, session.actions);
    if (!undone.ok) {
      render(
        undone.error.type === "undoBlocked"
          ? "That cannot be taken back: it revealed something."
          : "Undo failed: the saved actions no longer replay.",
      );
      return;
    }
    const { state, actions } = undone.value;
    session = {
      ...session,
      state,
      actions,
      undoable: canUndo(engine, session.seed, actions),
      log: [...session.log, { title: "Took back the last action", lines: [] }].slice(-LOG_LIMIT),
    };
    persist(session);
    render();
    focusDecision();
  }

  function persist(current: Session): void {
    const save: Save = { ...identity, seed: current.seed, actions: current.actions };
    store.save(save);
  }

  function newGame(): void {
    const seed = randomSeed();
    session = { seed, actions: [], state: engine.init(seed), undoable: false, log: [] };
    persist(session);
    sheet.close();
    render();
    focusDecision();
  }

  function confirmNewGame(): void {
    if (session === null || session.state.status !== "awaitingDecision") {
      newGame();
      return;
    }
    sheet.open("Start a new game?", [
      h("p", { text: "The current game will be lost." }),
      h("div", { className: "actions" }, [
        h("button", { className: "action", text: "Start new game", onClick: newGame }),
        h("button", {
          className: "action action-pass",
          text: "Keep playing",
          onClick: sheet.close,
        }),
      ]),
    ]);
  }

  function openMenu(message: readonly string[] = []): void {
    const fileInput = h("input", {
      attrs: { type: "file", accept: ".json,application/json", hidden: "" },
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file !== undefined) void loadPackFile(file);
    });
    sheet.open("Menu", [
      h("p", { text: `${pack.meta.name} ${pack.meta.version}` }),
      h("p", { className: "muted", text: `Engine ${ENGINE_VERSION}` }),
      ...message.map((line) => h("p", { className: "sheet-error", text: line })),
      renderAddOnList(),
      h("div", { className: "actions" }, [
        h("button", { className: "action", text: "New game", onClick: confirmNewGame }),
        h("button", {
          className: "action",
          text: "Load core or add-on file",
          onClick: () => fileInput.click(),
        }),
        active.fromFile
          ? h("button", { className: "action", text: "Use demo core", onClick: useDemoCore })
          : null,
      ]),
      fileInput,
    ]);
  }

  function renderAddOnList(): HTMLElement | null {
    if (active.addOns.length === 0) return null;
    return h("section", {}, [
      h("h3", { text: "Add-ons" }),
      h(
        "ul",
        { className: "add-on-list" },
        active.addOns.map((addOn) =>
          h("li", { className: "add-on" }, [
            h("span", { text: `${addOn.meta.name} ${addOn.meta.version}` }),
            h("button", {
              className: "action action-pass",
              text: "Remove",
              attrs: { "aria-label": `Remove ${addOn.meta.name}` },
              onClick: () => removeAddOn(addOn.meta.id),
            }),
          ]),
        ),
      ),
    ]);
  }

  async function loadPackFile(file: File): Promise<void> {
    const text = await file.text();
    const parsed = parseLibraryFile(text);
    if (!parsed.ok) {
      openMenu(parsed.error);
      return;
    }
    const stored =
      parsed.value.type === "core"
        ? library.saveCore(text)
        : library.saveAddOns(withAddOn(library.loadAddOns(), text, parsed.value.addOn));
    if (!stored) {
      openMenu(["The file is too large for this browser to remember."]);
      return;
    }
    location.reload();
  }

  function removeAddOn(id: string): void {
    library.saveAddOns(withoutAddOn(library.loadAddOns(), id));
    location.reload();
  }

  function useDemoCore(): void {
    library.clearCore();
    location.reload();
  }

  function resume(): void {
    const loaded = store.load();
    switch (loaded.type) {
      case "none":
        newGame();
        if (active.notice !== "") render(active.notice);
        return;
      case "corrupt":
        render("The saved game is unreadable. Start a new game.");
        return;
      case "ok": {
        const mismatch = describeSaveMismatch(loaded.save, identity);
        if (mismatch !== null) {
          render(`The saved game is from a different version (${mismatch}). Start a new game.`);
          return;
        }
        const { seed, actions } = loaded.save;
        const replayed = replay(engine, seed, actions);
        if (!replayed.ok) {
          render("The saved game could not be replayed. Start a new game.");
          return;
        }
        session = {
          seed,
          actions,
          state: replayed.value,
          undoable: canUndo(engine, seed, actions),
          log: [{ title: `Resumed after ${actions.length} actions`, lines: [] }],
        };
        render(active.notice);
        return;
      }
    }
  }

  undoButton.addEventListener("click", takeBack);
  menuButton.addEventListener("click", () => openMenu());

  resume();
}

function storedCore(library: LibraryStore): { core: Pack | null; notices: string[] } {
  const stored = library.loadCore();
  if (stored === null) return { core: null, notices: [] };
  const parsed = parsePackText(stored);
  return parsed.ok
    ? { core: parsed.value, notices: [] }
    : { core: null, notices: ["The remembered core could not be read, so the demo core is used."] };
}

function chooseGame(library: LibraryStore): ActivePack | null {
  const demo = parsePack(demoPackData);
  if (!demo.ok) {
    console.error("Demo pack is invalid", demo.error);
    return null;
  }
  const { core, notices } = storedCore(library);
  const texts = library.loadAddOns();
  const addOns = texts.flatMap((text) => {
    const addOn = parseAddOnText(text);
    return addOn === null ? [] : [addOn];
  });
  if (addOns.length < texts.length) notices.push("Some remembered add-ons could not be read.");
  const base = core ?? demo.value;
  const fitting = addOns.filter((addOn) => addOn.meta.core === base.meta.id);
  const combined = combineAddOns(base, fitting);
  if (combined.ok) {
    return { pack: combined.value, fromFile: core !== null, addOns, notice: notices.join(" ") };
  }
  const reason = `These files do not fit together: ${combined.error.slice(0, 3).join("; ")}.`;
  return {
    pack: demo.value,
    fromFile: core !== null,
    addOns,
    notice: [...notices, reason].join(" "),
  };
}

const library = new LocalStorageLibraryStore(PACK_KEY, ADD_ONS_KEY, localStorage);
const active = chooseGame(library);
if (active !== null) {
  start(
    active,
    library,
    createEngine(active.pack),
    new LocalStorageSaveStore(SAVE_KEY_PREFIX + active.pack.meta.id, localStorage),
  );
}
