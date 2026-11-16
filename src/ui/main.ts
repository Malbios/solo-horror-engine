import demoPackData from "../../content/demo/pack.json";
import { combineAddOns, missingModuleKinds, parsePack } from "../content";
import {
  canUndo,
  createEngine,
  ENGINE_VERSION,
  undo,
  view,
  viewActions,
  viewError,
  type Action,
  type AddOn,
  type Engine,
  type GameState,
  type GameView,
  type Pack,
  type Rules,
} from "../core";
import { renderMap } from "./board";
import { automaticPass, renderDecision } from "./decision";
import { h, requireElement } from "./dom";
import { logEntry, replayWithLog, withEntry } from "./game-log";
import { createLabels, displayRules, moduleInfo, type Labels } from "./labels";
import { renderLog, renderTracks, renderZones, type LogEntry, type MoreState } from "./panels";
import { renderStatus } from "./status";
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
  refreshLibrary,
  withAddOn,
  withoutAddOn,
  type LibraryStore,
} from "./pack-store";
import {
  chooseFolder,
  ensureReadable,
  folderSupported,
  readJsonTexts,
  rememberedFolder,
  rememberFolder,
} from "./folder-source";
import { cardDetails, createSheet, spaceDetails } from "./sheet";
import "./style.css";

const PACK_KEY = "solo-horror-engine:pack";
const ADD_ONS_KEY = "solo-horror-engine:add-ons";
const SAVE_KEY_PREFIX = "solo-horror-engine:save:";

