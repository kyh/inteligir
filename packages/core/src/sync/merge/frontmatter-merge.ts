// ---------------------------------------------------------------------------
// mergeFrontmatterOnly — the ladder rung for the "both devices touched the
// PROPERTIES of the same note" divergence: bodies byte-equal, headers forked.
// diff3 reports both-sides-added-a-key as a same-position conflict, so this
// rung resolves it key-wise instead: a 3-way merge per key over the union of
// keys, refusing the moment both sides changed the same key differently.
//
// Byte-preservation is the house contract (what we can't read, we can't
// destroy — parseProperties returns `invalid` on malformed yaml/dup keys/
// non-mapping roots, and this rung refuses on it), so the output is produced
// by Document surgery on the LOCAL header, the `serializeProperties` pattern:
// only remote-won keys are set/deleted; untouched keys — crucially every
// `unsupported` one — keep their source bytes and comments. Two extra
// refusals keep the surgery honest:
//   - a remote-won `unsupported` value is never transplanted (setting it would
//     re-serialize structure we can't verify; aliases could dangle) → refuse;
//   - the local header must round-trip byte-exactly through the yaml Document
//     BEFORE surgery (flow-style spacing is normalized by `yaml`'s printer;
//     a header it can't reprint verbatim is a header we don't rewrite).
// ---------------------------------------------------------------------------

import { parseDocument } from "yaml";

import {
  frontmatterYaml,
  parseProperties,
  splitFrontmatter,
  valueEqual,
  type TypedProperty,
} from "../../markdown/frontmatter";

type PropMap = ReadonlyMap<string, TypedProperty>;

/** The header's keys as a map, or `null` when the rung must refuse (malformed
 * yaml / duplicate keys / non-mapping root). A missing header is an empty map. */
function propsOf(yaml: string | null): PropMap | null {
  if (yaml === null) return new Map();
  const parsed = parseProperties(yaml);
  if (parsed.kind === "invalid") return null;
  const map = new Map<string, TypedProperty>();
  if (parsed.kind === "valid") {
    for (const prop of parsed.properties) map.set(prop.key, prop);
  }
  return map;
}

/** Key-level equality: typed values via `valueEqual`, `unsupported` ones by
 * their raw source bytes; absent (`undefined`) equals only absent. */
function sameProp(a: TypedProperty | undefined, b: TypedProperty | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.type === "unsupported" || b.type === "unsupported") {
    return a.type === "unsupported" && b.type === "unsupported" && a.rawYaml === b.rawYaml;
  }
  return a.type === b.type && valueEqual(a.value, b.value);
}

/**
 * Merge two documents whose BODIES are byte-equal but whose frontmatter
 * headers diverged, key-wise against the base header (`null` = the file had no
 * base — creation collision). Returns the merged document text, or `null`
 * when the rung refuses (bodies differ, any header unreadable, a key changed
 * both sides differently, or the surgery can't be byte-honest).
 */
export function mergeFrontmatterOnly(
  base: string | null,
  local: string,
  remote: string,
): string | null {
  const localSplit = splitFrontmatter(local);
  const remoteSplit = splitFrontmatter(remote);
  if (localSplit.body !== remoteSplit.body) return null;

  const localYaml = frontmatterYaml(local);
  const localProps = propsOf(localYaml);
  const remoteProps = propsOf(frontmatterYaml(remote));
  const baseProps = propsOf(base === null ? null : frontmatterYaml(base));
  if (localProps === null || remoteProps === null || baseProps === null) return null;

  // Surgery target: the LOCAL header's Document, so untouched keys keep their
  // exact source bytes. Refuse unless yaml can reprint that header verbatim —
  // otherwise even a "minimal" edit would silently reformat unrelated lines.
  const doc = parseDocument(localYaml ?? "");
  if (localYaml !== null && doc.toString().replace(/\n$/, "") !== localYaml) return null;

  const keys = new Set<string>([...baseProps.keys(), ...localProps.keys(), ...remoteProps.keys()]);
  let keyCount = localProps.size;
  for (const key of keys) {
    const b = baseProps.get(key);
    const l = localProps.get(key);
    const r = remoteProps.get(key);
    const localChanged = !sameProp(b, l);
    const remoteChanged = !sameProp(b, r);
    // Unchanged either side, or a one-sided LOCAL change (edit/add/delete):
    // the local header already holds the winning state.
    if (!remoteChanged) continue;
    if (localChanged) {
      // Both changed: identical → local already holds it; different → refuse.
      if (sameProp(l, r)) continue;
      return null;
    }
    // One-sided REMOTE change (edit/add/delete) — land it on the local header.
    if (r === undefined) {
      doc.delete(key);
      keyCount -= 1;
      continue;
    }
    // A remote-won value we couldn't type can't be transplanted honestly.
    if (r.type === "unsupported") return null;
    doc.set(key, r.value);
    if (l === undefined) keyCount += 1;
  }

  // Reassemble. An empty merged mapping drops the fence entirely (mirrors
  // `serializeDoc`); otherwise the local body rides along byte-exactly.
  if (keyCount === 0) return localSplit.body;
  const yamlOut = doc.toString().replace(/\n$/, "");
  return `---\n${yamlOut}\n---\n${localSplit.body}`;
}
