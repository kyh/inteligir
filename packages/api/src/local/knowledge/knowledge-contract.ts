// no row declares a refusal: every handler answers from the index, and a bad path or tag is
// the input schema's BAD_REQUEST at the boundary; a tag rename reports skips, it never refuses

import { oc } from "@orpc/contract";
import {
  knowledgeBacklinksRequestSchema,
  knowledgeBacklinksResponseSchema,
  knowledgeMatchesRequestSchema,
  knowledgeMatchesResponseSchema,
  knowledgeProblemsRequestSchema,
  knowledgeProblemsResponseSchema,
  knowledgeRelatedRequestSchema,
  knowledgeRelatedResponseSchema,
  knowledgeRenameTagRequestSchema,
  knowledgeRenameTagResponseSchema,
  knowledgeSearchRequestSchema,
  knowledgeSearchResponseSchema,
  knowledgeTagNotesRequestSchema,
  knowledgeTagNotesResponseSchema,
  knowledgeTagsResponseSchema,
  knowledgeUnlinkedMentionsRequestSchema,
  knowledgeUnlinkedMentionsResponseSchema,
  knowledgeWikiTargetsResponseSchema,
} from "./knowledge-schema";

export const knowledgeContract = {
  search: oc.input(knowledgeSearchRequestSchema).output(knowledgeSearchResponseSchema),

  matches: oc.input(knowledgeMatchesRequestSchema).output(knowledgeMatchesResponseSchema),

  wikiTargets: oc.output(knowledgeWikiTargetsResponseSchema),

  backlinks: oc.input(knowledgeBacklinksRequestSchema).output(knowledgeBacklinksResponseSchema),

  related: oc.input(knowledgeRelatedRequestSchema).output(knowledgeRelatedResponseSchema),

  unlinkedMentions: oc
    .input(knowledgeUnlinkedMentionsRequestSchema)
    .output(knowledgeUnlinkedMentionsResponseSchema),

  problems: oc.input(knowledgeProblemsRequestSchema).output(knowledgeProblemsResponseSchema),

  tags: oc.output(knowledgeTagsResponseSchema),

  tagNotes: oc.input(knowledgeTagNotesRequestSchema).output(knowledgeTagNotesResponseSchema),

  renameTag: oc.input(knowledgeRenameTagRequestSchema).output(knowledgeRenameTagResponseSchema),
};
