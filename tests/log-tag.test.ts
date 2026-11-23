import { describe, expect, it } from "vitest";
import { tagClearance } from "../src/ui/log-tag";

describe("tagClearance", () => {
  it("is 0 without scrollbars", () => {
    expect(tagClearance(1000, [])).toBe(0);
    expect(tagClearance(1000, [{ right: 1000, width: 0 }])).toBe(0);
    expect(tagClearance(1000, [{ right: 900, width: 0 }])).toBe(0);
  });

  it("clears a scrollbar at the viewport's edge by its width", () => {
    expect(tagClearance(1000, [{ right: 1000, width: 15 }])).toBe(15);
  });

  it("clears a scrollbar inside a column away from the edge, and the widest of several", () => {
    expect(tagClearance(1000, [{ right: 984, width: 15 }])).toBe(31);
    expect(
      tagClearance(1000, [
        { right: 1000, width: 0 },
        { right: 984, width: 15 },
        { right: 1000, width: 10 },
      ]),
    ).toBe(31);
  });
});
