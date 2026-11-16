import type { z } from "zod";
import { err, ok, type AddOn, type Pack, type Result } from "../core";
import { addOnSchema, packSchema } from "./schema";

export type PackIssue = { path: string; message: string };

export type PackError = { type: "invalidPack"; issues: PackIssue[] };

function invalid(error: z.ZodError): PackError {
  return {
    type: "invalidPack",
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  };
}

export function parsePack(input: unknown): Result<Pack, PackError> {
  const parsed = packSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err(invalid(parsed.error));
}

export function parseAddOn(input: unknown): Result<AddOn, PackError> {
  const parsed = addOnSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err(invalid(parsed.error));
}
