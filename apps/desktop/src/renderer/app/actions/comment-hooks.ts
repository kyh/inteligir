// The open note's comment threads, query-cached and swept by the vault's own
// files-changed invalidation (a sidecar is a vault file), plus the root/
// resolved id sets pushed into the editor's comment store so the tint over the
// document's bytes reads that note's own sidecar.

import { clearCommentMeta, setCommentMeta } from "@repo/editor/comments/comment-store";
import type { CommentsResponse } from "@repo/api/local/comments/comments-schema";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import { orpc } from "../api";

export function useNoteComments(path: string | null): UseQueryResult<CommentsResponse> {
  return useQuery({
    ...orpc.comments.list.queryOptions({ input: { path: path ?? "" } }),
    enabled: path !== null,
    // A refusal here is a sidecar the schema cannot parse, which the same
    // request cannot fix: the default three retries show "Loading…" for
    // seconds over an answer that will not change. The files-changed sweep
    // re-asks once the file does.
    retry: false,
  });
}

/** Keep `path`'s tint meta published for as long as the editor shows it. Keyed
 * on the LOADED document rather than the note being opened: a switch publishes
 * the new note's ids only once its bytes are on screen, so the outgoing note's
 * ranges are never measured against the incoming note's sidecar. */
export function useNoteCommentMeta(path: string | null): void {
  const { data } = useNoteComments(path);
  useEffect(() => {
    if (path === null || data === undefined) return undefined;
    setCommentMeta(path, {
      knownIds: new Set(data.threads.map((thread) => thread.rootId)),
      resolvedIds: new Set(
        data.threads.filter((thread) => thread.resolved).map((thread) => thread.rootId),
      ),
    });
    return () => {
      clearCommentMeta(path);
    };
  }, [path, data]);
}
