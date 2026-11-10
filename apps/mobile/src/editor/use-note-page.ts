// One note page per item screen: the actions it reaches the library through, made once per mount;
// whether there is a connection, which the network and the app being in front decide together; the
// items the account's socket says moved; and the page's life (note-page-life.ts), which the page's
// report of its note, the screen's depth and a leave move, and which says whether a leave asks
// first and whether the page is shown at all.

import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { getCloudUrl } from "@/lib/cloud-url";
import { useLibrary } from "@/lib/library-hooks";
import { openItem } from "@/lib/routes";
import { noteActions } from "./note-actions";
import { notePageLife } from "./note-page-life";
import type { NotePageLifeStore } from "./note-page-life";
import type { MovedItems, PageProps } from "./page/page-host";

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
  // an edit made here may not be held yet, or a leave is being asked, so a leave goes through
  // `leave` rather than at once
  readonly guarded: boolean;
  readonly leave: NotePageLifeStore["leave"];
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
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [life] = useState(() => notePageLife({ clock, deep }));
  const { asked, life: now } = useSyncExternalStore(life.subscribe, life.get);
  useEffect(() => {
    life.place(deep);
  }, [life, deep]);
  // a deep page whose note did not hold asks again once an edit can reach it
  useEffect(() => {
    if (!offline) {
      life.reconnected();
    }
  }, [life, offline]);
  return {
    guarded: now.kind === "editing" || now.kind === "asking",
    leave: life.leave,
    props: {
      ...actions,
      cloudOrigin: getCloudUrl(),
      focus,
      itemId,
      moved,
      noteState: life.report,
      offline,
      settle: asked,
      settled: life.answer,
    },
    shown: now.kind !== "released",
  };
};
