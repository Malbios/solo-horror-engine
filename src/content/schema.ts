import { z } from "zod";
import { PACK_SCHEMA_VERSION, type Pack } from "../core";

const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "ids are lowercase kebab-case");
const nameSchema = z.string().min(1);

const zoneSchema = z.strictObject({ id: idSchema, name: nameSchema });

const cardSchema = z.strictObject({ id: idSchema, name: nameSchema });

const trackSchema = z
  .strictObject({
    id: idSchema,
    name: nameSchema,
    min: z.int(),
    max: z.int(),
    start: z.int(),
  })
  .refine((track) => track.min <= track.start && track.start <= track.max, {
    message: "track must satisfy min <= start <= max",
  });

function duplicateIds(items: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

export const packSchema = z
  .strictObject({
    meta: z.strictObject({
      id: idSchema,
      version: z.string().min(1),
      schemaVersion: z.literal(PACK_SCHEMA_VERSION),
      name: nameSchema,
    }),
    zones: z.array(zoneSchema).min(1),
    deck: z.strictObject({
      startZone: idSchema,
      cards: z.array(cardSchema).min(1),
    }),
    tracks: z.array(trackSchema).min(1),
  })
  .superRefine((pack, ctx) => {
    const collections = [
      ["zones", pack.zones],
      ["deck", pack.deck.cards],
      ["tracks", pack.tracks],
    ] as const;
    for (const [path, items] of collections) {
      for (const id of duplicateIds(items)) {
        ctx.addIssue({ code: "custom", path: [path], message: `duplicate id "${id}"` });
      }
    }
    if (!pack.zones.some((zone) => zone.id === pack.deck.startZone)) {
      ctx.addIssue({
        code: "custom",
        path: ["deck", "startZone"],
        message: `unknown zone "${pack.deck.startZone}"`,
      });
    }
  });

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const schemaMatchesCoreType: Equals<z.infer<typeof packSchema>, Pack> = true;
void schemaMatchesCoreType;
