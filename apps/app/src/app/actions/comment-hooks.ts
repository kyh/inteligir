// The open note's comment threads, query-cached and swept by the vault's own
// files-changed invalidation (a sidecar is a vault file). The hook ALSO
// pushes the sidecar's root/resolved id sets into the editor's comment store,
// so the tint and the panel read one truth.

import { setCommentMeta } from "@repo/editor/comments/comment-store";
import type { CommentsResponse } from "@repo/server-contract/comments";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import { queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";

const EMPTY: ReadonlySet<string> = new Set();

export function useNoteComments(path: string | null): UseQueryResult<CommentsResponse> {
  const { api } = useWorkspace();
  const query = useQuery<CommentsResponse>({
    enabled: path !== null,
    queryFn: async () => unwrap(await api.comments.$get({ query: { path: path ?? "" } })),
    queryKey: queryKeys.comments(path ?? "none"),
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
