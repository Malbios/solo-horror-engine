import { z } from "zod";
import {
  findMissingReferences,
  LAYERED_COLLECTIONS,
  offeredModules,
  PACK_SCHEMA_VERSION,
  procedureIssues,
  type AddOn,
  type BoolExpr,
  type Content,
  type Counter,
  type Effect,
  type LayeredCollection,
  type Module,
  type NumExpr,
  type Pack,
  type SpaceRef,
  type UnitRef,
  type Zone,
} from "../core";

const MAX_PACK_DEPTH = 64;

const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "ids are lowercase kebab-case");
const nameSchema = z.string().min(1);
const scopeSchema = z.enum(["step", "phase", "round"]);
const outcomeSchema = z.enum(["win", "loss"]);

function hasUniqueIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

export const unitRefSchema: z.ZodType<UnitRef> = z.lazy(() =>
  z.union([
    z.literal("self"),
    z.strictObject({ id: idSchema }),
    z.strictObject({
      closest: z.strictObject({ kind: idSchema, origin: spaceRefSchema, filter: idSchema }),
    }),
  ]),
);

export const spaceRefSchema: z.ZodType<SpaceRef> = z.lazy(() =>
  z.union([
    z.literal("candidate"),
    z.strictObject({ space: idSchema }),
    z.strictObject({
      locationOf: unitRefSchema,
      fallback: spaceRefSchema.nullable().default(null),
    }),
  ]),
);

const placementSchema = z.union([
  z.strictObject({ onSpace: spaceRefSchema }),
  z.strictObject({ inside: unitRefSchema }),
  z.strictObject({ offMap: z.literal(true) }),
]);

export const numExprSchema: z.ZodType<NumExpr> = z.lazy(() => {
  const pair = z.tuple([numExprSchema, numExprSchema]);
  return z.union([
    z.strictObject({ attribute: idSchema, of: unitRefSchema }),
    z.strictObject({
      diceCount: z.strictObject({
        pool: idSchema,
        symbol: idSchema.nullable().default(null),
        role: idSchema.nullable().default(null),
      }),
    }),
    z.strictObject({ spaceCounter: idSchema, at: spaceRefSchema }),
    z.strictObject({
      countUnits: z.strictObject({
        kind: idSchema.nullable().default(null),
        at: spaceRefSchema.nullable().default(null),
      }),
    }),
    z.strictObject({
      countCards: z.strictObject({
        zone: idSchema,
        card: idSchema.nullable().default(null),
        tag: idSchema.nullable().default(null),
      }),
    }),
    z.strictObject({
      distance: z.strictObject({
        origin: spaceRefSchema,
        destination: spaceRefSchema,
        filter: idSchema,
        ifUnreachable: numExprSchema,
      }),
    }),
    z.int(),
    z.strictObject({ counter: idSchema }),
    z.strictObject({ zoneCount: idSchema }),
    z.strictObject({ context: z.enum(["from", "to", "amount"]) }),
    z.strictObject({ arg: idSchema }),
    z.strictObject({ add: z.array(numExprSchema) }),
    z.strictObject({ sub: pair }),
    z.strictObject({ mul: pair }),
    z.strictObject({ min: z.array(numExprSchema) }),
    z.strictObject({ max: z.array(numExprSchema) }),
  ]);
});

export const boolExprSchema: z.ZodType<BoolExpr> = z.lazy(() => {
  const pair = z.tuple([numExprSchema, numExprSchema]);
  return z.union([
    z.boolean(),
    z.strictObject({ unitExists: unitRefSchema }),
    z.strictObject({ spaceHasTag: z.strictObject({ at: spaceRefSchema, tag: idSchema }) }),
    z.strictObject({ unitIsKind: z.strictObject({ unit: unitRefSchema, kind: idSchema }) }),
    z.strictObject({ sameSpace: z.tuple([unitRefSchema, unitRefSchema]) }),
    z.strictObject({ eq: pair }),
    z.strictObject({ ne: pair }),
    z.strictObject({ lt: pair }),
    z.strictObject({ lte: pair }),
    z.strictObject({ gt: pair }),
    z.strictObject({ gte: pair }),
    z.strictObject({ and: z.array(boolExprSchema) }),
    z.strictObject({ or: z.array(boolExprSchema) }),
    z.strictObject({ not: boolExprSchema }),
  ]);
});

