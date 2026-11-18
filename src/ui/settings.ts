const SETTINGS_KEY = "solo-horror-engine:settings";
/** Where the "show automatic steps" switch was kept before there were settings. */
const LEGACY_PLAYBACK_KEY = "solo-horror-engine:playback";

export const READING_SPEEDS = [
  { id: "very-slow", label: "Very slow", factor: 1.7 },
  { id: "slow", label: "Slow", factor: 1.35 },
  { id: "normal", label: "Normal", factor: 1 },
  { id: "fast", label: "Fast", factor: 0.75 },
  { id: "very-fast", label: "Very fast", factor: 0.5 },
] as const;

export type ReadingSpeed = (typeof READING_SPEEDS)[number]["id"];

export type Settings = { showAutomaticSteps: boolean; readingSpeed: ReadingSpeed };

export const DEFAULT_SETTINGS: Settings = { showAutomaticSteps: true, readingSpeed: "normal" };

export function readingFactor(speed: ReadingSpeed): number {
  return READING_SPEEDS.find((entry) => entry.id === speed)?.factor ?? 1;
}

function isReadingSpeed(value: unknown): value is ReadingSpeed {
  return READING_SPEEDS.some((entry) => entry.id === value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Stored settings, falling back to the defaults (and to the older switch) for anything missing. */
export function parseSettings(text: string | null, legacyPlayback: string | null): Settings {
  const fallback: Settings = { ...DEFAULT_SETTINGS, showAutomaticSteps: legacyPlayback !== "off" };
  const data = text === null ? null : parseJson(text);
  if (typeof data !== "object" || data === null) return fallback;
  const stored = data as Record<string, unknown>;
  return {
    showAutomaticSteps:
      typeof stored["showAutomaticSteps"] === "boolean"
        ? stored["showAutomaticSteps"]
        : fallback.showAutomaticSteps,
    readingSpeed: isReadingSpeed(stored["readingSpeed"])
      ? stored["readingSpeed"]
      : fallback.readingSpeed,
  };
}

export function loadSettings(storage: Storage): Settings {
  try {
    return parseSettings(storage.getItem(SETTINGS_KEY), storage.getItem(LEGACY_PLAYBACK_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(storage: Storage, settings: Settings): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not remembered: the settings hold until the page reloads.
  }
}
