import { describe, expect, it } from "vitest";
import { createEngine, view, type GameEvent } from "../src/core";
import { createLabels, describeEvent, displayRules } from "../src/ui/labels";
import { withoutSilentTriggers } from "../src/ui/playback";
import { fixturePack } from "./helpers";

const change = (counter: string, amount: number) => ({ type: "changeCounter", counter, amount });
const sheep = (id: string) => ({
  type: "createUnit",
  kind: "sheep",
  id,
  placement: { onSpace: { space: "field" } },
});

// Choosing "go" changes "lamps" and removes every sheep; triggers react to both.
function pack() {
  return fixturePack({
    spaces: [{ id: "field", name: "Field" }],
    unitKinds: [{ id: "sheep", name: "Sheep" }],
    counters: ["lamps", "oil", "dust", "herds"].map((id) => ({ id, start: 0 })),
    triggers: [
      {
        id: "lantern",
        name: "Lantern rule",
        on: { event: "counterChanged", counter: "lamps" },
        effects: [change("oil", 1), change("oil", 1)],
      },
      {
        id: "quiet",
        on: { event: "counterChanged", counter: "lamps" },
        effects: [change("dust", 1)],
      },
      { id: "nothing", on: { event: "counterChanged", counter: "lamps" }, effects: [] },
      {
        id: "herd",
        name: "Herd rule",
        perGroup: true,
        on: { event: "unitRemoved", kind: "sheep" },
        effects: [change("herds", 1)],
      },
    ],
    setup: [sheep("s1"), sheep("s2")],
    phases: [
      {
        id: "turn",
        steps: [
          {
            id: "act",
            effects: [
              {
                type: "choose",
                options: [
                  {
                    id: "go",
                    label: "Go",
                    effects: [
                      change("lamps", 1),
                      {
                        type: "forEachUnit",
                        units: { kind: "sheep", at: null },
                        effects: [{ type: "removeUnit", unit: "self" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

function go() {
  const engine = createEngine(pack());
  const outcome = engine.step(engine.init(1), { type: "chooseOption", option: "go" });
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.error));
  return outcome.value;
}

const counterOf = (event: GameEvent) => (event.type === "counterChanged" ? event.counter : null);

describe("triggerFired", () => {
  it("comes right before the events of the trigger's effects, once per firing", () => {
    const { events } = go();
    const fired = events.flatMap((event, index) =>
      event.type === "triggerFired" ? [{ trigger: event.trigger, next: events[index + 1] }] : [],
    );
    expect(fired.map(({ trigger }) => trigger).sort()).toEqual(["herd", "lantern", "quiet"]);
    const after = Object.fromEntries(fired.map(({ trigger, next }) => [trigger, next]));
    expect(counterOf(after["lantern"] as GameEvent)).toBe("oil");
    expect(counterOf(after["quiet"] as GameEvent)).toBe("dust");
    expect(counterOf(after["herd"] as GameEvent)).toBe("herds");
  });

  it("says when a trigger's effects are done, after all of them", () => {
    const { events } = go();
    const doneAt = events.findIndex(
      (event) => event.type === "triggerDone" && event.trigger === "lantern",
    );
    const oil = events.flatMap((event, index) => (counterOf(event) === "oil" ? [index] : []));
    expect(oil).toHaveLength(2);
    expect(doneAt).toBeGreaterThan(Math.max(...oil));
    const done = events
      .filter((event) => event.type === "triggerDone")
      .map((event) => event.trigger);
    expect(done.sort()).toEqual(["herd", "lantern", "quiet"]);
  });

  it("names a named trigger and says nothing for an unnamed one", () => {
    const { state, events } = go();
    const shown = view(state);
    const labels = createLabels(displayRules(pack(), shown.modules), shown);
    const lines = events
      .filter((event) => event.type === "triggerFired")
      .map((event) => describeEvent(event, shown, labels));
    expect(lines.filter((line) => line !== null).sort()).toEqual([
      "Herd rule takes effect",
      "Lantern rule takes effect",
    ]);
    expect(lines).toContain(null);
  });
});

describe("withoutSilentTriggers", () => {
  const fired = (trigger: string): GameEvent => ({ type: "triggerFired", trigger });
  const done = (trigger: string): GameEvent => ({ type: "triggerDone", trigger });
  const counter = (id: string): GameEvent => ({
    type: "counterChanged",
    counter: id,
    from: 0,
    to: 1,
  });
  // Only "seen" changes are described.
  const describe = (event: GameEvent) =>
    event.type === "counterChanged" && event.counter === "seen" ? "seen" : null;

  it("keeps a trigger whose effects show something, and drops every done event", () => {
    expect(withoutSilentTriggers([fired("a"), counter("seen"), done("a")], describe)).toEqual([
      fired("a"),
      counter("seen"),
    ]);
  });

  it("drops a trigger whose effects show nothing, but keeps those effects", () => {
    expect(
      withoutSilentTriggers([fired("a"), counter("quiet"), done("a"), counter("seen")], describe),
    ).toEqual([counter("quiet"), counter("seen")]);
  });

  it("keeps an outer trigger when only a nested one shows something", () => {
    const events = [fired("a"), fired("b"), counter("seen"), done("b"), done("a")];
    expect(withoutSilentTriggers(events, describe)).toEqual([
      fired("a"),
      fired("b"),
      counter("seen"),
    ]);
    const quietInner = [
      fired("a"),
      fired("b"),
      counter("quiet"),
      done("b"),
      counter("seen"),
      done("a"),
    ];
    expect(withoutSilentTriggers(quietInner, describe)).toEqual([
      fired("a"),
      counter("quiet"),
      counter("seen"),
    ]);
  });

  it("keeps a trigger still running when the step ends (it waits on a decision)", () => {
    expect(withoutSilentTriggers([fired("a"), counter("quiet")], describe)).toEqual([
      fired("a"),
      counter("quiet"),
    ]);
  });
});