const costSchema = z.union([
  z.strictObject({
    counter: idSchema,
    amount: numExprSchema,
    floor: numExprSchema.nullable().default(null),
  }),
  z.strictObject({ attribute: idSchema, of: unitRefSchema, amount: numExprSchema }),
  z.strictObject({
    discard: z.strictObject({ from: idSchema, to: idSchema, count: numExprSchema }),
  }),
]);

const costListSchema = z.array(costSchema).default([]);

const tagListSchema = z.array(idSchema).default([]);

const cardFilterSchema = z.strictObject({
  requireTags: tagListSchema,
  excludeTags: tagListSchema,
});

const anyCardSchema = cardFilterSchema.default({ requireTags: [], excludeTags: [] });

const orderSchema = z.strictObject({
  sortBy: z
    .array(
      z.strictObject({ key: numExprSchema, direction: z.enum(["asc", "desc"]).default("asc") }),
    )
    .default([]),
  tieBreak: z.enum(["id", "random", "decision"]).default("id"),
});

const followersSchema = z
  .strictObject({
    units: z
      .strictObject({
        kind: idSchema.nullable().default(null),
        where: boolExprSchema.default(true),
      })
      .prefault({}),
    max: numExprSchema,
    when: boolExprSchema.default(true),
  })
  .nullable()
  .default(null);

const unitSetSchema = z.strictObject({
  kind: idSchema.nullable().default(null),
  at: spaceRefSchema.nullable().default(null),
  where: boolExprSchema.default(true),
});

