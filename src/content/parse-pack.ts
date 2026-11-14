import { err, ok, type Pack, type Result } from "../core";
import { packSchema } from "./schema";

export type PackIssue = { path: string; message: string };

export type PackError = { type: "invalidPack"; issues: PackIssue[] };

export function parsePack(input: unknown): Result<Pack, PackError> {
  const parsed = packSchema.safeParse(input);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err({
    type: "invalidPack",
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
}
