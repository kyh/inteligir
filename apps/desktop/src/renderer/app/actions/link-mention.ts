import type { UnlinkedMentionWire } from "@repo/api/local/knowledge/knowledge-schema";
import { linkMention } from "@repo/notes/knowledge/unlinked-mentions";
import { rewriteNote } from "../note/rewrite-note";
import type { RewriteNoteApi, RewriteNoteOutcome } from "../note/rewrite-note";

export type LinkMentionApi = RewriteNoteApi;
export type LinkMentionOutcome = RewriteNoteOutcome<undefined>;

// the row named exact bytes in an exact line; a note that moved is reported, never merged
export const linkMentionInNote = async (
  api: RewriteNoteApi,
  mention: UnlinkedMentionWire,
  target: string,
): Promise<LinkMentionOutcome> =>
  await rewriteNote(api, mention.path, (content) => {
    const linked = linkMention(content, mention, target);
    return linked === null ? null : { content: linked, result: undefined };
  });

export const linkMentionMessage = (outcome: LinkMentionOutcome, path: string): string => {
  switch (outcome.kind) {
    case "written":
    case "unchanged": {
      return `Linked from ${path}.`;
    }
    case "changed": {
      return `${path} changed since it was read — reopen Related and try again.`;
    }
    case "failed": {
      return `Could not link from ${path}: ${outcome.message}.`;
    }
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
};
