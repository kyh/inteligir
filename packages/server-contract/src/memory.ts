// The agent-memory wire contract: durable markdown facts ABOUT THE USER — who
// they are, and how they want the agent to work — that live as flat files in
// `~/.inteligir/memory/` (INTELIGIR_MEMORY_DIR). It is the CLAUDE.md-style
// pattern the repo already trusts: one fact per file, frontmatter, no index,
// no vector store, no second process.
//
// THIS CONTRACT IS HUMAN-FACING ONLY, and that is the whole design. The agent
// does not write memory through the app: it has a bash shell as the same user,
// so it reads a fact with `cat`, remembers one by writing a file, and forgets
// one by deleting it — the SAME reason view-context ships no `get_view_context`
// tool (#542): a round trip to the app to do what the shell already does buys
// nothing. So there is no add/remove-for-agent route here. What the app owns is
// the OTHER two halves the shell cannot serve: DERIVING the per-turn index
// injected into the model's prompt (server-side, off these files), and the
// Settings surface — where a human who is NOT in a shell reads a fact's body
// and deletes one. Hence exactly two rows: `list` and `remove`.
//
// THE FILES ARE THE SOURCE OF TRUTH. There is no maintained index file, so
// there is no index to race and nothing to keep atomic — every read globs the
// directory fresh. A malformed file is surfaced, never silently dropped:
// `list` answers valid facts AND the files it could not parse, so a human can
// see and fix (or delete) one the agent wrote wrong.

import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  noRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./errors";

/**
 * The CLOSED type vocabulary — a discriminated value so a third kind later is
 * a deliberate additive row (a new enum member here, a new heading in the
 * injected index, a new group in the UI), never a free-for-all.
 *
 *  - `user`       — who they are: role, projects, expertise, standing facts.
 *  - `preference` — how they want the agent to work: "propose, don't apply, on
 *                   design docs"; "concise commits"; corrections they've made.
 *
 * There is deliberately NO `session` / transcript type: a running log of what
 * was discussed duplicates the thread history, which is already durable and
 * syncs. Memory is the DISTILLATE, not the recording.
 */
export const MEMORY_TYPES = ["user", "preference"] as const;
export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

/**
 * A fact as the Settings surface reads it. `file` is the on-disk basename and
 * the DELETE KEY — `name` is the human title from frontmatter and can collide
 * across files, so it is not an identity. `body` is everything after the
 * frontmatter, verbatim.
 */
export const memoryEntrySchema = z
  .object({
    file: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    type: memoryTypeSchema,
    body: z.string(),
  })
  .strict();
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

/** A file in the memory dir the parser could not read as a fact — surfaced
 *  rather than dropped, so a human can fix or delete what the agent got wrong.
 *  Keyed by `file` too, so the UI can offer to delete it. */
export const malformedMemorySchema = z
  .object({ file: z.string().min(1), problem: z.string().min(1) })
  .strict();
export type MalformedMemory = z.infer<typeof malformedMemorySchema>;

/** The whole directory as one read: the valid facts and the files that were
 *  not. Both writes (there is only one, `remove`) answer this shape, so the
 *  UI's next render is the server's own view of the directory. */
export const memoryListResponseSchema = z
  .object({
    memories: z.array(memoryEntrySchema),
    malformed: z.array(malformedMemorySchema),
  })
  .strict();
export type MemoryListResponse = z.infer<typeof memoryListResponseSchema>;

export const memoryRemoveRequestSchema = z.object({ file: z.string().min(1) }).strict();
export type MemoryRemoveRequest = z.infer<typeof memoryRemoveRequestSchema>;

export const memoryRoutes = {
  list: defineRoute({
    path: "/memory",
    method: "get",
    request: noRequest(),
    response: jsonResponse<MemoryListResponse>(),
  }),
  remove: defineRoute({
    path: "/memory/remove",
    method: "post",
    request: jsonRequest<EmptyInput, MemoryRemoveRequest>(memoryRemoveRequestSchema),
    response: [
      jsonResponse<MemoryListResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
    ] as const,
  }),
};
