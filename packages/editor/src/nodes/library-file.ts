// A file of the library, by its sha, drawn from where the host draws its files (`readFile`) into an
// object URL of the page's own, so an <img> or a <video> shows the bytes this device holds and
// fetches nothing the page's policy refuses. The media type rides the Blob, so this file owns no
// extension table that could drift from the file's own.

import { useEffect, useState } from "react";

import { getEditorHostIo } from "@repo/editor/host-io";

export type LibraryFileState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string; readonly type: string }
  // the device can reach no copy of it now: offline and never fetched, or not in the library
  | { readonly kind: "missing" };

const LOADING: LibraryFileState = { kind: "loading" };

export const useLibraryFile = (sha: string): LibraryFileState => {
  const [fetched, setFetched] = useState<LibraryFileState>(LOADING);
  // re-keyed during the render that changes the sha, so no frame shows the previous file
  const [fetchedSha, setFetchedSha] = useState(sha);
  if (fetchedSha !== sha) {
    setFetchedSha(sha);
    setFetched(LOADING);
  }

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const file = await getEditorHostIo().readFile(sha);
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(file);
        setFetched({ kind: "ready", type: file.type, url: objectUrl });
      } catch {
        if (!cancelled) {
          setFetched({ kind: "missing" });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [sha]);

  return fetched;
};