export const effectSchema: z.ZodType<Effect> = z.lazy(() => {
  const effects = z.array(effectSchema).default([]);
  const option = z.strictObject({
    id: idSchema,
    label: nameSchema,
    when: boolExprSchema.default(true),
    cost: costListSchema,
    effects,
  });
  return z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("changeCounter"), counter: idSchema, amount: numExprSchema }),
    z.strictObject({ type: z.literal("setCounter"), counter: idSchema, value: numExprSchema }),
    z.strictObject({
      type: z.literal("moveCards"),
      from: idSchema,
      to: idSchema,
      count: numExprSchema,
      position: z.enum(["top", "bottom"]).default("top"),
    }),
    z.strictObject({ type: z.literal("createCards"), card: idSchema, zone: idSchema }),
    z.strictObject({ type: z.literal("shuffle"), zone: idSchema }),
    z.strictObject({ type: z.literal("peek"), zone: idSchema, count: numExprSchema.default(1) }),
    z.strictObject({
      type: z.literal("turnCards"),
      zone: idSchema,
      count: numExprSchema.default(1),
      face: z.enum(["up", "down"]),
    }),
    z.strictObject({
      type: z.literal("if"),
      condition: boolExprSchema,
      then: effects,
      else: effects,
    }),
    z.strictObject({
      type: z.literal("choose"),
      optional: z.boolean().default(false),
      options: z.array(option).min(1).refine(hasUniqueIds, "option ids must be unique"),
    }),
    z.strictObject({
      type: z.literal("playWindow"),
      play: z
        .strictObject({ from: idSchema, to: idSchema, cards: anyCardSchema })
        .nullable()
        .default(null),
      discard: z.strictObject({ from: idSchema, to: idSchema, effects }).nullable().default(null),
      buy: z
        .strictObject({
          from: idSchema,
          to: idSchema,
          cards: anyCardSchema,
          when: boolExprSchema.default(true),
          free: z.boolean().default(false),
        })
        .nullable()
        .default(null),
      abilitiesFrom: z.array(idSchema).default([]),
      repeat: z.boolean().default(true),
    }),
    z.strictObject({
      type: z.literal("resolveCard"),
      zone: idSchema,
      to: idSchema.nullable().default(null),
      ifEmpty: effects,
    }),
    z.strictObject({ type: z.literal("endScope"), scope: scopeSchema }),
    z.strictObject({ type: z.literal("endGame"), endCondition: idSchema }),
    z.strictObject({
      type: z.literal("createUnit"),
      kind: idSchema,
      id: idSchema.nullable().default(null),
      placement: placementSchema,
    }),
    z.strictObject({ type: z.literal("removeUnit"), unit: unitRefSchema }),
    z.strictObject({ type: z.literal("changeKind"), unit: unitRefSchema, kind: idSchema }),
    z.strictObject({
      type: z.literal("placeUnit"),
      unit: unitRefSchema,
      placement: placementSchema,
    }),
    z.strictObject({
      type: z.literal("moveToward"),
      unit: unitRefSchema,
      target: spaceRefSchema,
      steps: numExprSchema,
      filter: idSchema,
      stopWhen: boolExprSchema.default(false),
      order: orderSchema.prefault({}),
      followers: followersSchema,
    }),
    z.strictObject({
      type: z.literal("stepMove"),
      unit: unitRefSchema,
      steps: numExprSchema,
      filter: idSchema,
      followers: followersSchema,
      forced: z.boolean().default(false),
    }),
    z.strictObject({
      type: z.literal("changeAttribute"),
      unit: unitRefSchema,
      attribute: idSchema,
      amount: numExprSchema,
    }),
    z.strictObject({
      type: z.literal("setAttribute"),
      unit: unitRefSchema,
      attribute: idSchema,
      value: numExprSchema,
    }),
    z.strictObject({
      type: z.literal("changeSpaceCounter"),
      at: spaceRefSchema,
      spaceCounter: idSchema,
      amount: numExprSchema,
    }),
    z.strictObject({
      type: z.literal("setSpaceCounter"),
      at: spaceRefSchema,
      spaceCounter: idSchema,
      value: numExprSchema,
    }),
    z.strictObject({
      type: z.literal("forEachUnit"),
      units: unitSetSchema.prefault({}),
      order: orderSchema.prefault({}),
      effects,
    }),
    z.strictObject({
      type: z.literal("selectUnits"),
      units: unitSetSchema.prefault({}),
      order: orderSchema.prefault({}),
      count: numExprSchema.default(1),
      effects,
    }),
    z.strictObject({
      type: z.literal("rollDice"),
      pool: idSchema,
      die: idSchema,
      count: numExprSchema,
    }),
    z.strictObject({
      type: z.literal("addDice"),
      pool: idSchema,
      die: idSchema,
      count: numExprSchema,
    }),
    z.strictObject({
      type: z.literal("rerollDice"),
      pool: idSchema,
      faces: z.array(idSchema).nullable().default(null),
      mode: z.enum(["all", "choose"]).default("all"),
    }),
    z.strictObject({
      type: z.literal("setDieFace"),
      pool: idSchema,
      faces: z.array(idSchema).min(1),
      toFace: idSchema,
      count: numExprSchema.default(1),
    }),
    z.strictObject({
      type: z.literal("assignDice"),
      pool: idSchema,
      roles: z.array(z.strictObject({ role: idSchema, count: numExprSchema.default(1) })).min(1),
    }),
    z.strictObject({
      type: z.literal("lookup"),
      value: numExprSchema,
      entries: z
        .array(z.strictObject({ min: z.int(), max: z.int(), effects }))
        .refine(
          (entries) => entries.every((entry) => entry.min <= entry.max),
          "lookup entries need min <= max",
        ),
      otherwise: effects,
    }),
    z.strictObject({
      type: z.literal("randomTable"),
      entries: z
        .array(
          z.strictObject({
            id: idSchema,
            weight: numExprSchema.default(1),
            when: boolExprSchema.default(true),
            effects,
          }),
        )
        .min(1)
        .refine(hasUniqueIds, "table entry ids must be unique"),
      ifNone: effects,
    }),
    z.strictObject({
      type: z.literal("deliver"),
      quantity: idSchema,
      amount: numExprSchema,
      recipient: unitRefSchema.nullable().default(null),
    }),
    z.strictObject({ type: z.literal("addEdge"), edge: edgeSchema }),
    z.strictObject({ type: z.literal("removeEdge"), edge: idSchema }),
    z.strictObject({ type: z.literal("retargetEdge"), edge: idSchema, toSpace: idSchema }),
    z.strictObject({
      type: z.literal("call"),
      procedure: idSchema,
      args: z.record(idSchema, numExprSchema).default({}),
    }),
  ]);
});

