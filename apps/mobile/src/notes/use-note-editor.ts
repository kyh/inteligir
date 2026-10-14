import { useFocusEffect, useNavigation } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router";
import type { ParamListBase } from "expo-router/react-navigation";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { createEditorHost } from "@/editor/editor-host";
import type { EditorHost, EditorHostArgs } from "@/editor/editor-host";
import type { EditorPorts } from "@/editor/editor-ports";
import { editorPageSource } from "@/editor/page-source";
import type { PageSource } from "@/editor/page-source";
import { createNoteEditorPorts, mintBridgeNonce } from "@/lib/app-runtime";

type EditorScreen = Parameters<typeof createNoteEditorPorts>[0];

export interface NoteEditor {
  // null for a build made without the page, which has no editor to open
  readonly source: PageSource | null;
  readonly ports: EditorPorts;
  readonly host: EditorHost;
}

// every way off the screen writes what the page holds while the page still runs to answer
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

// One editor page per mount: the WebView's ref and the nonce the page loaded under belong to its
// host. `init` and `screen` are read on the first render alone, so every callback must be stable,
// a state setter or a module function, never a closure over a render's values.
export const useNoteEditor = (init: EditorHostArgs["init"], screen: EditorScreen): NoteEditor => {
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [editor] = useState((): NoteEditor => {
    const source = editorPageSource();
    const ports = createNoteEditorPorts(screen);
    const host = createEditorHost({
      init,
      mintNonce: mintBridgeNonce,
      onEvent: ports.handle,
      pageUrl: source?.uri ?? "",
      ports: ports.requests,
    });
    return { host, ports, source };
  });

  useEffect(() => editor.ports.watch(editor.host.send), [editor]);
  useFlushOnLeave(editor.host);

  return editor;
};
