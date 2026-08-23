// The metadata tail of a formula pill — `id=…;name=…;stale=1` — parsed and
// re-emitted in one spelling. The inteligir-formulas skill is
// the contract: `id` is identity within the note, `name` names an executable
// variable, `stale=1` is app-maintained recompute state, and legacy
// `format=…` keys are accepted but dropped when the pill is rewritten.

export type FormulaMeta = {
  id?: string;
  name?: string;
  stale: boolean;
  /** Keys we do not model, kept verbatim so a rewrite is honest about what it
   * drops: only `format` (the spec's one sanctioned removal) is filtered. */
  unknown: Array<{ key: string; value: string }>;
};

export function parseFormulaMeta(meta: string | undefined): FormulaMeta {
  const parsed: FormulaMeta = { stale: false, unknown: [] };
  if (meta === undefined || meta === "") return parsed;
  for (const pair of meta.split(";")) {
    const eq = pair.indexOf("=");
    const key = (eq === -1 ? pair : pair.slice(0, eq)).trim();
    const value = eq === -1 ? "" : pair.slice(eq + 1).trim();
    if (key === "id") parsed.id = value;
    else if (key === "name") parsed.name = value;
    // Both spellings parse; serializeFormulaMeta re-emits the `1` form.
    else if (key === "stale") parsed.stale = value === "1" || value === "true";
    else if (key === "format")
      continue; // legacy — accepted, ignored, dropped on rewrite
    else if (key !== "") parsed.unknown.push({ key, value });
  }
  return parsed;
}

/** The one emission order (id, name, stale, then unknowns as written), so a
 * rewritten pill diffs minimally and two writers agree on bytes. Answers
 * undefined when nothing survives — the pill keeps its two-field form. */
export function serializeFormulaMeta(meta: FormulaMeta): string | undefined {
  const parts: string[] = [];
  if (meta.id !== undefined && meta.id !== "") parts.push(`id=${meta.id}`);
  if (meta.name !== undefined && meta.name !== "") parts.push(`name=${meta.name}`);
  if (meta.stale) parts.push("stale=1");
  for (const { key, value } of meta.unknown) parts.push(`${key}=${value}`);
  return parts.length === 0 ? undefined : parts.join(";");
}
