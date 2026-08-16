// ---------------------------------------------------------------------------
// The knowledge index's wire vocabulary — the payloads of the link + lexical
// search channels over the vault. Their RESULT shapes live in
// @repo/notes/knowledge next to the engine that produces them
// (link-graph-index, tag-index, knowledge-index); only the questions are here.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

export const KnowledgeSearchSchema = Type.Object(
  {
    query: Type.String(),
    /** Restrict to notes carrying this tag. Empty or absent means no filter,
     * so an empty `query` with a `tag` lists that tag's notes. */
    tag: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

// How much of the link graph to return — the wire face of @repo/notes'
// GraphBounds. Every field optional: `{}` asks for the whole vault, which is
// what a small one still answers.
export const LinkGraphBoundsSchema = Type.Object(
  {
    /** Vault path whose neighbourhood is expanded first (typically the open note). */
    focus: Type.Optional(Type.String()),
    maxNodes: Type.Optional(Type.Number({ minimum: 1 })),
    maxEdges: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

// Guarded task toggle — keyed by ORDINAL (delegation's anchor key; survives
// line shifts and duplicate identical lines) plus the exact recorded line.
export const ToggleTaskSchema = Type.Object(
  {
    path: Type.String(),
    /** Position among the file's GFM task items (@repo/notes' task-ordinal
     * counting). */
    ordinal: Type.Number({ minimum: 0 }),
    /** The task's exact untrimmed source line (terminator excluded) as the
     * projection recorded it — the write proceeds only on byte equality. */
    expectedRaw: Type.String(),
  },
  { additionalProperties: false },
);

/** toggleVaultTask's verdict. Failures are VALUES, never throws: the host has
 * already kicked an index refresh, so the client refetches + toasts. */
export type ToggleTaskResult =
  | { ok: true; checked: boolean }
  | { ok: false; reason: "line-missing" | "line-changed" | "not-a-checkbox"; error: string };