const edgeSchema = z.strictObject({
  id: idSchema,
  fromSpace: idSchema,
  toSpace: idSchema,
  directed: z.boolean().default(false),
  tags: z.array(idSchema).default([]),
  fromTags: z.array(idSchema).default([]),
  toTags: z.array(idSchema).default([]),
  gate: boolExprSchema.default(true),
  cost: costListSchema,
});

const effectListSchema = z.array(effectSchema).default([]);
const optionalIdSchema = idSchema.nullable().default(null);

const eventPatternSchema = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("counterChanged"), counter: idSchema }),
  z.strictObject({ event: z.literal("cardsMoved"), from: optionalIdSchema, to: optionalIdSchema }),
  z.strictObject({ event: z.literal("scopeEntered"), scope: scopeSchema, id: optionalIdSchema }),
  z.strictObject({ event: z.literal("scopeExited"), scope: scopeSchema, id: optionalIdSchema }),
  z.strictObject({ event: z.literal("unitCreated"), kind: optionalIdSchema }),
  z.strictObject({ event: z.literal("unitRemoved"), kind: optionalIdSchema }),
  z.strictObject({
    event: z.literal("unitMoved"),
    kind: optionalIdSchema,
    toSpace: optionalIdSchema,
  }),
  z.strictObject({
    event: z.literal("attributeChanged"),
    kind: optionalIdSchema,
    attribute: idSchema,
  }),
  z.strictObject({ event: z.literal("spaceCounterChanged"), spaceCounter: idSchema }),
  z.strictObject({ event: z.literal("diceRolled"), pool: optionalIdSchema }),
  z.strictObject({
    event: z.literal("quantityDelivered"),
    quantity: idSchema,
    kind: optionalIdSchema,
  }),
]);

const percentSchema = z.number().min(0).max(100);

const spaceSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  tags: z.array(idSchema).default([]),
  position: z
    .strictObject({ board: idSchema, x: percentSchema, y: percentSchema })
    .nullable()
    .default(null),
});

const imageSchema = z.string().min(1).nullable().default(null);

const boardSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  image: imageSchema,
  aspect: z.number().positive().default(1),
});

const edgeFilterSchema = z.strictObject({
  id: idSchema,
  requireTags: z.array(idSchema).default([]),
  excludeTags: z.array(idSchema).default([]),
  useGates: z.boolean().default(true),
});

const hooksSchema = z.strictObject({ onEnter: effectListSchema, onExit: effectListSchema });

const counterSchema = z
  .strictObject({
    id: idSchema,
    name: nameSchema.optional(),
    start: z.int(),
    min: z.int().nullable().default(null),
    max: z.int().nullable().default(null),
    resetScope: scopeSchema.nullable().default(null),
    onOverflow: effectListSchema,
    onUnderflow: effectListSchema,
  })
  .refine(
    (counter) =>
      (counter.min === null || counter.min <= counter.start) &&
      (counter.max === null || counter.start <= counter.max),
    "counter must satisfy min <= start <= max",
  )
  .transform(({ name, ...counter }): Counter => ({ ...counter, name: name ?? counter.id }));

