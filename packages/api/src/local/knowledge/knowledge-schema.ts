// each schema mirrors an engine type: a field the engine adds passes structural assignment
// unseen, and only the strict parse catches it. a capped response carries `total`, and
// `array.length < total` is the truncation test; no second flag can disagree with the arrays.

import { z } from "zod";
import { vaultPathSchema } from "../vault/vault-schema";

export const KNOWLEDGE_SEARCH_MAX_LIMIT = 100;
export const KNOWLEDGE_RELATED_MAX_LIMIT = 50;
export const KNOWLEDGE_BACKLINKS_MAX = 500;
export const KNOWLEDGE_TAGS_MAX = 1000;
export const KNOWLEDGE_MATCHES_MAX_LIMIT = 500;
export const KNOWLEDGE_MATCHES_DEFAULT_LIMIT = 200;

// q is the raw box text, parsed engine-side so a typed tag: term and a composed one resolve alike
export const knowledgeSearchRequestSchema = z
  .object({
    q: z.string(),
    limit: z.number().int().min(1).max(KNOWLEDGE_SEARCH_MAX_LIMIT).optional(),
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

// the literal scan, not the ranked search: every occurrence, with the line it sits on.
// one line of text: a needle spanning a terminator cannot be found per line, so it is refused
export const knowledgeMatchesRequestSchema = z
  .object({
    q: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => !/[\r\n]/u.test(value), { message: "q must be one line" }),
    caseSensitive: z.boolean().optional(),
    wholeWord: z.boolean().optional(),
    limit: z.number().int().min(1).max(KNOWLEDGE_MATCHES_MAX_LIMIT).optional(),
  })
  .strict();
export type KnowledgeMatchesRequest = z.infer<typeof knowledgeMatchesRequestSchema>;

export const vaultMatchSchema = z
  .object({
    path: z.string().min(1),
    title: z.string(),
    // this match's index among the doc's matches, in document order: what a jump lands on
    ordinal: z.number().int().min(0),
    // 1-based
    line: z.number().int().min(1),
    // utf-16 offset inside the line
    column: z.number().int().min(0),
    length: z.number().int().min(1),
    before: z.string(),
    text: z.string(),
    after: z.string(),
  })
  .strict();
export type VaultMatchWire = z.infer<typeof vaultMatchSchema>;

export const knowledgeMatchesResponseSchema = z
  .object({
    matches: z.array(vaultMatchSchema).max(KNOWLEDGE_MATCHES_MAX_LIMIT),
    total: z.number().int().min(0),
  })
  .strict();
export type KnowledgeMatchesResponse = z.infer<typeof knowledgeMatchesResponseSchema>;

export const linkKindSchema = z.enum(["wiki", "md", "image"]);
export type LinkKindWire = z.infer<typeof linkKindSchema>;

export const backlinkEntrySchema = z
  .object({
    sourcePath: z.string().min(1),
    // 1-based
    line: z.number().int().min(1),
    snippet: z.string(),
    kind: linkKindSchema,
    embed: z.boolean(),
    alias: z.string().optional(),
  })
  .strict();
export type BacklinkEntryWire = z.infer<typeof backlinkEntrySchema>;

export const wikiTargetSchema = z
  .object({
    path: z.string().min(1),
    title: z.string(),
    type: z.enum(["doc", "asset"]),
    aliases: z.array(z.string()).optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

export type WikiTargetWire = z.infer<typeof wikiTargetSchema>;

export const knowledgeWikiTargetsResponseSchema = z
  .object({ targets: z.array(wikiTargetSchema) })
  .strict();
export type KnowledgeWikiTargetsResponse = z.infer<typeof knowledgeWikiTargetsResponseSchema>;

export const knowledgeBacklinksRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type KnowledgeBacklinksRequest = z.infer<typeof knowledgeBacklinksRequestSchema>;

export const knowledgeBacklinksResponseSchema = z
  .object({
    path: z.string().min(1),
    backlinks: z.array(backlinkEntrySchema).max(KNOWLEDGE_BACKLINKS_MAX),
    total: z.number().int().min(0),
  })
  .strict();
export type KnowledgeBacklinksResponse = z.infer<typeof knowledgeBacklinksResponseSchema>;

// a limit and no total: a ranked top-n has no honest count of the rest
export const knowledgeRelatedRequestSchema = z
  .object({
    path: vaultPathSchema,
    limit: z.number().int().min(1).max(KNOWLEDGE_RELATED_MAX_LIMIT).optional(),
  })
  .strict();
export type KnowledgeRelatedRequest = z.infer<typeof knowledgeRelatedRequestSchema>;

export const relatedNoteSchema = z
  .object({
    path: z.string().min(1),
    title: z.string(),
    score: z.number(),
    // printed verbatim by every surface: a ranked list with no reason is one nobody can check
    reasons: z.array(z.string()),
  })
  .strict();
export type RelatedNoteWire = z.infer<typeof relatedNoteSchema>;

export const knowledgeRelatedResponseSchema = z
  .object({
    path: z.string().min(1),
    related: z.array(relatedNoteSchema).max(KNOWLEDGE_RELATED_MAX_LIMIT),
  })
  .strict();
export type KnowledgeRelatedResponse = z.infer<typeof knowledgeRelatedResponseSchema>;

export const tagCountSchema = z
  .object({
    tag: z.string().min(1),
    count: z.number().int().min(1),
  })
  .strict();
export type TagCountWire = z.infer<typeof tagCountSchema>;

export const knowledgeTagsResponseSchema = z
  .object({
    // most-used first, so the cap keeps the tags that matter
    tags: z.array(tagCountSchema).max(KNOWLEDGE_TAGS_MAX),
    total: z.number().int().min(0),
  })
  .strict();
export type KnowledgeTagsResponse = z.infer<typeof knowledgeTagsResponseSchema>;
