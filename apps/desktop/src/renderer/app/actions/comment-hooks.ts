import { clearCommentMeta, setCommentMeta } from "@repo/editor/comments/comment-store";
import type { CommentsResponse } from "@repo/api/local/comments/comments-schema";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import { orpc } from "../api";

export function useNoteComments(path: string | null): UseQueryResult<CommentsResponse> {
  return useQuery({
    ...orpc.comments.list.queryOptions({ input: { path: path ?? "" } }),
    enabled: path !== null,
    // a refusal is an unparseable sidecar; retrying shows "Loading…" over an answer that will not change.
    retry: false,
  });
}

// keyed on the loaded document, not the note being opened: the outgoing note's ranges
// must never be measured against the incoming note's sidecar.
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
