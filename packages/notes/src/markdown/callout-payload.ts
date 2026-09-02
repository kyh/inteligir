// the editor's rule table, the knowledge scan and the mobile projection all read the header
// through this; the prefixed spellings (`type: <kind>`, `level: <word>`) are remembered so the
// editor re-serializes byte-exact.

const PRIORITY_LEVELS = new Set(["low", "medium", "high", "critical"]);

// includes the legacy variants callout-node still accents, so a converted note keeps reading
// as a callout.
const CALLOUT_VARIANTS = new Set([
  "caution",
  "error",
  "info",
  "note",
  "priority",
  "tip",
  "warning",
]);

const TYPE_PREFIX_RE = /^type\s*:/i;
const LEVEL_PREFIX_RE = /^level\s*:/i;

export interface CalloutPayload {
  kind: string;
  level?: string;
  body: string;
  headerLines: number;
  typePrefixed: boolean;
  levelPrefixed: boolean;
}

export function parseCalloutPayload(payload: string): CalloutPayload | null {
  const lines = payload.split("\n");
  const rawKind = lines[0]?.trim() ?? "";
  const typePrefixed = TYPE_PREFIX_RE.test(rawKind);
  const kind = (typePrefixed ? rawKind.replace(TYPE_PREFIX_RE, "") : rawKind).trim();
  if (!CALLOUT_VARIANTS.has(kind)) {
    return null;
  }
  const rawLevel = lines[1]?.trim() ?? "";
  const levelPrefixed = LEVEL_PREFIX_RE.test(rawLevel);
  const level = (levelPrefixed ? rawLevel.replace(LEVEL_PREFIX_RE, "") : rawLevel).trim();
  const hasLevel = kind === "priority" && PRIORITY_LEVELS.has(level);
  const headerLines = hasLevel ? 2 : 1;
  const parsed: CalloutPayload = {
    kind,
    body: lines.slice(headerLines).join("\n"),
    headerLines,
    typePrefixed,
    levelPrefixed: hasLevel && levelPrefixed,
  };
  if (hasLevel) parsed.level = level;
  return parsed;
}
