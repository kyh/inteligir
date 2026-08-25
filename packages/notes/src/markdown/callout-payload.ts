// The callout fence's PAYLOAD grammar, in ONE place beside the fence langs
// and for the same reason: the editor's rule table, the knowledge scan and
// the mobile projection all read this header, and a reader with its own
// spelling renders (or indexes) a priority level as body prose.
//
// The payload is: a kind line — the variant word, optionally spelled
// `type: <variant>` — then, for `priority` only, an optional level line
// (`high`, optionally `level: high`), then the body. The prefixed spellings
// are REMEMBERED so the editor can re-serialize byte-exact; an unknown kind
// answers null and the caller falls back to a plain code block, the same
// unknown-type behavior everywhere.

const PRIORITY_LEVELS = new Set(["low", "medium", "high", "critical"]);

/** The dialect's three kinds plus the legacy variants callout-node still
 *  accents — a converted note must keep reading as a callout. */
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
  /** Present only on a `priority` callout whose second line is a level. */
  level?: string;
  /** The markdown body — everything after the header line(s). */
  body: string;
  /** How many payload lines the header consumed (1 or 2) — what a scanner
   *  needs to shift body offsets into the outer source. */
  headerLines: number;
  /** The header arrived as `type: <kind>` — re-serialize it that way. */
  typePrefixed: boolean;
  /** The level arrived as `level: <word>` — re-serialize it that way. */
  levelPrefixed: boolean;
}

/** Parse a callout fence's payload, or null when the kind line names no
 *  variant (the caller renders a plain code block). */
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
