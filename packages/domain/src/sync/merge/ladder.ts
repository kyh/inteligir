// ---------------------------------------------------------------------------
// mergeLadder — the pure conflict-resolution ladder the engine runs over a
// both-sides-changed markdown file BEFORE falling back to a conflict-copy
// sibling. Rungs, in order (first success wins):
//   1. whitespace — the sides differ only in trailing whitespace / trailing
//      blank lines → converge to the REMOTE bytes (loses only whitespace).
//   2. diff3 — a clean 3-way line merge over the TRUE base bytes (any
//      conflict region → fall through, NOT stop: both-appended-at-EOF is a
//      same-position insert that diff3 reports as a conflict and the
//      append-union rung below resolves).
//   3. frontmatter — bodies byte-equal, headers forked → key-wise 3-way merge.
//   4. append-union — provably append-shaped divergence (creation collision,
//      or the base a line-prefix of BOTH sides) → union of the tails.
// No rung can lose a content line; the terminal answer is `conflict`, which
// keeps today's conflict-copy behavior. We never emit in-file conflict
// markers (`=======` reparses as a setext H1; `<<<<<<<` is invalid MDX).
//
// PURE and deterministic: no clock, no I/O, no hashing — same inputs, same
// bytes, on node, workerd, and Hermes alike. `TextDecoder`/`TextEncoder` are
// the sanctioned universal globals (http-sync-port.ts uses them in core
// production code). UTF-8 validity is checked by re-encode round-trip rather
// than `TextDecoder`'s `{ fatal }` option, whose Hermes support is unproven.
// ---------------------------------------------------------------------------

import { diff3Merge } from "node-diff3";

import { appendUnion, splitLines } from "./append-union";
import { mergeFrontmatterOnly } from "./frontmatter-merge";

/** What the merging engine knows about the last-synced base of a path. */
export type MergeBase =
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "bytes"; readonly bytes: Uint8Array };

export type MergeRung = "whitespace" | "diff3" | "frontmatter" | "append-union";

export type MergeResult =
  | { readonly kind: "merged"; readonly bytes: Uint8Array; readonly rung: MergeRung }
  | { readonly kind: "conflict" };

const CONFLICT: MergeResult = { kind: "conflict" };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Decode strictly-valid UTF-8, or `null`. Valid UTF-8 always re-encodes
 * byte-identically; any invalid sequence decodes to U+FFFD and breaks the
 * equality — a portable strictness check with no reliance on `{ fatal }`. */
function decodeUtf8(bytes: Uint8Array): string | null {
  const text = decoder.decode(bytes);
  const reencoded = encoder.encode(text);
  if (reencoded.length !== bytes.length) return null;
  for (let i = 0; i < reencoded.length; i += 1) {
    if (reencoded[i] !== bytes[i]) return null;
  }
  return text;
}

/** Whitespace-insensitive view: per-line trailing whitespace and the trailing
 * blank-line run dropped. Equal views mean the sides differ only in bytes no
 * one meant. */
function whitespaceNormalized(text: string): string {
  const { lines } = splitLines(text);
  const trimmed = lines.map((line) => line.trimEnd());
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "") end -= 1;
  return trimmed.slice(0, end).join("\n");
}

/** Are `prefix`'s lines a line-prefix of `text`'s? (Provable pure-append.) */
function isLinePrefix(prefix: string, text: string): boolean {
  const p = splitLines(prefix).lines;
  const t = splitLines(text).lines;
  if (p.length > t.length) return false;
  return p.every((line, i) => line === t[i]);
}

/** Rung 2: clean diff3 over the true base, or `null` on any conflict region. */
function diff3Clean(base: string, local: string, remote: string): string | null {
  const b = splitLines(base);
  const l = splitLines(local);
  const r = splitLines(remote);
  // `excludeFalseConflicts`: both sides making the SAME change is not a fork.
  const regions = diff3Merge(l.lines, b.lines, r.lines, { excludeFalseConflicts: true });
  const merged: string[] = [];
  for (const region of regions) {
    if (!region.ok) return null;
    merged.push(...region.ok);
  }
  return merged.join("\n") + (l.trailingNewline || r.trailingNewline ? "\n" : "");
}

/**
 * Run the ladder over one file's three states. Returns the merged BYTES (the
 * caller hashes them: equal to the remote hash → local write only, else push)
 * or `conflict`, which means "do exactly what we did before this existed".
 */
export function mergeLadder(input: {
  base: MergeBase;
  local: Uint8Array;
  remote: Uint8Array;
}): MergeResult {
  const local = decodeUtf8(input.local);
  const remote = decodeUtf8(input.remote);
  if (local === null || remote === null) return CONFLICT;
  const base = input.base.kind === "bytes" ? decodeUtf8(input.base.bytes) : null;
  if (input.base.kind === "bytes" && base === null) return CONFLICT;

  // 1. Whitespace-equal → the remote bytes verbatim (hash-equal upstream, so
  // the engine lands them locally with zero coordinator traffic).
  if (whitespaceNormalized(local) === whitespaceNormalized(remote)) {
    return { kind: "merged", bytes: input.remote, rung: "whitespace" };
  }

  // 2. diff3 over the TRUE base — only real base bytes qualify; a conflict
  // region falls THROUGH (both-appended-at-EOF lands in rung 4).
  if (base !== null) {
    const merged = diff3Clean(base, local, remote);
    if (merged !== null) return { kind: "merged", bytes: encoder.encode(merged), rung: "diff3" };
  }

  // 3. Key-wise frontmatter merge (bodies byte-equal). Refused outright on an
  // UNAVAILABLE base (legacy manifest entry, blob gone): treating it as empty
  // would resurrect keys a peer deleted — one conflict copy, then healed.
  if (input.base.kind !== "unavailable") {
    const merged = mergeFrontmatterOnly(base, local, remote);
    if (merged !== null) {
      return { kind: "merged", bytes: encoder.encode(merged), rung: "frontmatter" };
    }
  }

  // 4. Append-union — gated on PROVABLE append shape: no base entry at all
  // (creation collision, e.g. both devices created today's journal), or the
  // base bytes a line-prefix of both sides. An `unavailable` base is
  // indistinguishable from a mid-file edit, so it never unions.
  const appendShaped =
    input.base.kind === "absent" ||
    (base !== null && isLinePrefix(base, local) && isLinePrefix(base, remote));
  if (appendShaped) {
    const merged = appendUnion(remote, local);
    if (merged !== null) {
      return { kind: "merged", bytes: encoder.encode(merged), rung: "append-union" };
    }
  }

  return CONFLICT;
}
