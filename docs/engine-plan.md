# Engine plan

Generic engine design. Implementation follows the roadmap at the end.

## Principles

- The engine is a library of pure functions. `createEngine(pack)` returns `init`, `step` and `legalActions`. Beside these, the engine exports pure projections: `view(state)`, `viewEvents(events, stateBefore)` and a projected `legalActions`. The UI only ever uses the projections. This is a display discipline, not a security boundary: the client holds the full state and the log.
- The action log (seed plus actions) is the only persisted truth. Replay folds `step` over the log. Undo replays all but the last action, and is limited by the undo rule under Decisions.
- `GameState` holds everything needed to continue: the pending decision, the resolution stack, all counters and zones. It is plain JSON.
- Packs are JSON data, never code. Everything a pack can express goes through the primitives below.
- Packs may carry optional display data (names, card text, images, board layouts with space positions). Only the UI reads it; rules never depend on it.
- Every primitive is exercised by an invented fixture pack in `tests/` or by `content/demo`. A primitive without a fixture does not ship.

## Primitives

Each entry ends with the invented fixture that tests it.

1. **Decision loop.** After `init` and every successful `step`, the game is either finished or waiting on exactly one pending decision with at least one option. A choice with zero options never becomes a decision (the relevant empty-set policy applies instead). A choice with exactly one option is always presented and logged, never auto-resolved, so that hidden information is not revealed by its absence. Choices that would explode combinatorially (orderings, choose N of M, splitting a quantity) become a sequence of single picks. Optional choices include an explicit pass. Opportunistic actions are offered only inside pack-defined windows. _Fixture: ordering three cards as three single picks._

2. **Setup as decisions.** Choosing modules and options happens through the first decisions in the log. `init` consumes no randomness until composition is complete, so shuffles do not depend on choices not yet made. State stores only the chosen module ids. The effective rule set is a pure function of pack and choices, derived and cached outside `GameState`. Saves add a pack content hash. _Fixture: a pack with two optional modules, replayed from the log._

3. **Effects, triggers and events.** An effect is a typed JSON operation. Before it applies, it is a pending effect that triggers and modifiers may react to. After it applies, the engine emits a `GameEvent` describing what happened. Events are output only; nothing reads them back. Triggers are pack rules of the form "when a pending or applied effect matches a pattern, push these effects". _Fixture: a trigger on "counter A increased" that increases counter B._

4. **Expressions.** A JSON expression language for predicates, selectors, amounts and sort keys: comparisons, counts, sums, min and max, references to counters and unit attributes, and boolean logic. No user-defined functions, loops or self-reference; nesting depth is bounded; numbers are integers. Every reference is checked in `parsePack`. Evaluation is total: aggregates over an empty set have defined results, and an unreachable distance follows the query's empty-set policy (13). _Fixture: an amount equal to "cards in zone X, minimum 1"._

5. **Resolution stack.** Resolution runs on a stack of plain-JSON frames. Triggered work is pushed above pending work. Each frame carries a scope, and a scoped exit unwinds to the matching frame. Movement resolves one step per frame, so interrupts and checks can happen between steps. A per-step resolution cap stops runaway pack data with an `engineFault` result: state is unchanged, nothing is logged, and the fault is reported as a pack bug rather than a rule error. _Fixture: a trigger chain that resolves before the remaining queued effect._

6. **Scopes.** Packs define nested scopes (for example game, round, phase, step). Each scope has enter and exit hooks. _Fixture: a hook that runs when a phase is cut short._

7. **Counters.** One primitive for every number: an owner (global, space, unit or card), optional bounds, threshold triggers, overflow and underflow effects, and an optional reset scope. The counter declares its reset scope and the scope's exit performs the reset; resets cannot be intercepted by modifiers. Fired-once flags and per-scope accumulators are counters. Unit attributes are counters too. _Fixture: a counter with a maximum of 7 whose overflow increments a second counter._

8. **State-based checks.** After each frame is popped, pack-ordered checks run, repeating until nothing changes (bounded by the same cap as 5): removal predicates, threshold promotions, win and loss predicates. Simultaneous results are ordered per Ordering (14). A win and a loss firing together are always ordered by the pack, never by a decision. _Fixture: two units reaching zero at the same time._

9. **Modifiers.** Replacement modifiers act on pending effects in pack priority order, with ties per Ordering (14): prevent, reduce, convert or substitute. Continuous modifiers change counter values or rules for a scope duration. _Fixture: a modifier that reduces each incoming quantity by one for one round._

