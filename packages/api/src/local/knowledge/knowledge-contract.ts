// The knowledge procedures: read-only queries over the derived vault index.
//
// No row declares a refusal, and that is a property of the domain rather than
// an omission: every handler settles the index and answers from it, and a path
// the vault could not address is already refused by `vaultPathSchema` at the
// input boundary — which oRPC raises as BAD_REQUEST, so no row states it.

import { oc } from "@orpc/contract";
import {
  knowledgeBacklinksRequestSchema,
  knowledgeBacklinksResponseSchema,
  knowledgeRelatedRequestSchema,
  knowledgeRelatedResponseSchema,
  knowledgeSearchRequestSchema,
  knowledgeSearchResponseSchema,
  knowledgeTagsResponseSchema,
  knowledgeWikiTargetsResponseSchema,
} from "./knowledge-schema";

export const knowledgeContract = {
  search: oc.input(knowledgeSearchRequestSchema).output(knowledgeSearchResponseSchema),

  wikiTargets: oc.output(knowledgeWikiTargetsResponseSchema),

  backlinks: oc.input(knowledgeBacklinksRequestSchema).output(knowledgeBacklinksResponseSchema),

  related: oc.input(knowledgeRelatedRequestSchema).output(knowledgeRelatedResponseSchema),

  tags: oc.output(knowledgeTagsResponseSchema),
};
