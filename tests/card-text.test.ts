import { describe, expect, it } from "vitest";
import { textParts } from "../src/ui/sheet";

describe("textParts", () => {
  it("keeps a plain text as one part without a heading", () => {
    expect(textParts("Gain 1 score.")).toEqual([{ heading: null, body: "Gain 1 score." }]);
  });

  it("splits at blank lines and heads a part of several lines with its first line", () => {
    const text = "Only at night.\n\nLucky:\nGain 2 score.\n\nUnlucky:\nLose 1 score.\nDraw 1 card.";
    expect(textParts(text)).toEqual([
      { heading: null, body: "Only at night." },
      { heading: "Lucky:", body: "Gain 2 score." },
      { heading: "Unlucky:", body: "Lose 1 score.\nDraw 1 card." },
    ]);
  });

  it("ignores extra blank lines and spaces around parts", () => {
    expect(textParts("\n\nFirst.\n \n\n  Second.  \n\n")).toEqual([
      { heading: null, body: "First." },
      { heading: null, body: "Second." },
    ]);
    expect(textParts("First.\n  \nSecond.")).toHaveLength(2);
  });
});
