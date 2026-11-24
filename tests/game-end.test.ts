import { describe, expect, it } from "vitest";
import { createEngine, view } from "../src/core";
import { createLabels, describeEvent, describeOutcome, displayRules } from "../src/ui/labels";
import { fixturePack, PAUSE_PHASE } from "./helpers";

const ALWAYS = { gte: [{ counter: "x" }, 1] };

function ended(endCondition: Record<string, unknown>) {
  const pack = fixturePack({
    counters: [{ id: "x", start: 1 }],
    unitKinds: [
      { id: "walker", name: "Wanderer" },
      { id: "lurker", name: "Shade" },
    ],
    endConditions: [{ id: "over", condition: ALWAYS, ...endCondition }],
    phases: [PAUSE_PHASE],
  });
  const shown = view(createEngine(pack).init(1));
  return { shown, labels: createLabels(displayRules(pack, shown.modules), shown) };
}

describe("describeOutcome", () => {
  it.each([
    ["win", "You won!"],
    ["loss", "You lost"],
  ])("titles a %s without words of the pack's own", (outcome, title) => {
    const { shown, labels } = ended({ outcome });
    expect(describeOutcome(shown, labels)).toEqual({ result: outcome, title, text: null });
  });

  it("uses the pack's title and fills unit kind names into its text", () => {
    const { shown, labels } = ended({
      outcome: "win",
      title: "Dawn breaks",
      text: "{walker} outlasted {lurker} at {nowhere}.",
    });
    expect(describeOutcome(shown, labels)).toEqual({
      result: "win",
      title: "Dawn breaks",
      text: "Wanderer outlasted Shade at {nowhere}.",
    });
  });

  it("says nothing while the game goes on", () => {
    const pack = fixturePack({ phases: [PAUSE_PHASE] });
    const shown = view(createEngine(pack).init(1));
    expect(describeOutcome(shown, createLabels(displayRules(pack, shown.modules), shown))).toBe(
      null,
    );
  });

  it("logs the end by its title", () => {
    const { shown, labels } = ended({ outcome: "loss", title: "Dusk falls" });
    const line = describeEvent(
      { type: "gameFinished", outcome: "loss", endCondition: "over" },
      shown,
      labels,
    );
    expect(line).toBe("Dusk falls");
  });
});
