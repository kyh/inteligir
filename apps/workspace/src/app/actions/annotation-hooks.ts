import { clearAnnotationMeta, setAnnotationMeta } from "@repo/editor/annotations/annotation-store";
import type { AnnotationsResponse } from "@repo/contract/local/annotations/annotations-schema";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";

import { orpc } from "../api";

export const useNoteAnnotations = (path: string | null): UseQueryResult<AnnotationsResponse> =>
  useQuery({
    ...orpc.annotations.list.queryOptions({ input: path === null ? skipToken : { path } }),
    // a refusal is an unparseable store; retrying shows "Loading…" over an answer that will not change.
    retry: false,
  });

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
