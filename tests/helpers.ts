import demoPackData from "../content/demo/pack.json";
import { parsePack } from "../src/content";
import type { Pack } from "../src/core";

export function loadDemoPack(): Pack {
  const parsed = parsePack(demoPackData);
  if (!parsed.ok) {
    throw new Error(`Demo pack invalid: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.value;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
