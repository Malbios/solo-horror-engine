import { describe, expect, it } from "vitest";
import { next, nextInt, seedRng, shuffle, type Rng } from "../src/core";

function take(rng: Rng, count: number): number[] {
  const values: number[] = [];
  let current = rng;
  for (let i = 0; i < count; i++) {
    const [value, advanced] = next(current);
    values.push(value);
    current = advanced;
  }
  return values;
}

describe("rng", () => {
  it("produces the same sequence for the same seed", () => {
    expect(take(seedRng(42), 20)).toEqual(take(seedRng(42), 20));
  });

  it("produces different sequences for different seeds", () => {
    expect(take(seedRng(1), 20)).not.toEqual(take(seedRng(2), 20));
  });

  it("returns floats in [0, 1)", () => {
    for (const value of take(seedRng(7), 1000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("does not mutate the input state", () => {
    const rng = Object.freeze(seedRng(3));
    const copy = { ...rng };
    next(rng);
    expect(rng).toEqual(copy);
  });

  it("keeps nextInt within bounds", () => {
    let rng = seedRng(9);
    for (let i = 0; i < 1000; i++) {
      const [value, advanced] = nextInt(rng, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      rng = advanced;
    }
  });

  it("rejects invalid bounds", () => {
    expect(() => nextInt(seedRng(1), 0)).toThrow(RangeError);
    expect(() => nextInt(seedRng(1), 1.5)).toThrow(RangeError);
  });

  it("shuffles deterministically into a permutation without mutating input", () => {
    const items = Object.freeze(["a", "b", "c", "d", "e", "f"]);
    const [first] = shuffle(seedRng(5), items);
    const [second] = shuffle(seedRng(5), items);
    expect(first).toEqual(second);
    expect([...first].sort()).toEqual([...items].sort());
  });

  it("keeps state JSON-serialisable", () => {
    const rng = seedRng(11);
    const restored = JSON.parse(JSON.stringify(rng)) as Rng;
    expect(take(restored, 5)).toEqual(take(rng, 5));
  });
});
