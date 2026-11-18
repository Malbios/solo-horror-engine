import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, readingFactor } from "../src/ui/settings";

describe("parseSettings", () => {
  it("falls back to the defaults for missing or broken data", () => {
    expect(parseSettings(null, null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{not json", null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ readingSpeed: "warp" }), null)).toEqual(DEFAULT_SETTINGS);
  });

  it("reads a stored reading speed and switch", () => {
    const stored = JSON.stringify({ showAutomaticSteps: false, readingSpeed: "slow" });
    expect(parseSettings(stored, null)).toEqual({
      showAutomaticSteps: false,
      readingSpeed: "slow",
    });
  });

  it("keeps the older switch turned off until settings are stored", () => {
    expect(parseSettings(null, "off").showAutomaticSteps).toBe(false);
    const stored = JSON.stringify({ showAutomaticSteps: true, readingSpeed: "normal" });
    expect(parseSettings(stored, "off").showAutomaticSteps).toBe(true);
  });
});

describe("readingFactor", () => {
  it("is 1 for the normal speed, above 1 when slower and below 1 when faster", () => {
    expect(readingFactor("normal")).toBe(1);
    expect(readingFactor("slow")).toBeGreaterThan(1);
    expect(readingFactor("fast")).toBeLessThan(1);
  });
});
