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
import { automaticAction, renderDecision, renderPlayback, rollToShow } from "./decision";
import { h, requireElement } from "./dom";
import { logEntry, replayWithLog, withEntry } from "./game-log";
import { createLabels, describeEvent, displayRules, moduleInfo, type Labels } from "./labels";
import { playbackBeats, readingMilliseconds, type Beat, type PlaybackStep } from "./playback";
import { clearToasts, showToast, toastTexts } from "./toast";
import {
  loadSettings,
  READING_SPEEDS,
  readingFactor,
  saveSettings,
  type Settings,
} from "./settings";
import { renderLog, renderTracks, renderZones, type LogEntry, type MoreState } from "./panels";
import { renderStatus } from "./status";
import {
  describeSaveMismatch,
  LocalStorageSaveStore,
  type Save,
  type SaveStore,
} from "./save-store";
import {
  IndexedDbLibraryStore,
  libraryFromFolder,
  LocalStorageLibraryStore,
  migrateLibrary,
  parseAddOnText,
  parseLibraryFile,
  parsePackText,
  refreshLibrary,
  withAddOn,
  withoutAddOn,
  type LibrarySnapshot,
} from "./pack-store";
import {
  chooseFolder,
  ensureReadable,
  folderSupported,
  readJsonTexts,
  rememberedFolder,
  rememberFolder,
} from "./folder-source";
import { createCardPreview } from "./card-preview";
import { cardDetails, createSheet, spaceDetails } from "./sheet";
import "./style.css";

const PACK_KEY = "solo-horror-engine:pack";
const ADD_ONS_KEY = "solo-horror-engine:add-ons";
const SAVE_KEY_PREFIX = "solo-horror-engine:save:";
const SLIDE_MILLISECONDS = 350;
// Safety cap on lone actions taken in a row for the player (a pack that loops on one choice).
const MAX_AUTOMATIC_ACTIONS = 200;

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

/** A session after an action, with each step taken on the way (the action and its automatic passes). */
type Taken = { session: Session; steps: PlaybackStep[] };

type Playback = { beats: Beat[]; index: number; timer: number | null };

/** A typical two-line note, to show what the chosen reading speed means. */
const SAMPLE_NOTE = ["A piece moves from the north path to the old shed", "Score +1 (now 4)"];

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function unitPositions(area: HTMLElement): Map<string, DOMRect> {
  return new Map(
    [...area.querySelectorAll<HTMLElement>("[data-unit]")].flatMap((chip) => {
      const unit = chip.dataset["unit"];
      return unit === undefined ? [] : [[unit, chip.getBoundingClientRect()]];
    }),
  );
}

/** Slides each piece from where it was drawn before to where it is drawn now. */
function slidePieces(area: HTMLElement, before: Map<string, DOMRect>): void {
  if (reducedMotion()) return;
  for (const chip of area.querySelectorAll<HTMLElement>("[data-unit]")) {
    const old = before.get(chip.dataset["unit"] ?? "");
    if (old === undefined) continue;
    const now = chip.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (dx === 0 && dy === 0) continue;
    chip.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
      duration: SLIDE_MILLISECONDS,
      easing: "ease-out",
    });
  }
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

/** The loaded files as they stand, and how to store a changed set. */
type Library = { current: LibrarySnapshot; save(next: LibrarySnapshot): Promise<boolean> };

