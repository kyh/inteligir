// A file of the library, by its sha, drawn from where the host draws its files (`readFile`) into an
// object URL of the page's own, so an <img> or a <video> shows the bytes this device holds and
// fetches nothing the page's policy refuses. The media type rides the Blob, so this file owns no
// extension table that could drift from the file's own. A read that failed while the host was
// offline reads again once it is back.

import { useEffect, useState } from "react";

import { getEditorHostIo } from "@repo/editor/host-io";

type FileRead =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string; readonly type: string }
  // the device can reach no copy of it now: offline and never fetched, or not in the library;
  // `offline` when the host was offline as the read failed
  | { readonly kind: "unavailable"; readonly offline: boolean };

type FileEvent =
  | { readonly kind: "read"; readonly url: string; readonly type: string }
  | { readonly kind: "failed"; readonly offline: boolean }
  | { readonly kind: "online" };

const LOADING: FileRead = { kind: "loading" };

const fileReadAfter = (read: FileRead, event: FileEvent): FileRead => {
  switch (event.kind) {
    case "read": {
      return read.kind === "loading" ? { kind: "ready", type: event.type, url: event.url } : read;
    }
    case "failed": {
      return read.kind === "loading" ? { kind: "unavailable", offline: event.offline } : read;
    }
    case "online": {
      return read.kind === "unavailable" && read.offline ? LOADING : read;
    }
    // no default
  }
};

export const useLibraryFile = (sha: string): FileRead => {
  const [read, setRead] = useState<FileRead>(LOADING);
  // re-keyed during the render that changes the sha, so no frame shows the previous file
  const [readSha, setReadSha] = useState(sha);
  if (readSha !== sha) {
    setReadSha(sha);
    setRead(LOADING);
  }
  const loading = read.kind === "loading";
  const url = read.kind === "ready" ? read.url : null;

  useEffect(() => {
    if (!loading) {
      return;
    }
    let cancelled = false;
    const io = getEditorHostIo();
    void (async () => {
      try {
        const file = await io.readFile(sha);
        if (!cancelled) {
          const drawn: FileEvent = {
            kind: "read",
            type: file.type,
            url: URL.createObjectURL(file),
          };
          setRead((was) => fileReadAfter(was, drawn));
        }
      } catch {
        if (!cancelled) {
          const failed: FileEvent = { kind: "failed", offline: io.notes.offline() };
          setRead((was) => fileReadAfter(was, failed));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sha, loading]);

  useEffect(
    () =>
      url === null
        ? undefined
        : () => {
            URL.revokeObjectURL(url);
          },
    [url],
  );

  useEffect(() => {
    const { notes } = getEditorHostIo();
    return notes.onOfflineChange(() => {
      if (!notes.offline()) {
        setRead((was) => fileReadAfter(was, { kind: "online" }));
      }
    });
  }, []);

  return read;
};