10. **Typed quantities.** Quantities carry a type, and effects route each type to a different counter. _Fixture: two quantity types routed to two different counters._

11. **Costs.** Effects and edges may require payment from counters or by discarding cards. Payability, after modifiers, is checked before an option is listed, so every listed option can be paid. Pass means declining an optional effect; committed costs have no pass. _Fixture: an option that disappears when its cost cannot be paid._

12. **Units.** A unit has an id, a kind, attributes (counters) and a location. New ids come from a counter in state. Changing a unit's kind keeps its id; removing a unit retires its id permanently. A unit's location is one of: on a space, inside another unit, or off the map. Units inside another unit move with it. Selectors whose referent has no location use a pack-defined fallback: a substitute location, or skip. _Fixture: a container moved with one unit inside._

13. **Map and graph queries.** Spaces have stable ids and tags. Effects may add, remove or retarget edges at runtime. Edges may be directed and carry tags and gates. Distance, reachability and paths are queries; each names a pack-defined edge filter, evaluated at query time (gates included), and has an empty-set policy. Moves respect the filter; placements ignore it. _Fixture: one edge retargeted to a different space, changing a distance._

14. **Ordering.** One rule for every tie and iteration: a pack sort-key list, then either a decision or a seeded random pick, as the pack says per use, with equal options deduplicated as seen in the view. Where no choice is allowed, stable id order. Iteration over a group keeps its position when units are added or removed during the iteration. _Fixture: three units tied on a sort key, broken by a decision._

15. **Random selection.** Compute the eligible set first, then make one seeded draw over it, keeping relative weights. Lookup tables map dice results to selectors. A pack-defined outcome applies when the eligible set is empty. _Fixture: a six-entry table with two ineligible entries, resolved with one draw over the remaining four._

16. **Dice.** Pools whose size comes from expressions, custom face tables, rerolls, and modifiers that may change the pool's contents. Dice have stable ids within a roll. Assigning dice to roles is a decision. _Fixture: two dice assigned to two roles._

17. **Cards and zones.** Zones hold ordered cards with a face state. Operations: draw, insert at a position, shuffle, peek, and move between zones at scope hooks. _Fixture: a discard zone emptied back into a draw zone at a scope exit._

18. **Modules and layering.** Modules have a pack-defined kind and a total precedence order. Later layers patch earlier ones by stable id (effect data, not text) when the rule set is composed, never at draw time. Unresolved conflicts are `parsePack` errors. _Fixture: a module that replaces one card of another module by id._

19. **Hidden information.** Hidden values (face-down cards, unrevealed values, hidden orders) are fixed when they are created, after composition, so randomness is consumed in a stable order. Hidden objects are addressed by opaque handles, minted when hidden and re-minted on shuffle, never by their definition id. `view`, projected events, projected `legalActions` and `RuleError` payloads expose only handles and revealed facts. Facts the player has learned (a peeked card) are stored in state as per-object flags; only deductions from them are derived. _Fixture: a face-down card whose definition id never appears in the view, the events or the options._

20. **End sequences.** Win and loss are predicates checked as state-based checks. A pack may define an end sequence (a scored pass over zones or counters) that runs when a predicate fires. The finished state carries an `outcome`. _Fixture: a game that ends when a zone empties and scores two counters._

21. **Procedures.** Packs define named effect lists with numeric parameters. An effect calls one with argument expressions, evaluated in the caller's context; inside, `{ arg }` reads them, and the caller's unit and amount pass through. Every call passes exactly the declared parameters, arguments are read only inside the procedure that declares them, and procedures never call themselves directly or indirectly. Modules patch procedures by id. _Fixture: two cards calling one procedure with different arguments._

## Decisions

- **Undo stops at hidden information.** Undo is not allowed past any action whose resolution revealed something the player did not know before: a peek, a card or value turning face up, a die roll, a shuffle, or any other seeded random result. The engine marks such actions in the log as undo barriers; undo can only remove actions after the last barrier.

## Roadmap

1. Decision loop, setup as decisions, effects and triggers, expressions, resolution stack, scopes, counters, state checks, modules and layering, cards and zones, end sequences.
2. Units, map and graph queries, stepwise movement.
3. Ordering, typed quantities, modifiers, costs.
4. Dice and random selection.
5. Hidden information, projections, and undo barriers.
6. UI, following the platform constraints in CLAUDE.md.
7. Loading packs at runtime from a file.
8. Procedures.
