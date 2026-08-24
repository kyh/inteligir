// The open note's comment threads, query-cached and swept by the vault's own
// files-changed invalidation (a sidecar is a vault file). The hook ALSO
// pushes the sidecar's root/resolved id sets into the editor's comment store,
// so the tint and the panel read one truth.

import { setCommentMeta } from "@repo/editor/comments/comment-store";
import type { CommentsResponse } from "@repo/api/local/comments/comments-schema";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import { orpc } from "../api";

const EMPTY: ReadonlySet<string> = new Set();

export function useNoteComments(path: string | null): UseQueryResult<CommentsResponse> {
  const query = useQuery({
    ...orpc.comments.list.queryOptions({ input: { path: path ?? "" } }),
    enabled: path !== null,
  });

  const data = query.data;
  useEffect(() => {
    if (data === undefined) {
      setCommentMeta(EMPTY, EMPTY);
      return;
    }
    const known = new Set(data.threads.map((thread) => thread.rootId));
    const resolved = new Set(
      data.threads.filter((thread) => thread.resolved).map((thread) => thread.rootId),
    );
    setCommentMeta(known, resolved);
  }, [data]);

  return query;
}
