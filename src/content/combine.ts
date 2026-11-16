import { err, ok, type AddOn, type Pack, type Result } from "../core";
import { combinedChoiceIssues, packIssues, unmetChoices } from "./schema";

function combinedVersion(core: Pack, addOns: readonly AddOn[]): string {
  const parts = addOns
    .map((addOn) => `${addOn.meta.id}@${addOn.meta.version}`)
    .sort((a, b) => a.localeCompare(b));
  return [core.meta.version, ...parts].join("+");
}

function foreignAddOns(core: Pack, addOns: readonly AddOn[]): string[] {
  return addOns
    .filter((addOn) => addOn.meta.core !== core.meta.id)
    .map(
      (addOn) =>
        `add-on "${addOn.meta.id}" extends core "${addOn.meta.core}", not "${core.meta.id}"`,
    );
}

function repeatedAddOns(addOns: readonly AddOn[]): string[] {
  const ids = addOns.map((addOn) => addOn.meta.id);
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].map(
    (id) => `add-on "${id}" is loaded twice`,
  );
}

function joinModules(core: Pack, addOns: readonly AddOn[]): Pack {
  return {
    ...core,
    meta: { ...core.meta, version: combinedVersion(core, addOns) },
    modules: [
      ...core.modules,
      ...addOns.map((addOn) => ({ ...addOn.module, name: addOn.module.name ?? addOn.meta.name })),
    ],
  };
}

/** Module kinds a choice needs that neither the core nor these add-ons supply. */
export function missingModuleKinds(core: Pack, addOns: readonly AddOn[]): string[] {
  return unmetChoices(joinModules(core, addOns)).flatMap((choice) =>
    choice.kind === null ? [] : [choice.kind],
  );
}

/** Joins a core with its add-ons into one pack and checks the result as a whole. */
export function combineAddOns(core: Pack, addOns: readonly AddOn[]): Result<Pack, string[]> {
  const early = [...foreignAddOns(core, addOns), ...repeatedAddOns(addOns)];
  if (early.length > 0) return err(early);
  const combined = joinModules(core, addOns);
  const issues = [
    ...packIssues(combined).map((issue) => issue.message),
    ...combinedChoiceIssues(combined),
  ];
  return issues.length > 0 ? err([...new Set(issues)]) : ok(combined);
}
