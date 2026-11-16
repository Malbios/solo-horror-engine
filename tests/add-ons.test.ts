import { describe, expect, it } from "vitest";
import { combineAddOns, parseAddOn } from "../src/content";
import { createEngine, type AddOn, type Pack } from "../src/core";
import { act, buildPack } from "./helpers";

const META = { schemaVersion: 2, version: "1.0.0" };

const core = buildPack({
  meta: { ...META, id: "table", name: "Table" },
  base: {
    counters: [{ id: "score", start: 0 }],
    zones: [{ id: "pool" }, { id: "deck" }],
    procedures: [{ id: "rival-turn", params: [], effects: [] }],
    setupEnd: [{ type: "moveCards", from: "pool", to: "deck", count: { zoneCount: "pool" } }],
    phases: [
      {
        id: "turn",
        steps: [
          {
            id: "turn",
            effects: [
              { type: "call", procedure: "rival-turn", args: {} },
              { type: "choose", options: [{ id: "continue", label: "Continue" }] },
            ],
          },
        ],
      },
    ],
  },
  choices: [
    { id: "rival", kind: "rival", min: 1, max: 1 },
    { id: "place", kind: "place", min: 1, max: 1 },
  ],
});

function addOn(input: object): AddOn {
  const parsed = parseAddOn(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error.issues));
  return parsed.value;
}

const rival = (id: string, points: number, version = "1.0.0") =>
  addOn({
    meta: { ...META, version, id, name: id, core: "table" },
    module: {
      id,
      kind: "rival",
      precedence: 1,
      content: {
        cards: [{ id: `${id}-card`, name: `${id} card` }],
        setup: [{ type: "createCards", card: `${id}-card`, zone: "pool" }],
        procedures: [
          {
            id: "rival-turn",
            params: [],
            effects: [{ type: "changeCounter", counter: "score", amount: points }],
          },
        ],
      },
    },
  });

const garden = addOn({
  meta: { ...META, id: "garden", name: "Garden", core: "table" },
  module: { id: "garden", kind: "place", precedence: 1, content: {} },
});

function combined(addOns: AddOn[]): Pack {
  const result = combineAddOns(core, addOns);
  if (!result.ok) throw new Error(result.error.join("; "));
  return result.value;
}

const issuesOf = (addOns: AddOn[]) => {
  const result = combineAddOns(core, addOns);
  return result.ok ? [] : result.error;
};

describe("core and add-ons", () => {
  it("offers every loaded add-on of a kind and plays the chosen one", () => {
    const engine = createEngine(combined([rival("fox", 1), rival("owl", 2), garden]));
    let state = engine.init(1);
    expect(state.pending).toEqual({
      kind: "pickModule",
      choice: "rival",
      options: ["fox", "owl"],
      canPass: false,
    });
    state = act(engine, state, { type: "pickModule", module: "owl" });
    state = act(engine, state, { type: "pickModule", module: "garden" });
    expect(state.counters["score"]).toBe(2);
  });

  it("runs the end of setup after every module's setup", () => {
    const engine = createEngine(combined([rival("fox", 1), garden]));
    let state = act(engine, engine.init(1), { type: "pickModule", module: "fox" });
    state = act(engine, state, { type: "pickModule", module: "garden" });
    expect(state.zones["pool"]).toEqual([]);
    expect(state.zones["deck"]).toEqual(["fox-card:1"]);
  });

  it("rejects an add-on made for another core", () => {
    const stray = addOn({
      meta: { ...META, id: "stray", name: "Stray", core: "elsewhere" },
      module: { id: "stray", kind: "rival", precedence: 1, content: {} },
    });
    expect(issuesOf([stray, garden])).toEqual([
      'add-on "stray" extends core "elsewhere", not "table"',
    ]);
  });

  it("reports a kind that no loaded add-on provides", () => {
    expect(issuesOf([garden])).toContain('choice "rival" needs at least 1 of kind "rival"');
  });

  it("checks references across the core and its add-ons", () => {
    const broken = addOn({
      meta: { ...META, id: "broken", name: "Broken", core: "table" },
      module: {
        id: "broken",
        kind: "rival",
        precedence: 1,
        content: { setup: [{ type: "changeCounter", counter: "missing", amount: 1 }] },
      },
    });
    expect(issuesOf([broken, garden])).toContain('undefined counter "missing"');
  });

  it("rejects the same add-on twice and repeated module ids", () => {
    expect(issuesOf([rival("fox", 1), rival("fox", 1), garden])).toEqual([
      'add-on "fox" is loaded twice',
    ]);
    const twin = addOn({
      meta: { ...META, id: "twin", name: "Twin", core: "table" },
      module: { id: "fox", kind: "rival", precedence: 1, content: {} },
    });
    expect(issuesOf([rival("fox", 1), twin, garden])).toContain('duplicate module "fox"');
  });

  it("changes the combined version when any add-on changes", () => {
    const before = combined([rival("fox", 1), garden]).meta.version;
    const after = combined([garden, rival("fox", 1, "1.0.1")]).meta.version;
    expect(before).toBe("1.0.0+fox@1.0.0+garden@1.0.0");
    expect(after).not.toBe(before);
  });

  it("names each add-on module after its file unless the module has a name", () => {
    const named = addOn({
      meta: { ...META, id: "pond", name: "Pond file", core: "table" },
      module: { id: "pond", name: "The Pond", kind: "place", precedence: 1, content: {} },
    });
    const pack = combined([rival("fox", 1), garden, named]);
    expect(pack.modules.map((module) => module.name)).toEqual(["fox", "Garden", "The Pond"]);
  });

  it("accepts an add-on alone even when it refers to the core", () => {
    expect(parseAddOn({ ...rival("fox", 1), extra: true }).ok).toBe(false);
    expect(rival("fox", 1).module.id).toBe("fox");
  });
});
