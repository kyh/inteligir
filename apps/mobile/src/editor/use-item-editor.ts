// One item's page per mount: the WebView's ref and the nonce the page loaded under belong to its
// host, whose questions the item's ports answer from the replica, and the replica's change feed
// reaches the page as `itemChanged`, the merges that kept this phone's lines named, so the page
// reads its item again and says so. Every way off the screen writes what the page holds while it
// still runs to answer.

import { useFocusEffect, useNavigation } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router";
import type { ParamListBase } from "expo-router/react-navigation";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { mintBridgeNonce } from "@/lib/app-runtime";
import { useLibrary } from "@/lib/library-hooks";
import { createEditorHost } from "./editor-host";
import type { EditorHost, EditorHostArgs } from "./editor-host";
import { createItemPorts } from "./item-ports";
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
  const { replica } = useLibrary();
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [editor] = useState((): ItemEditor => {
    const source = editorPageSource();
    const host = createEditorHost({
      init,
      mintNonce: mintBridgeNonce,
      onEvent,
      pageUrl: source?.uri ?? "",
      ports: createItemPorts({ now: () => Date.now(), replica }),
    });
    return { host, source };
  });

  // the page reads its item again when the replica says it moved
  useEffect(
    () =>
      replica.onChange((change) => {
        editor.host.send({
          ids: [...change.ids],
          overlapped: [...change.overlapped],
          reset: change.reset,
          type: "itemChanged",
        });
      }),
    [editor, replica],
  );
  // the body this item waits on comes first
  useEffect(() => {
    replica.focus(init.itemId);
    return () => {
      replica.focus(null);
    };
  }, [init.itemId, replica]);
  useFlushOnLeave(editor.host);

  return editor;
};