const zoneSchema = z
  .strictObject({
    id: idSchema,
    name: nameSchema.optional(),
    face: z.enum(["up", "down"]).default("up"),
    backEffects: effectListSchema,
  })
  .transform(({ name, ...zone }): Zone => ({ ...zone, name: name ?? zone.id }));

const abilitySchema = z.strictObject({
  id: idSchema,
  label: nameSchema,
  when: boolExprSchema.default(true),
  cost: costListSchema,
  effects: effectListSchema,
  limit: z
    .strictObject({ uses: z.int().min(1), per: z.enum(["step", "phase", "round", "game"]) })
    .nullable()
    .default(null),
});

const cardSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  text: z.string().default(""),
  image: imageSchema,
  copies: z.int().min(1).default(1),
  tags: tagListSchema,
  playable: boolExprSchema.default(true),
  cost: costListSchema,
  buyCost: costListSchema,
  effects: effectListSchema,
  abilities: z.array(abilitySchema).default([]).refine(hasUniqueIds, "ability ids must be unique"),
});

const dieTypeSchema = z.strictObject({
  id: idSchema,
  faces: z
    .array(
      z.strictObject({
        id: idSchema,
        symbols: z.record(idSchema, z.int()).default({}),
      }),
    )
    .min(1),
});

const poolSchema = z.strictObject({ id: idSchema });

const quantityTypeSchema = z.strictObject({
  id: idSchema,
  target: z.union([z.strictObject({ counter: idSchema }), z.strictObject({ attribute: idSchema })]),
  direction: z.enum(["increase", "decrease"]),
});

const modifierSchema = z.strictObject({
  id: idSchema,
  quantity: idSchema,
  priority: z.int().default(0),
  condition: boolExprSchema.default(true),
  optional: z.boolean().default(false),
  action: z.union([
    z.strictObject({ prevent: z.literal(true) }),
    z.strictObject({ reduce: numExprSchema }),
    z.strictObject({ increase: numExprSchema }),
    z.strictObject({ convertTo: idSchema }),
    z.strictObject({ substitute: effectListSchema }),
  ]),
  onApply: effectListSchema,
});

const stepSchema = z.strictObject({ id: idSchema, effects: effectListSchema });

const phaseSchema = z.strictObject({
  id: idSchema,
  onEnter: effectListSchema,
  onExit: effectListSchema,
  steps: z.array(stepSchema).min(1).refine(hasUniqueIds, "step ids must be unique"),
});

const triggerSchema = z.strictObject({
  id: idSchema,
  on: eventPatternSchema,
  condition: boolExprSchema.default(true),
  effects: effectListSchema,
  once: z.boolean().default(false),
});

const checkSchema = z.strictObject({
  id: idSchema,
  condition: boolExprSchema,
  effects: effectListSchema,
});

const endConditionSchema = z.strictObject({
  id: idSchema,
  condition: boolExprSchema,
  sequence: effectListSchema,
  outcome: z.union([
    outcomeSchema,
    z.strictObject({ when: boolExprSchema, then: outcomeSchema, else: outcomeSchema }),
  ]),
});

const procedureSchema = z.strictObject({
  id: idSchema,
  params: z
    .array(idSchema)
    .default([])
    .refine((params) => new Set(params).size === params.length, "params must be unique"),
  effects: effectListSchema,
});

const unitKindSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  image: imageSchema,
  attributes: z
    .array(counterSchema)
    .default([])
    .refine(hasUniqueIds, "attribute ids must be unique"),
});

