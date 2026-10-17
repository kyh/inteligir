// no row declares a refusal: every handler answers from the index, and a bad path or tag is
// the input schema's BAD_REQUEST at the boundary; a tag rename reports skips, it never refuses

import { oc } from "@orpc/contract";
import {
  knowledgeBacklinksRequestSchema,
  knowledgeBacklinksResponseSchema,
  knowledgeFindByUrlRequestSchema,
  knowledgeFindByUrlResponseSchema,
  knowledgeItemPathsRequestSchema,
  knowledgeItemPathsResponseSchema,
  knowledgeItemsAtRequestSchema,
  knowledgeItemsAtResponseSchema,
  knowledgeItemsRequestSchema,
  knowledgeItemsResponseSchema,
  knowledgePathForNoteIdRequestSchema,
  knowledgePathForNoteIdResponseSchema,
  knowledgeScopesResponseSchema,
  knowledgeMatchesRequestSchema,
  knowledgeMatchesResponseSchema,
  knowledgeRelatedRequestSchema,
  knowledgeRelatedResponseSchema,
  knowledgeRenameTagRequestSchema,
  knowledgeRenameTagResponseSchema,
  knowledgeSearchRequestSchema,
  knowledgeSearchResponseSchema,
  knowledgeTagNotesRequestSchema,
  knowledgeTagNotesResponseSchema,
  knowledgeTagsResponseSchema,
  knowledgeWikiTargetsResponseSchema,
} from "./knowledge-schema";

export const knowledgeContract = {
  backlinks: oc.input(knowledgeBacklinksRequestSchema).output(knowledgeBacklinksResponseSchema),

  matches: oc.input(knowledgeMatchesRequestSchema).output(knowledgeMatchesResponseSchema),

  related: oc.input(knowledgeRelatedRequestSchema).output(knowledgeRelatedResponseSchema),

  renameTag: oc.input(knowledgeRenameTagRequestSchema).output(knowledgeRenameTagResponseSchema),

  search: oc.input(knowledgeSearchRequestSchema).output(knowledgeSearchResponseSchema),

  tagNotes: oc.input(knowledgeTagNotesRequestSchema).output(knowledgeTagNotesResponseSchema),

  tags: oc.output(knowledgeTagsResponseSchema),

  wikiTargets: oc.output(knowledgeWikiTargetsResponseSchema),

  findByUrl: oc.input(knowledgeFindByUrlRequestSchema).output(knowledgeFindByUrlResponseSchema),

  itemPaths: oc.input(knowledgeItemPathsRequestSchema).output(knowledgeItemPathsResponseSchema),

  items: oc.input(knowledgeItemsRequestSchema).output(knowledgeItemsResponseSchema),

  itemsAt: oc.input(knowledgeItemsAtRequestSchema).output(knowledgeItemsAtResponseSchema),

  pathForNoteId: oc
    .input(knowledgePathForNoteIdRequestSchema)
    .output(knowledgePathForNoteIdResponseSchema),

  scopes: oc.output(knowledgeScopesResponseSchema),
};
