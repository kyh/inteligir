// no row declares a refusal: every handler answers from the index, and a bad path is
// vaultPathSchema's BAD_REQUEST at the input boundary

import { oc } from "@orpc/contract";
import {
  knowledgeBacklinksRequestSchema,
  knowledgeBacklinksResponseSchema,
  knowledgeMatchesRequestSchema,
  knowledgeMatchesResponseSchema,
  knowledgeRelatedRequestSchema,
  knowledgeRelatedResponseSchema,
  knowledgeSearchRequestSchema,
  knowledgeSearchResponseSchema,
  knowledgeTagsResponseSchema,
  knowledgeWikiTargetsResponseSchema,
} from "./knowledge-schema";

export const knowledgeContract = {
  search: oc.input(knowledgeSearchRequestSchema).output(knowledgeSearchResponseSchema),

  matches: oc.input(knowledgeMatchesRequestSchema).output(knowledgeMatchesResponseSchema),

  wikiTargets: oc.output(knowledgeWikiTargetsResponseSchema),

  backlinks: oc.input(knowledgeBacklinksRequestSchema).output(knowledgeBacklinksResponseSchema),

  related: oc.input(knowledgeRelatedRequestSchema).output(knowledgeRelatedResponseSchema),

  tags: oc.output(knowledgeTagsResponseSchema),
};
