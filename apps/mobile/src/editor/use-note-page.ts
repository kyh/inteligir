// One note page per item screen: the actions it reaches the library through, made once per mount;
// whether there is a connection, which the network and the app being in front decide together; the
// items the account's socket says moved; where the open note stands, as the page reports it; a
// leave's ask, which the page answers with whether the note holds every edit made here; and whether
// the page is shown at all, which a screen deep under others lets go once the note holds.

import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { getCloudUrl } from "@/lib/cloud-url";
import { useLibrary } from "@/lib/library-hooks";
import { openItem } from "@/lib/routes";
import { leaveAsks } from "./leave-asks";
import { noteActions } from "./note-actions";
import type { MovedItems, NoteState, PageProps } from "./page/page-host";

const subscribeOffline = (listener: () => void): (() => void) => {
  const stopOnline = onlineManager.subscribe(listener);
  const appState = AppState.addEventListener("change", listener);
  return () => {
    stopOnline();
    appState.remove();
  };
};

// iOS suspends the page behind the app, its socket with it, so the note reads as offline there and
// redials the moment the app is in front, ahead of any ping noticing; `inactive` is a passing state
// (a pulled-down notification centre), not a departure
const offlineNow = (): boolean =>
  !onlineManager.isOnline() || AppState.currentState === "background";

const clock = {
  after: (ms: number, run: () => void) => {
    const timer = setTimeout(run, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

export interface NotePage {
  // every prop the page takes but the web view's own
  readonly props: PageProps;
  // an edit made here may not be held yet, so a leave asks first
  readonly editing: boolean;
  readonly ask: (then: (holds: boolean) => void) => void;
  readonly shown: boolean;
}

export interface NotePageOptions {
  // the caret at the end of the body, the keyboard up
  readonly focus: boolean;
  // the screen is under enough others that its web view should go once the note holds
  readonly deep: boolean;
}

export const useNotePage = (itemId: string, { deep, focus }: NotePageOptions): NotePage => {
  const library = useLibrary();
  const queryClient = useQueryClient();
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [actions] = useState(() => noteActions({ itemId, library, openItem, queryClient }));
  const offline = useSyncExternalStore(subscribeOffline, offlineNow);
  const [moved, setMoved] = useState<MovedItems>({ ids: [], seq: 0 });
  useEffect(
    () =>
      library.onItems((ids) => {
        setMoved((before) => ({ ids: ids === null ? null : [...ids], seq: before.seq + 1 }));
      }),
    [library],
  );
  const [noteState, setNoteState] = useState<NoteState>("none");
  const [settle, setSettle] = useState(0);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [asks] = useState(() => leaveAsks({ asked: setSettle, clock }));
  const editing = noteState === "editing";
  useEffect(() => {
    if (deep && editing) {
      asks.ask((holds) => {
        if (holds) {
          setNoteState("none");
        }
      });
    }
  }, [asks, deep, editing]);
  return {
    ask: asks.ask,
    editing,
    props: {
      ...actions,
      cloudOrigin: getCloudUrl(),
      focus,
      itemId,
      moved,
      noteState: setNoteState,
      offline,
      settle,
      settled: asks.answer,
    },
    shown: !deep || editing,
  };
};
