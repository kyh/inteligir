import { clearAnnotationMeta, setAnnotationMeta } from "@repo/editor/annotations/annotation-store";
import type { AnnotationsResponse } from "@repo/contract/local/annotations/annotations-schema";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import { orpc } from "../api";

export const useNoteAnnotations = (path: string | null): UseQueryResult<AnnotationsResponse> =>
  useQuery({
    ...orpc.annotations.list.queryOptions({ input: path === null ? skipToken : { path } }),
    // a refusal is an unparseable store; retrying shows "Loading…" over an answer that will not change.
    retry: false,
  });

// every write answers the item's listing as it now stands (annotations-contract.ts), so it becomes
// that item's list with no second read
export const holdAnnotations = (
  queryClient: QueryClient,
  path: string,
  listing: AnnotationsResponse,
): void => {
  // a read already in flight would land over the write's answer
  void queryClient.cancelQueries({ queryKey: orpc.annotations.list.key({ input: { path } }) });
  queryClient.setQueryData(orpc.annotations.list.queryKey({ input: { path } }), listing);
};

// a refusal most often says the item's store moved under the list shown, so after one that item's
// list alone is read again
export const rereadAnnotations = (queryClient: QueryClient, path: string): void => {
  void queryClient.invalidateQueries({ queryKey: orpc.annotations.list.key({ input: { path } }) });
};

// keyed on the loaded document, not the note being opened: the outgoing note's ranges
// must never be measured against the incoming note's store.
export const useNoteAnnotationMeta = (path: string | null): void => {
  const { data } = useNoteAnnotations(path);
  useEffect(() => {
    if (path === null || data === undefined) {
      return;
    }
    // noted: a note or a reply, which the gutter marks; a bare highlight is its tint alone
    setAnnotationMeta(path, {
      knownIds: new Set(data.annotations.map((annotation) => annotation.id)),
      notedIds: new Set(
        data.annotations
          .filter((annotation) => annotation.root.text !== "" || annotation.replies.length > 0)
          .map((annotation) => annotation.id),
      ),
    });
    return () => {
      clearAnnotationMeta(path);
    };
  }, [path, data]);
};