function start(active: ActivePack, library: Library, engine: Engine, store: SaveStore): void {
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
  const toastRegion = requireElement("toasts", HTMLDivElement);
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
  const cardPreview = createCardPreview(requireElement("card-preview", HTMLDivElement));
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
  let playback: Playback | null = null;
  // The dice pool the current decision is about (shown under the prompt), set by the last action taken.
  let rollPool: string | null = null;
  let settings: Settings = loadSettings(localStorage);
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
    cardPreview.hide();
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
    const beat = playback === null ? null : (playback.beats[playback.index] ?? null);
    const shown = beat?.view ?? view(current.state);
    const actions = beat === null ? viewActions(current.state) : [];
    const labels = labelsFor(shown);
    const openCard = (card: Parameters<typeof cardDetails>[0]) =>
      sheet.open(labels.card(card), cardDetails(card, labels));
    const previewCard = (target: HTMLElement, card: Parameters<typeof cardDetails>[0]) =>
      cardPreview.attach(target, labels.card(card), () => cardDetails(card, labels));
    roundText.textContent = shown.round > 0 ? `Round ${shown.round}` : "Setup";
    statusStrip.replaceChildren(...renderStatus(shown, labels));
    statusStrip.hidden = statusStrip.childElementCount === 0;
    undoButton.disabled = !current.undoable;
    const piecesBefore = unitPositions(mapArea);
    mapArea.replaceChildren(
      ...renderMap(
        shown,
        actions,
        labels,
        {
          takeAction: take,
          showSpace: (space) => sheet.open(space.name, spaceDetails(space, shown, labels)),
        },
        new Set(beat?.focus ?? []),
      ),
    );
    slidePieces(mapArea, piecesBefore);
    panels.replaceChildren(
      panelSection(
        "cards",
        renderZones(shown, labels, { open: openCard, preview: previewCard }, more),
      ),
      panelSection("tracks", renderTracks(shown, labels, more)),
    );
    decisionBar.replaceChildren(
      ...(beat === null || playback === null
        ? renderDecision(
            shown,
            actions,
            labels,
            {
              takeAction: take,
              openCard,
              previewCard,
              newGame: confirmNewGame,
            },
            rollPool,
          )
        : renderPlayback(
            { index: playback.index, count: playback.beats.length },
            { next: nextBeat, skip: () => endPlayback(true) },
          )),
    );
  }

  /** Describes the current beat in a toast and moves on once its text could be read. */
  function announceBeat(): void {
    const beat = playback?.beats[playback.index];
    if (playback === null || beat === undefined) return;
    const labels = labelsFor(beat.view);
    const duration = readingMilliseconds(
      toastTexts(beat, labels),
      readingFactor(settings.readingSpeed),
    );
    showToast(toastRegion, beat, labels, duration, {
      onTap: nextBeat,
      openCard: (card) => sheet.open(labels.card(card), cardDetails(card, labels)),
    });
    playback.timer = window.setTimeout(nextBeat, duration);
  }

  function nextBeat(): void {
    if (playback === null) return;
    if (playback.timer !== null) window.clearTimeout(playback.timer);
    if (playback.index + 1 >= playback.beats.length) {
      endPlayback(false);
      return;
    }
    playback = { ...playback, index: playback.index + 1, timer: null };
    render();
    announceBeat();
  }

  /**
   * Shows the game as it is now; any automatic steps still to show are skipped. Toasts are cleared when
   * the player cut the playback short, and left to run out after its last beat.
   */
  function endPlayback(clear = true): void {
    if (clear) clearToasts(toastRegion);
    if (playback === null) return;
    if (playback.timer !== null) window.clearTimeout(playback.timer);
    playback = null;
    render();
    focusDecision();
  }

  function startPlayback(
    before: GameState,
    action: Action,
    steps: readonly PlaybackStep[],
  ): boolean {
    if (!settings.showAutomaticSteps) return false;
    const shownBefore = view(before);
    const pending = shownBefore.pending;
    const beats = playbackBeats({
      before: shownBefore,
      steps,
      ownMove: action.type === "moveTo" && pending?.kind === "moveUnit" ? pending.unit : null,
      describe: (event, shown) => describeEvent(event, shown, labelsFor(shown)),
      bookkeeping: (kind) => labelsFor(shownBefore).isBookkeeping(kind),
    });
    if (beats.length === 0) return false;
    playback = { beats, index: 0, timer: null };
    render();
    decisionBar.querySelector<HTMLButtonElement>("button.action")?.focus({ preventScroll: true });
    announceBeat();
    return true;
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

  function applied(current: Session, action: Action): Taken | string {
    const outcome = engine.step(current.state, action);
    if (!outcome.ok) {
      return `That action was refused (${viewError(outcome.error, current.state).type}).`;
    }
    const { state, events, undoBarrier } = outcome.value;
    return {
      session: {
        ...current,
        actions: [...current.actions, action],
        state,
        undoable: !undoBarrier,
        log: withEntry(current.log, logEntry(action, current.state, state, events, labelsFor)),
      },
      steps: [{ events: viewEvents(events, state), after: view(state) }],
    };
  }

  function automaticActionFor(state: GameState): Action | null {
    return state.status === "awaitingDecision" ? automaticAction(viewActions(state)) : null;
  }

  /** Takes every lone action in turn (one choice is no choice), until the player has a real choice. */
  function settleAutomatic(start: Session): Taken | string {
    let current = start;
    const steps: Taken["steps"] = [];
    for (let taken = 0; taken < MAX_AUTOMATIC_ACTIONS; taken += 1) {
      const only = automaticActionFor(current.state);
      if (only === null) return { session: current, steps };
      const next = applied(current, only);
      if (typeof next === "string") return next;
      current = next.session;
      steps.push(...next.steps);
    }
    return "Too many actions were taken automatically in a row.";
  }

  function appliedWithAutomaticActions(current: Session, action: Action): Taken | string {
    const next = applied(current, action);
    if (typeof next === "string") return next;
    const rest = settleAutomatic(next.session);
    return typeof rest === "string"
      ? rest
      : { session: rest.session, steps: [...next.steps, ...rest.steps] };
  }

  function take(action: Action): void {
    if (session === null) return;
    endPlayback();
    const before = session.state;
    const next = appliedWithAutomaticActions(session, action);
    if (typeof next === "string") {
      render(next);
      return;
    }
    session = next.session;
    rollPool = rollToShow(next.steps, view(session.state));
    persist(session);
    sheet.close();
    if (startPlayback(before, action, next.steps)) return;
    render();
    focusDecision();
  }

  /** Undoes the last action and every action taken automatically before it, back to the last real choice. */
  function undoneActions(seed: number, actions: readonly Action[]) {
    let undone = undo(engine, seed, actions);
    while (
      undone.ok &&
      undone.value.actions.length > 0 &&
      automaticActionFor(undone.value.state) !== null
    ) {
      undone = undo(engine, seed, undone.value.actions);
    }
    return undone;
  }

  function takeBack(): void {
    if (session === null) return;
    endPlayback();
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
    const { settledSession, notice } = settled({
      ...session,
      state,
      actions,
      undoable: canUndo(engine, session.seed, actions),
      log: withEntry(session.log, { title: "Took back the last action", lines: [] }),
    });
    session = settledSession;
    rollPool = null;
    persist(session);
    render(notice);
    focusDecision();
  }

  /** The session with its lone actions taken (see settleAutomatic), and a notice if that failed. */
  function settled(current: Session): { settledSession: Session; notice: string } {
    const result = settleAutomatic(current);
    return typeof result === "string"
      ? { settledSession: current, notice: result }
      : { settledSession: result.session, notice: "" };
  }

  function persist(current: Session): void {
    const save: Save = { ...identity, seed: current.seed, actions: current.actions };
    store.save(save);
  }

  function newGame(): void {
    endPlayback();
    const seed = randomSeed();
    const { settledSession, notice } = settled({
      seed,
      actions: [],
      state: engine.init(seed),
      undoable: false,
      log: [],
    });
    session = settledSession;
    rollPool = null;
    persist(session);
    sheet.close();
    render(notice);
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
    const folderInput = h("input", {
      attrs: { type: "file", webkitdirectory: "", multiple: "", hidden: "" },
    });
    folderInput.addEventListener("change", () => {
      const files = [...(folderInput.files ?? [])].filter((file) =>
        file.name.toLowerCase().endsWith(".json"),
      );
      if (files.length === 0) return;
      showLoading();
      void Promise.all(files.map((file) => file.text())).then(useFolderLibrary);
    });
    endPlayback();
    sheet.open("Menu", [
      h("p", { text: `${pack.meta.name} ${pack.meta.version}` }),
      h("p", { className: "muted", text: `Engine ${ENGINE_VERSION}` }),
      ...message.map((line) => h("p", { className: "sheet-error", text: line })),
      renderAddOnList(),
      renderSettings(),
      h("div", { className: "actions" }, [
        h("button", { className: "action", text: "New game", onClick: confirmNewGame }),
        h("button", {
          className: "action",
          text: "Load core or add-on file",
          onClick: () => fileInput.click(),
        }),
        h("button", {
          className: "action",
          text: "Load all packs from a folder",
          onClick: () => (folderSupported() ? void loadAllFromFolder() : folderInput.click()),
        }),
        ...folderButtons(),
        active.fromFile
          ? h("button", { className: "action", text: "Use demo core", onClick: useDemoCore })
          : null,
      ]),
      folder === null ? null : h("p", { className: "muted", text: `Packs folder: ${folder.name}` }),
      fileInput,
      folderInput,
    ]);
  }

  function showLoading(): void {
    sheet.open("Loading packs…", [
      h("p", { className: "muted", text: "Reading and checking the files." }),
    ]);
  }

  /** Reads every pack in the remembered folder (or one the player picks) and uses them all. */
  async function loadAllFromFolder(): Promise<void> {
    let chosen: FileSystemDirectoryHandle;
    try {
      chosen = folder ?? (await chooseFolder());
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
    showLoading();
    await useFolderLibrary(await readJsonTexts(chosen));
  }

  async function useFolderLibrary(texts: readonly string[]): Promise<void> {
    const found = libraryFromFolder(texts);
    if (!found.ok) {
      openMenu(found.error);
      return;
    }
    if (!(await library.save(found.value))) {
      openMenu(["The browser could not store the packs."]);
      return;
    }
    location.reload();
  }

  function changeSettings(changed: Partial<Settings>): void {
    settings = { ...settings, ...changed };
    saveSettings(localStorage, settings);
    openMenu();
  }

  /** The menu's settings: whether automatic steps play out, and how long their notes stay up. */
  function renderSettings(): HTMLElement {
    const on = settings.showAutomaticSteps;
    const sample = readingMilliseconds(SAMPLE_NOTE, readingFactor(settings.readingSpeed));
    return h("section", { className: "settings" }, [
      h("h3", { text: "Settings" }),
      h("button", {
        className: "action action-pass",
        text: on ? "Show automatic steps: on" : "Show automatic steps: off",
        attrs: { "aria-pressed": String(on) },
        onClick: () => changeSettings({ showAutomaticSteps: !on }),
      }),
      h("p", { className: "settings-label", text: "Reading speed of step notes" }),
      h(
        "div",
        { className: "choice-row", attrs: { role: "group", "aria-label": "Reading speed" } },
        READING_SPEEDS.map((speed) => {
          const button = h("button", {
            className: "choice",
            text: speed.label,
            attrs: { "aria-pressed": String(speed.id === settings.readingSpeed) },
            onClick: () => changeSettings({ readingSpeed: speed.id }),
          });
          button.disabled = !on;
          return button;
        }),
      ),
      h("p", {
        className: "muted",
        text: `A two-line note stays about ${(sample / 1000).toFixed(1)} s.`,
      }),
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
      library.current.core,
      library.current.addOns,
      await readJsonTexts(chosen),
    );
    const stored = await library.save({ core: refreshed.core, addOns: refreshed.addOns });
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
    const { current } = library;
    const stored = await library.save(
      parsed.value.type === "core"
        ? { ...current, core: text }
        : { ...current, addOns: withAddOn(current.addOns, text, parsed.value.addOn) },
    );
    if (!stored) {
      openMenu(["The file is too large for this browser to remember."]);
      return;
    }
    location.reload();
  }

  function removeAddOn(id: string): void {
    const { current } = library;
    void library
      .save({ ...current, addOns: withoutAddOn(current.addOns, id) })
      .then(() => location.reload());
  }

  function useDemoCore(): void {
    void library.save({ ...library.current, core: null }).then(() => location.reload());
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
        const { settledSession, notice } = settled({
          seed,
          actions,
          state: replayed.value.state,
          undoable: canUndo(engine, seed, actions),
          log: withEntry(replayed.value.log, { title: "Game resumed", lines: [] }),
        });
        session = settledSession;
        rollPool = null;
        if (session.actions.length !== actions.length) persist(session);
        render(notice === "" ? active.notice : notice);
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

  const decisionWatch = new ResizeObserver(() => {
    document.documentElement.style.setProperty(
      "--decision-height",
      `${decisionBar.offsetHeight}px`,
    );
  });
  decisionWatch.observe(decisionBar);
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

function storedCore(library: LibrarySnapshot): { core: Pack | null; notices: string[] } {
  const stored = library.core;
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

function chooseGame(library: LibrarySnapshot): ActivePack | null {
  const demo = parsePack(demoPackData);
  if (!demo.ok) {
    console.error("Demo pack is invalid", demo.error);
    return null;
  }
  const { core, notices } = storedCore(library);
  const texts = library.addOns;
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

/** The stored library; one an older version kept in localStorage is moved to the database first. */
async function openLibrary(): Promise<Library> {
  const database = new IndexedDbLibraryStore();
  const legacyStore = new LocalStorageLibraryStore(PACK_KEY, ADD_ONS_KEY, localStorage);
  const legacy = { core: legacyStore.loadCore(), addOns: legacyStore.loadAddOns() };
  const { library, migrate } = migrateLibrary(await database.load(), legacy);
  if (migrate && (await database.save(library))) legacyStore.clear();
  const current = library;
  return { current, save: (next) => database.save(next) };
}

async function boot(): Promise<void> {
  const notice = requireElement("notice", HTMLParagraphElement);
  notice.textContent = "Loading packs…";
  notice.hidden = false;
  const library = await openLibrary();
  const active = chooseGame(library.current);
  notice.hidden = true;
  if (active === null) return;
  start(
    active,
    library,
    createEngine(active.pack),
    new LocalStorageSaveStore(SAVE_KEY_PREFIX + active.pack.meta.id, localStorage),
  );
}

void boot();