const contentSchema = z.strictObject({
  boards: z.array(boardSchema).default([]),
  spaces: z.array(spaceSchema).default([]),
  edges: z.array(edgeSchema).default([]),
  edgeFilters: z.array(edgeFilterSchema).default([]),
  unitKinds: z.array(unitKindSchema).default([]),
  spaceCounters: z.array(counterSchema).default([]),
  counters: z.array(counterSchema).default([]),
  zones: z.array(zoneSchema).default([]),
  cards: z.array(cardSchema).default([]),
  quantityTypes: z.array(quantityTypeSchema).default([]),
  modifiers: z.array(modifierSchema).default([]),
  dice: z.array(dieTypeSchema).default([]),
  pools: z.array(poolSchema).default([]),
  triggers: z.array(triggerSchema).default([]),
  checks: z.array(checkSchema).default([]),
  endConditions: z.array(endConditionSchema).default([]),
  procedures: z.array(procedureSchema).default([]),
  setup: effectListSchema,
  setupEnd: effectListSchema,
  round: hooksSchema.prefault({}),
  phases: z.array(phaseSchema).default([]),
});

const idListSchema = z.array(idSchema).default([]);

const removalSchema = z.strictObject({
  boards: idListSchema,
  spaces: idListSchema,
  edges: idListSchema,
  edgeFilters: idListSchema,
  unitKinds: idListSchema,
  spaceCounters: idListSchema,
  counters: idListSchema,
  zones: idListSchema,
  cards: idListSchema,
  quantityTypes: idListSchema,
  modifiers: idListSchema,
  dice: idListSchema,
  pools: idListSchema,
  triggers: idListSchema,
  checks: idListSchema,
  endConditions: idListSchema,
  procedures: idListSchema,
  phases: idListSchema,
});

const moduleSchema = z.strictObject({
  id: idSchema,
  name: nameSchema.nullable().default(null),
  note: z.string().min(1).nullable().default(null),
  kind: nameSchema,
  precedence: z.int(),
  content: contentSchema.prefault({}),
  remove: removalSchema.prefault({}),
});

const choiceSchema = z
  .strictObject({
    id: idSchema,
    options: z.array(idSchema).default([]),
    kind: nameSchema.nullable().default(null),
    min: z.int().min(0),
    max: z.int().min(1),
  })
  .refine(
    (choice) => choice.kind !== null || choice.options.length > 0,
    "choice needs options or a kind",
  )
  .refine(
    (choice) =>
      choice.min <= choice.max && (choice.kind !== null || choice.max <= choice.options.length),
    "choice must satisfy min <= max <= number of options",
  );

function depthOf(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  return 1 + children.reduce<number>((deepest, child) => Math.max(deepest, depthOf(child)), 0);
}

