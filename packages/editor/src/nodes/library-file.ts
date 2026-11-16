// A file of the library, by its sha, at the address the host draws its files from (`fileSrc`), so
// an <img> or a <video> loads, caches and seeks it as the page does any file it draws. The address
// is asked for, and the element may still fail to load it: either while the host was offline is
// asked again once it is back.

import { useEffect, useState } from "react";

import { getEditorHostIo } from "@repo/editor/host-io";

type FileRead =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string }
  // the device can reach no copy of it now: offline and never fetched, or not in the library;
  // `offline` when the host was offline as it failed
  | { readonly kind: "unavailable"; readonly offline: boolean };

type FileEvent =
  | { readonly kind: "addressed"; readonly url: string }
  | { readonly kind: "failed"; readonly offline: boolean }
  | { readonly kind: "online" };

const LOADING: FileRead = { kind: "loading" };

const fileReadAfter = (read: FileRead, event: FileEvent): FileRead => {
  switch (event.kind) {
    case "addressed": {
      return read.kind === "loading" ? { kind: "ready", url: event.url } : read;
    }
    case "failed": {
      return read.kind === "unavailable" ? read : { kind: "unavailable", offline: event.offline };
    }
    case "online": {
      return read.kind === "unavailable" && read.offline ? LOADING : read;
    }
    // no default
  }
};

const failedNow = (): FileEvent => ({
  kind: "failed",
  offline: !getEditorHostIo().notes.reach.get(),
});

// the file's read, and what the element drawing its address calls when that would not load
export const useLibraryFile = (sha: string): readonly [FileRead, () => void] => {
  const [read, setRead] = useState<FileRead>(LOADING);
  // re-keyed during the render that changes the sha, so no frame shows the previous file
  const [readSha, setReadSha] = useState(sha);
  if (readSha !== sha) {
    setReadSha(sha);
    setRead(LOADING);
  }
  const loading = read.kind === "loading";

  useEffect(() => {
    if (!loading) {
      return;
    }
    let cancelled = false;
    void (async () => {
      let event: FileEvent;
      try {
        event = { kind: "addressed", url: await getEditorHostIo().fileSrc(sha) };
      } catch {
        event = failedNow();
      }
      if (!cancelled) {
        setRead((was) => fileReadAfter(was, event));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sha, loading]);

  useEffect(() => {
    const { reach } = getEditorHostIo().notes;
    return reach.subscribe(() => {
      if (reach.get()) {
        setRead((was) => fileReadAfter(was, { kind: "online" }));
      }
    });
  }, []);

  const failed = (): void => {
    const event = failedNow();
    setRead((was) => fileReadAfter(was, event));
  };
  return [read, failed];
};
