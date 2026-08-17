// The knowledge wire contract: read-only queries over the derived vault index
// (search, backlinks, tags, rename candidates). Every schema here MIRRORS an
// engine type from @repo/notes — the handlers assign engine values straight
// into these shapes. A field the engine RENAMES or removes fails the handler's
// compile; a field the engine ADDS is invisible to the compiler (structural
// assignment allows excess members) and is caught at the other end: the route
// tests parse live responses with these strict schemas, so an undeclared
// field on the wire fails the suite.
//
// Unbounded collections are CAPPED here, in the contract, so the bound is a
// declared fact rather than a handler habit: each capped response carries
// `total` (what the whole vault holds), and `array.length < total` IS the
// truncation test — no second flag can disagree with the arrays.

import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonResponse,
  noRequest,
  queryRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./routes";

export const KNOWLEDGE_SEARCH_MAX_LIMIT = 100;
export const KNOWLEDGE_BACKLINKS_MAX = 500;
export const KNOWLEDGE_TAGS_MAX = 1000;
export const KNOWLEDGE_RENAME_CANDIDATES_MAX = 200;

/**
 * ONE search route: `q` is the raw box text, parsed ENGINE-side
 * (`parseSearchQuery`) so a `tag:<name>` term typed by a user and a tag a
 * client composed resolve identically. Empty text with no tag answers [].
 */
export const knowledgeSearchRequestSchema = z
  .object({
    q: z.string(),
    limit: z.coerce.number().int().min(1).max(KNOWLEDGE_SEARCH_MAX_LIMIT).optional(),
  })
  .strict();
export type KnowledgeSearchRequest = z.infer<typeof knowledgeSearchRequestSchema>;

export const searchResultSchema = z
  .object({
    path: z.string().min(1),
    title: z.string(),
    snippet: z.string(),
    score: z.number(),
  })
  .strict();
export type SearchResultWire = z.infer<typeof searchResultSchema>;

export const knowledgeSearchResponseSchema = z
  .object({ results: z.array(searchResultSchema) })
  .strict();
export type KnowledgeSearchResponse = z.infer<typeof knowledgeSearchResponseSchema>;

export const linkKindSchema = z.enum(["wiki", "md", "image"]);
export type LinkKindWire = z.infer<typeof linkKindSchema>;

export const backlinkEntrySchema = z
  .object({
    sourcePath: z.string().min(1),
    /** 1-based line of the link in the source doc. */
    line: z.number().int().min(1),
    /** The source line the link sits on, trimmed. */
    snippet: z.string(),
    kind: linkKindSchema,
    /** True for `![[transclusions]]`. */
    embed: z.boolean(),
    /** Wiki `|alias` / md link label, when present. */
    alias: z.string().optional(),
  })
  .strict();
export type BacklinkEntryWire = z.infer<typeof backlinkEntrySchema>;

export const knowledgeBacklinksRequestSchema = z.object({ path: z.string().min(1) }).strict();
export type KnowledgeBacklinksRequest = z.infer<typeof knowledgeBacklinksRequestSchema>;

export const knowledgeBacklinksResponseSchema = z
  .object({
    path: z.string().min(1),
    backlinks: z.array(backlinkEntrySchema).max(KNOWLEDGE_BACKLINKS_MAX),
    /** Backlinks the whole vault holds; `backlinks.length < total` means cut. */
    total: z.number().int().min(0),
  })
  .strict();
export type KnowledgeBacklinksResponse = z.infer<typeof knowledgeBacklinksResponseSchema>;

export const tagCountSchema = z
  .object({
    tag: z.string().min(1),
    count: z.number().int().min(1),
  })
  .strict();
export type TagCountWire = z.infer<typeof tagCountSchema>;

export const knowledgeTagsResponseSchema = z
  .object({
    /** Most-used first, so the cap keeps the tags that matter. */
    tags: z.array(tagCountSchema).max(KNOWLEDGE_TAGS_MAX),
    total: z.number().int().min(0),
  })
  .strict();
export type KnowledgeTagsResponse = z.infer<typeof knowledgeTagsResponseSchema>;

export const renameCandidatesRequestSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();
export type RenameCandidatesRequest = z.infer<typeof renameCandidatesRequestSchema>;

/** A SUPERSET of the docs a rename would actually rewrite — what a client can
 * show as "N linked notes will be updated". */
export const renameCandidatesResponseSchema = z
  .object({
    candidates: z.array(z.string().min(1)).max(KNOWLEDGE_RENAME_CANDIDATES_MAX),
    total: z.number().int().min(0),
  })
  .strict();
export type RenameCandidatesResponse = z.infer<typeof renameCandidatesResponseSchema>;

export const knowledgeRoutes = {
  search: defineRoute({
    path: "/knowledge/search",
    method: "get",
    request: queryRequest<EmptyInput, KnowledgeSearchRequest>(knowledgeSearchRequestSchema),
    response: jsonResponse<KnowledgeSearchResponse>(),
  }),
  backlinks: defineRoute({
    path: "/knowledge/backlinks",
    method: "get",
    request: queryRequest<EmptyInput, KnowledgeBacklinksRequest>(knowledgeBacklinksRequestSchema),
    response: [
      jsonResponse<KnowledgeBacklinksResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
    ],
  }),
  tags: defineRoute({
    path: "/knowledge/tags",
    method: "get",
    request: noRequest(),
    response: jsonResponse<KnowledgeTagsResponse>(),
  }),
  renameCandidates: defineRoute({
    path: "/knowledge/rename-candidates",
    method: "get",
    request: queryRequest<EmptyInput, RenameCandidatesRequest>(renameCandidatesRequestSchema),
    response: [
      jsonResponse<RenameCandidatesResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
    ],
  }),
};