type ActivePack = { pack: Pack; fromFile: boolean; addOns: AddOn[]; notice: string };
const PANELS = ["cards", "tracks"] as const;
type Panel = (typeof PANELS)[number];
const PANEL_TITLES: Record<Panel, string> = { tracks: "Tracks", cards: "Cards" };

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
  let folder: FileSystemDirectoryHandle | null = null;
  const roundText = requireElement("round", HTMLSpanElement);
  const undoButton = requireElement("undo", HTMLButtonElement);
  const menuButton = requireElement("menu", HTMLButtonElement);
  const mapArea = requireElement("map", HTMLElement);
  const table = requireElement("table", HTMLElement);
  const tabs = requireElement("tabs", HTMLElement);
  const panels = requireElement("panels", HTMLElement);
  const decisionBar = requireElement("decision", HTMLElement);
  const notice = requireElement("notice", HTMLParagraphElement);
  const statusStrip = requireElement("status", HTMLDivElement);
  const openMore = new Set<string>();
  const more: MoreState = {
    isOpen: (key) => openMore.has(key),
    setOpen: (key, open) => {
      if (open) openMore.add(key);
      else openMore.delete(key);
    },
  };
  const sheetDialog = requireElement("sheet", HTMLDialogElement);
  const sheet = createSheet(sheetDialog);
  const logDrawer = requireElement("log-drawer", HTMLElement);
  const logTag = requireElement("log-tag", HTMLButtonElement);
  const logBody = requireElement("log-body", HTMLDivElement);
  let logOpen = false;
  const identity = {
    engineVersion: ENGINE_VERSION,
    packId: pack.meta.id,
    packVersion: pack.meta.version,
  };
  let session: Session | null = null;
  let activePanel: Panel = "cards";
  let rulesCache: { key: string; rules: Rules } | null = null;
  const modules = moduleInfo(pack);

  function labelsFor(shown: GameView): Labels {
    const key = shown.modules.join("|");
    if (rulesCache === null || rulesCache.key !== key) {
      rulesCache = { key, rules: displayRules(pack, shown.modules) };
    }
    return createLabels(rulesCache.rules, shown, modules);
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
    logBody.replaceChildren(
      h("h2", { className: "log-drawer-title", text: "Log" }),
      renderLog(current?.log ?? []),
    );
    showNewestLogEntry();
    if (current === null) {
      statusStrip.replaceChildren();
      statusStrip.hidden = true;
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
    statusStrip.replaceChildren(...renderStatus(shown, labels));
    statusStrip.hidden = statusStrip.childElementCount === 0;
    undoButton.disabled = !current.undoable;
    mapArea.replaceChildren(
      ...renderMap(shown, actions, labels, {
        takeAction: take,
        showSpace: (space) => sheet.open(space.name, spaceDetails(space, shown, labels)),
      }),
    );
    panels.replaceChildren(
      panelSection("cards", renderZones(shown, labels, openCard, more)),
      panelSection("tracks", renderTracks(shown, labels, more)),
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

  function applied(current: Session, action: Action): Session | string {
    const outcome = engine.step(current.state, action);
    if (!outcome.ok) {
      return `That action was refused (${viewError(outcome.error, current.state).type}).`;
    }
    const { state, events, undoBarrier } = outcome.value;
    return {
      ...current,
      actions: [...current.actions, action],
      state,
      undoable: !undoBarrier,
      log: withEntry(current.log, logEntry(action, current.state, state, events, labelsFor)),
    };
  }

  function automaticPassFor(state: GameState): Action | null {
    return automaticPass(view(state), viewActions(state));
  }

  function appliedWithAutomaticPasses(current: Session, action: Action): Session | string {
    const next = applied(current, action);
    if (typeof next === "string") return next;
    const pass = automaticPassFor(next.state);
    return pass === null ? next : appliedWithAutomaticPasses(next, pass);
  }

  function take(action: Action): void {
    if (session === null) return;
    const next = appliedWithAutomaticPasses(session, action);
    if (typeof next === "string") {
      render(next);
      return;
    }
    session = next;
    persist(session);
    sheet.close();
    render();
    focusDecision();
  }

  /** Undoes the last action, and also the action before it when the last was a pass taken automatically. */
  function undoneActions(seed: number, actions: readonly Action[]) {
    const undone = undo(engine, seed, actions);
    if (!undone.ok || automaticPassFor(undone.value.state) === null) return undone;
    return undo(engine, seed, undone.value.actions);
  }

  function takeBack(): void {
    if (session === null) return;
    const undone = undoneActions(session.seed, session.actions);
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
      log: withEntry(session.log, { title: "Took back the last action", lines: [] }),
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
        ...folderButtons(),
        active.fromFile
          ? h("button", { className: "action", text: "Use demo core", onClick: useDemoCore })
          : null,
      ]),
      folder === null ? null : h("p", { className: "muted", text: `Packs folder: ${folder.name}` }),
      fileInput,
    ]);
  }

  function folderButtons(): HTMLElement[] {
    if (!folderSupported()) return [];
    const reload = h("button", {
      className: "action",
      text: "Reload packs from folder",
      onClick: () => void reloadFromFolder(false),
    });
    if (folder === null) return [reload];
    const another = h("button", {
      className: "action action-pass",
      text: "Choose another folder",
      onClick: () => void reloadFromFolder(true),
    });
    return [reload, another];
  }

  async function reloadFromFolder(pickAnother: boolean): Promise<void> {
    let chosen: FileSystemDirectoryHandle;
    try {
      chosen = pickAnother || folder === null ? await chooseFolder() : folder;
      if (!(await ensureReadable(chosen))) {
        openMenu(["The browser did not allow reading that folder."]);
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      openMenu(["That folder could not be opened."]);
      return;
    }
    if (chosen !== folder) {
      folder = chosen;
      await rememberFolder(chosen).catch((error: unknown) => {
        console.warn("Could not remember the packs folder", error);
      });
    }
    const refreshed = refreshLibrary(
      library.loadCore(),
      library.loadAddOns(),
      await readJsonTexts(chosen),
    );
    const stored =
      (refreshed.core === null || library.saveCore(refreshed.core)) &&
      library.saveAddOns(refreshed.addOns);
    if (!stored) {
      openMenu(["The files are too large for this browser to remember."]);
      return;
    }
    if (refreshed.missing.length === 0) {
      location.reload();
      return;
    }
    sheet.open("Some packs were not found", [
      h("p", { text: `Not in ${chosen.name}: ${refreshed.missing.join(", ")}.` }),
      h("p", { className: "muted", text: "The packs that were found are updated." }),
      h("div", { className: "actions" }, [
        h("button", { className: "action", text: "Reload now", onClick: () => location.reload() }),
      ]),
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
        const replayed = replayWithLog(engine, seed, actions, labelsFor);
        if (!replayed.ok) {
          render("The saved game could not be replayed. Start a new game.");
          return;
        }
        session = {
          seed,
          actions,
          state: replayed.value.state,
          undoable: canUndo(engine, seed, actions),
          log: withEntry(replayed.value.log, { title: "Game resumed", lines: [] }),
        };
        render(active.notice);
        return;
      }
    }
  }

  function showLog(open: boolean): void {
    logOpen = open;
    logDrawer.toggleAttribute("data-open", open);
    logTag.setAttribute("aria-expanded", String(open));
    logBody.inert = !open;
    showNewestLogEntry();
  }

  function showNewestLogEntry(): void {
    logBody.scrollTop = logBody.scrollHeight;
  }

  function keepTagClearOfScrollbar(): void {
    const scrollbar = table.offsetWidth - table.clientWidth;
    logDrawer.style.setProperty("--page-scrollbar", `${scrollbar}px`);
  }

  const scrollbarWatch = new ResizeObserver(keepTagClearOfScrollbar);
  for (const watched of [table, ...table.children]) scrollbarWatch.observe(watched);
  logTag.addEventListener("click", () => showLog(!logOpen));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && logOpen && !sheetDialog.open) showLog(false);
  });
  undoButton.addEventListener("click", takeBack);
  menuButton.addEventListener("click", () => openMenu());

  if (folderSupported()) {
    void rememberedFolder().then((remembered) => {
      folder = remembered;
    });
  }

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

function describeKind(kind: string): string {
  const words = kind.replaceAll("-", " ");
  return /^[aeiou]/i.test(words) ? `an ${words}` : `a ${words}`;
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
  const missing = core === null ? [] : missingModuleKinds(base, fitting);
  const reason =
    missing.length > 0
      ? `Core loaded. Still needed: ${missing.map(describeKind).join(", ")}. Load them from the menu.`
      : `These files do not fit together: ${combined.error.slice(0, 3).join("; ")}.`;
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