function duplicates(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

type Issue = { path: (string | number)[]; message: string };

function contentIssues(content: Content, path: (string | number)[]): Issue[] {
  return LAYERED_COLLECTIONS.flatMap((collection) => {
    const items: readonly { id: string }[] = content[collection];
    return duplicates(items.map((item) => item.id)).map((id) => ({
      path: [...path, collection],
      message: `duplicate id "${id}"`,
    }));
  });
}

function neverChosenTogether(pack: Pack, a: Module, b: Module): boolean {
  return pack.choices.some((choice) => {
    const offered = offeredModules(pack, choice);
    return choice.max === 1 && offered.includes(a.id) && offered.includes(b.id);
  });
}

function sharedIds(a: Module, b: Module, collection: LayeredCollection): string[] {
  const idsOf = (module: Module) =>
    new Set(module.content[collection].map((item: { id: string }) => item.id));
  const theirs = idsOf(b);
  return [...idsOf(a)].filter((id) => theirs.has(id));
}

function precedenceConflicts(pack: Pack): Issue[] {
  const issues: Issue[] = [];
  pack.modules.forEach((a, index) => {
    for (const b of pack.modules.slice(index + 1)) {
      if (a.precedence !== b.precedence || neverChosenTogether(pack, a, b)) continue;
      for (const collection of LAYERED_COLLECTIONS) {
        for (const id of sharedIds(a, b, collection)) {
          issues.push({
            path: ["modules"],
            message: `modules with precedence ${a.precedence} both define ${collection} "${id}"`,
          });
        }
      }
    }
  });
  return [...new Map(issues.map((issue) => [issue.message, issue])).values()];
}

function choiceIssues(pack: Pack): Issue[] {
  const moduleIds = pack.modules.map((module) => module.id);
  const offered = pack.choices.flatMap((choice) => choice.options);
  return [
    ...duplicates(moduleIds).map((id) => ({
      path: ["modules"],
      message: `duplicate module "${id}"`,
    })),
    ...duplicates(pack.choices.map((choice) => choice.id)).map((id) => ({
      path: ["choices"],
      message: `duplicate choice "${id}"`,
    })),
    ...offered
      .filter((id) => !moduleIds.includes(id))
      .map((id) => ({ path: ["choices"], message: `unknown module "${id}"` })),
    ...duplicates(offered).map((id) => ({
      path: ["choices"],
      message: `module "${id}" is offered by more than one choice`,
    })),
  ];
}

/** Checks that need every module present, so they run on a core combined with its add-ons. */
export function combinedChoiceIssues(pack: Pack): string[] {
  return pack.choices
    .filter((choice) => offeredModules(pack, choice).length < Math.max(choice.min, 1))
    .map((choice) =>
      choice.kind === null
        ? `choice "${choice.id}" cannot be met`
        : `choice "${choice.id}" needs at least ${Math.max(choice.min, 1)} of kind "${choice.kind}"`,
    );
}

export function packIssues(pack: Pack): Issue[] {
  const contents = [pack.base, ...pack.modules.map((module) => module.content)];
  return [
    ...contentIssues(pack.base, ["base"]),
    ...pack.modules.flatMap((module, index) =>
      contentIssues(module.content, ["modules", index, "content"]),
    ),
    ...precedenceConflicts(pack),
    ...choiceIssues(pack),
    ...findMissingReferences(contents, contents).map((reference) => ({
      path: [],
      message: `undefined ${reference}`,
    })),
    ...procedureIssues(contents).map((message) => ({ path: [], message })),
    ...(depthOf(pack) > MAX_PACK_DEPTH
      ? [{ path: [], message: `pack nesting deeper than ${MAX_PACK_DEPTH}` }]
      : []),
  ];
}

export const packSchema = z
  .strictObject({
    meta: z.strictObject({
      id: idSchema,
      version: z.string().min(1),
      schemaVersion: z.literal(PACK_SCHEMA_VERSION),
      name: nameSchema,
    }),
    base: contentSchema.prefault({}),
    modules: z.array(moduleSchema).default([]),
    choices: z.array(choiceSchema).default([]),
  })
  .superRefine((pack, ctx) => {
    for (const issue of packIssues(pack)) {
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  });

/** An add-on alone only gets shape checks; references are checked once it joins its core. */
export const addOnSchema = z
  .strictObject({
    meta: z.strictObject({
      id: idSchema,
      version: z.string().min(1),
      schemaVersion: z.literal(PACK_SCHEMA_VERSION),
      name: nameSchema,
      core: idSchema,
    }),
    module: moduleSchema,
  })
  .superRefine((addOn, ctx) => {
    const issues = [
      ...contentIssues(addOn.module.content, ["module", "content"]),
      ...(depthOf(addOn) > MAX_PACK_DEPTH
        ? [{ path: [], message: `add-on nesting deeper than ${MAX_PACK_DEPTH}` }]
        : []),
    ];
    for (const issue of issues) {
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  });

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const schemaMatchesCoreType: Equals<z.infer<typeof packSchema>, Pack> = true;
void schemaMatchesCoreType;
const addOnSchemaMatchesCoreType: Equals<z.infer<typeof addOnSchema>, AddOn> = true;
void addOnSchemaMatchesCoreType;
