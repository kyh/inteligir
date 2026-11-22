import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useOnline } from "@/lib/app-runtime";
import { useLibrary } from "@/lib/library-hooks";
import { openItem } from "@/lib/routes";
import { noteActions } from "./note-actions";
import { notePageLife } from "./note-page-life";
import type { NotePageLifeStore } from "./note-page-life";
import type { MovedItems, PageProps } from "./page/page-host";
import type { UnsentNote } from "@repo/contract/library/unsent-note";

interface NotePage {
  readonly props: PageProps;
  readonly guarded: boolean;
  readonly leave: NotePageLifeStore["leave"];
  readonly shown: boolean;
  readonly ready: boolean;
}

export interface NotePageOptions {
  readonly focus: boolean;
  readonly deep: boolean;
}

export const useNotePage = (itemId: string, { deep, focus }: NotePageOptions) => {
  const library = useLibrary();
  const queryClient = useQueryClient();
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [actions] = useState(() => noteActions({ itemId, library, openItem, queryClient }));
  const offline = !useOnline();
  const [moved, setMoved] = useState<MovedItems>({ ids: [], seq: 0 });
  const [kept, setKept] = useState<{ readonly note: UnsentNote | null } | null>(null);

  useEffect(() => {
    let current = true;

    void (async () => {
      const [read] = await Promise.allSettled([library.unsent.read(itemId)]);

      if (current) {
        setKept({ note: read.status === "fulfilled" ? read.value : null });
      }
    })();

    return () => {
      current = false;
    };
  }, [library, itemId]);

  useEffect(
    () =>
      library.onItems((ids) => {
        setMoved((before) => ({ ids: ids === null ? null : [...ids], seq: before.seq + 1 }));
      }),
    [library],
  );
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [life] = useState(() => notePageLife({ deep }));
  const { asked, life: now } = useSyncExternalStore(life.subscribe, life.get);
  useEffect(() => {
    life.place(deep);
  }, [life, deep]);
  useEffect(() => {
    if (!offline) {
      life.reconnected();
    }
  }, [life, offline]);

  const keepUnsent: PageProps["keepUnsent"] = async (id, note) => {
    await actions.keepUnsent(id, note);

    if (id === itemId) {
      setKept({ note });
    }
  };

  return {
    guarded: now.kind === "editing" || now.kind === "asking",
    leave: life.leave,
    props: {
      ...actions,
      focus,
      itemId,
      keepUnsent,
      moved,
      noteState: life.report,
      offline,
      settle: asked,
      settled: life.answer,
      unsent: kept?.note ?? null,
    },
    ready: kept !== null,
    shown: now.kind !== "released",
  } satisfies NotePage;
};
