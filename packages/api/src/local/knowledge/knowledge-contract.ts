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
  backlinks: oc.input(knowledgeBacklinksRequestSchema).output(knowledgeBacklinksResponseSchema),

  matches: oc.input(knowledgeMatchesRequestSchema).output(knowledgeMatchesResponseSchema),

  problems: oc.input(knowledgeProblemsRequestSchema).output(knowledgeProblemsResponseSchema),

  related: oc.input(knowledgeRelatedRequestSchema).output(knowledgeRelatedResponseSchema),

  renameTag: oc.input(knowledgeRenameTagRequestSchema).output(knowledgeRenameTagResponseSchema),

  search: oc.input(knowledgeSearchRequestSchema).output(knowledgeSearchResponseSchema),

  tagNotes: oc.input(knowledgeTagNotesRequestSchema).output(knowledgeTagNotesResponseSchema),

  tags: oc.output(knowledgeTagsResponseSchema),

  unlinkedMentions: oc
    .input(knowledgeUnlinkedMentionsRequestSchema)
    .output(knowledgeUnlinkedMentionsResponseSchema),

  wikiTargets: oc.output(knowledgeWikiTargetsResponseSchema),
};
