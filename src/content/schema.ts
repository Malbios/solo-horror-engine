import { z } from "zod";
import {
  findMissingReferences,
  LAYERED_COLLECTIONS,
  PACK_SCHEMA_VERSION,
  type BoolExpr,
  type Content,
  type Effect,
  type NumExpr,
  type Pack,
} from "../core";

const MAX_PACK_DEPTH = 64;

const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "ids are lowercase kebab-case");
const nameSchema = z.string().min(1);
const scopeSchema = z.enum(["step", "phase", "round"]);
const outcomeSchema = z.enum(["win", "loss"]);

function hasUniqueIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

export const numExprSchema: z.ZodType<NumExpr> = z.lazy(() => {
  const pair = z.tuple([numExprSchema, numExprSchema]);
  return z.union([
    z.int(),
    z.strictObject({ counter: idSchema }),
    z.strictObject({ zoneCount: idSchema }),
    z.strictObject({ context: z.enum(["from", "to", "amount"]) }),
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

export const effectSchema: z.ZodType<Effect> = z.lazy(() => {
  const effects = z.array(effectSchema).default([]);
  const option = z.strictObject({
    id: idSchema,
    label: nameSchema,
    when: boolExprSchema.default(true),
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
    z.strictObject({ type: z.literal("playWindow"), from: idSchema, to: idSchema }),
    z.strictObject({ type: z.literal("endScope"), scope: scopeSchema }),
    z.strictObject({ type: z.literal("endGame"), endCondition: idSchema }),
  ]);
});

const effectListSchema = z.array(effectSchema).default([]);
const optionalIdSchema = idSchema.nullable().default(null);

const eventPatternSchema = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("counterChanged"), counter: idSchema }),
  z.strictObject({ event: z.literal("cardsMoved"), from: optionalIdSchema, to: optionalIdSchema }),
  z.strictObject({ event: z.literal("scopeEntered"), scope: scopeSchema, id: optionalIdSchema }),
  z.strictObject({ event: z.literal("scopeExited"), scope: scopeSchema, id: optionalIdSchema }),
]);

const hooksSchema = z.strictObject({ onEnter: effectListSchema, onExit: effectListSchema });

const counterSchema = z
  .strictObject({
    id: idSchema,
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
  );

const zoneSchema = z.strictObject({ id: idSchema, face: z.enum(["up", "down"]).default("up") });

const cardSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  copies: z.int().min(1).default(1),
  playable: boolExprSchema.default(true),
  effects: effectListSchema,
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

const contentSchema = z.strictObject({
  counters: z.array(counterSchema).default([]),
  zones: z.array(zoneSchema).default([]),
  cards: z.array(cardSchema).default([]),
  triggers: z.array(triggerSchema).default([]),
  checks: z.array(checkSchema).default([]),
  endConditions: z.array(endConditionSchema).default([]),
  setup: effectListSchema,
  round: hooksSchema.prefault({}),
  phases: z.array(phaseSchema).default([]),
});

const idListSchema = z.array(idSchema).default([]);

const removalSchema = z.strictObject({
  counters: idListSchema,
  zones: idListSchema,
  cards: idListSchema,
  triggers: idListSchema,
  checks: idListSchema,
  endConditions: idListSchema,
  phases: idListSchema,
});

const moduleSchema = z.strictObject({
  id: idSchema,
  kind: nameSchema,
  precedence: z.int(),
  content: contentSchema.prefault({}),
  remove: removalSchema.prefault({}),
});

const choiceSchema = z
  .strictObject({
    id: idSchema,
    options: z.array(idSchema).min(1),
    min: z.int().min(0),
    max: z.int().min(1),
  })
  .refine(
    (choice) => choice.min <= choice.max && choice.max <= choice.options.length,
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

function precedenceConflicts(pack: Pack): Issue[] {
  const issues: Issue[] = [];
  const precedences = new Set(pack.modules.map((module) => module.precedence));
  for (const precedence of precedences) {
    const peers = pack.modules.filter((module) => module.precedence === precedence);
    for (const collection of LAYERED_COLLECTIONS) {
      const ids = peers.flatMap((module) => {
        const items: readonly { id: string }[] = module.content[collection];
        return [...new Set(items.map((item) => item.id))];
      });
      for (const id of duplicates(ids)) {
        issues.push({
          path: ["modules"],
          message: `modules with precedence ${precedence} both define ${collection} "${id}"`,
        });
      }
    }
  }
  return issues;
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

function packIssues(pack: Pack): Issue[] {
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

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const schemaMatchesCoreType: Equals<z.infer<typeof packSchema>, Pack> = true;
void schemaMatchesCoreType;
