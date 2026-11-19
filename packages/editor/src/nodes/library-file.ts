import { useEffect, useState } from "react";

import { getEditorHostIo } from "@repo/editor/host-io";

type FileRead =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "unavailable"; readonly offline: boolean };

type FileEvent =
  | { readonly kind: "addressed"; readonly url: string }
  | { readonly kind: "failed"; readonly offline: boolean }
  | { readonly kind: "online" };

const LOADING: FileRead = { kind: "loading" };

const fileReadAfter = (read: FileRead, event: FileEvent) => {
  switch (event.kind) {
    case "addressed": {
      return (
        read.kind === "loading" ? { kind: "ready", url: event.url } : read
      ) satisfies FileRead;
    }

    case "failed": {
      return (
        read.kind === "unavailable" ? read : { kind: "unavailable", offline: event.offline }
      ) satisfies FileRead;
    }

    case "online": {
      return read.kind === "unavailable" && read.offline ? LOADING : read;
    }

    default: {
      throw new Error(`unexpected ${String(event satisfies never)}`);
    }
  }
};

const failedNow = () =>
  ({
    kind: "failed",
    offline: !getEditorHostIo().notes.reach.get(),
  }) satisfies FileEvent;

export const useLibraryFile = (sha: string) => {
  const [read, setRead] = useState<FileRead>(LOADING);
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

  const failed = () => {
    const event = failedNow();
    setRead((was) => fileReadAfter(was, event));
  };

  return [read, failed] satisfies readonly [FileRead, () => void];
};
