export type FormulaMeta = {
  id?: string;
  name?: string;
  stale: boolean;
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
    else if (key === "stale") parsed.stale = value === "1" || value === "true";
    else if (key === "format")
      continue; // accepted and dropped on rewrite, per the skill
    else if (key !== "") parsed.unknown.push({ key, value });
  }
  return parsed;
}

export function serializeFormulaMeta(meta: FormulaMeta): string | undefined {
  const parts: string[] = [];
  if (meta.id !== undefined && meta.id !== "") parts.push(`id=${meta.id}`);
  if (meta.name !== undefined && meta.name !== "") parts.push(`name=${meta.name}`);
  if (meta.stale) parts.push("stale=1");
  for (const { key, value } of meta.unknown) parts.push(`${key}=${value}`);
  return parts.length === 0 ? undefined : parts.join(";");
}
