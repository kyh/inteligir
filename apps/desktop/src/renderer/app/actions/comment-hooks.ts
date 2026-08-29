// The open note's comment threads, query-cached and swept by the vault's own
// files-changed invalidation (a sidecar is a vault file). A PANE additionally
// pushes its own note's root/resolved id sets into the editor's comment store,
// so the tint over a pane's bytes reads that note's sidecar rather than
// whichever note happens to be focused.

import { clearCommentMeta, setCommentMeta } from "@repo/editor/comments/comment-store";
import type { CommentsResponse } from "@repo/api/local/comments/comments-schema";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import { orpc } from "../api";

export function useNoteComments(path: string | null): UseQueryResult<CommentsResponse> {
  return useQuery({
    ...orpc.comments.list.queryOptions({ input: { path: path ?? "" } }),
    enabled: path !== null,
  });
}

/** Keep `path`'s tint meta published for as long as the calling pane shows it.
 * Every pane mounts its own; react-query answers them all from the one query
 * per path. */
export function usePaneCommentMeta(path: string | null): void {
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
