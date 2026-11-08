// One item's page per mount: the WebView's ref and the nonce the page loaded under belong to its
// host, whose questions the item's ports answer from the account's library. The item's query
// moving to a sequence no write of this page's made reaches the page as `itemChanged`, so it reads
// its item again, and so does another item's name moving, so a link shows the name its item goes
// by now; the connection coming or going reaches it as `connection`. Every way off the screen
// writes what the page holds while it still runs to answer.

import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useNavigation } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router";
import type { ParamListBase } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { mintBridgeNonce } from "@/lib/app-runtime";
import { useItem, useLibrary } from "@/lib/library-hooks";
import { createEditorHost } from "./editor-host";
import type { EditorHost, EditorHostArgs } from "./editor-host";
import { createItemPorts, renamedTargets } from "./item-ports";
import { editorPageSource } from "./page-source";
import type { PageSource } from "./page-source";

export interface ItemEditor {
  // null for a build made without the page, which has no editor to open
  readonly source: PageSource | null;
  readonly host: EditorHost;
}

const useFlushOnLeave = (host: EditorHost): void => {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();

  useFocusEffect(
    useCallback(
      () => () => {
        void host.flush();
      },
      [host],
    ),
  );

  // the back gesture starts here, while the page still runs
  useEffect(
    () =>
      navigation.addListener("transitionStart", (event) => {
        if (event.data.closing) {
          void host.flush();
        }
      }),
    [navigation, host],
  );

  // `inactive` comes first on the way out (the app switcher, a call), while the page still runs
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        void host.flush();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [host]);
};

// `init` and `onEvent` are read on the first render alone, so every callback must be stable, a
// state setter or a module function, never a closure over a render's values
export const useItemEditor = (
  init: EditorHostArgs["init"],
  onEvent: EditorHostArgs["onEvent"],
): ItemEditor => {
  const library = useLibrary();
  const queryClient = useQueryClient();
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [editor] = useState(() => {
    const source = editorPageSource();
    // the sequences this page's own writes left the item at
    const wrote = new Set<number>();
    const host = createEditorHost({
      init,
      mintNonce: mintBridgeNonce,
      onEvent,
      online: () => onlineManager.isOnline(),
      pageUrl: source?.uri ?? "",
      ports: createItemPorts({
        library,
        queryClient,
        wrote: (itemId, seq) => {
          if (itemId === init.itemId) {
            wrote.add(seq);
          }
        },
      }),
    });
    return { host, source, wrote };
  });

  const read = useItem(init.itemId);
  const seq = read.kind === "held" ? read.item.seq : null;
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = seq;
    if (seq === null || before === null || before === seq || editor.wrote.has(seq)) {
      return;
    }
    editor.host.send({ ids: [init.itemId], overlapped: [], reset: false, type: "itemChanged" });
  }, [editor, init.itemId, seq]);

  const titles = useQuery(library.queries.library.listing.titles.queryOptions()).data?.targets;
  const seenTitles = useRef(titles);
  useEffect(() => {
    const before = seenTitles.current;
    seenTitles.current = titles;
    if (before === undefined || titles === undefined || before === titles) {
      return;
    }
    const renamed = renamedTargets(before, titles, init.itemId);
    if (renamed.length > 0) {
      editor.host.send({ ids: renamed, overlapped: [], reset: false, type: "itemChanged" });
    }
  }, [editor, init.itemId, titles]);

  useEffect(
    () =>
      onlineManager.subscribe((online) => {
        editor.host.send({ online, type: "connection" });
      }),
    [editor],
  );
  useFlushOnLeave(editor.host);

  return editor;
};
