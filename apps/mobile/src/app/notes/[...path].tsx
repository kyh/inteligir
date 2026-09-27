import {
  router,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRoute,
} from "expo-router";
import type { NativeStackNavigationProp } from "expo-router";
import {
  useHeaderHeight,
  useNavigationState,
  usePreventRemove,
} from "expo-router/react-navigation";
import type { ParamListBase } from "expo-router/react-navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { PageInit } from "@repo/mobile-editor/bridge-protocol";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { createEditorHost, loadVerdict, openWindowVerdict } from "@/editor/editor-host";
import type { LoadVerdict } from "@/editor/editor-host";
import type { EditorRoute, PageEditorState } from "@/editor/editor-ports";
import { editorPageSource } from "@/editor/page-source";
import {
  createNoteEditorPorts,
  deleteNote,
  mintBridgeNonce,
  readNote,
  readNoteComments,
} from "@/lib/app-runtime";
import { firstParam, openNote, openThread } from "@/lib/routes";
import type { ThreadParams } from "@/lib/routes";
import { SPACE, useTheme } from "@/lib/theme";
import type { CommentOutcome } from "@/notes/comment-ops";
import { CommentsSheet } from "@/notes/comments-view";
import type { CommentEdits } from "@/notes/comments-view";
import { confirmDeleteNote } from "@/notes/confirm-delete-note";
import type { CommentsRead } from "@/notes/notes-store";
import { OutboxBanner } from "@/notes/outbox-banner";

const styles = StyleSheet.create({
  action: { fontSize: 16, fontWeight: "600" },
  banner: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm },
  failed: {
    alignItems: "center",
    gap: SPACE.lg,
    paddingHorizontal: SPACE.xxl,
    paddingVertical: 96,
  },
  failedText: { fontSize: 16, textAlign: "center" },
  pressed: { opacity: 0.7 },
  screen: { flex: 1 },
  status: { fontSize: 16, paddingHorizontal: SPACE.xxl, paddingVertical: 96, textAlign: "center" },
});

// the WebView hands anything its list does not admit to the OS itself, before the handler below
// runs, so the list admits every address and `loadVerdict` is the one policy
const EVERY_ORIGIN = ["*"];

// one screen down is what the back gesture reveals, so it keeps its page; further down a page holds
// a WebView's memory for nothing on screen, and loads again when the user comes back
const RELEASE_DEPTH = 2;

const focusOf = (value: string | null): PageInit["focus"] =>
  value === "title" || value === "body" ? value : null;

// how many screens sit above this one in its stack
const depthOf = (routes: readonly { key: string }[], key: string): number => {
  const index = routes.findIndex((route) => route.key === key);
  return index === -1 ? 0 : routes.length - 1 - index;
};

const openOutside = async (url: string): Promise<void> => {
  try {
    await Linking.openURL(url);
  } catch {
    // no handler for the URL is the OS's answer, not an app error
  }
};

const followVerdict = (verdict: LoadVerdict): boolean => {
  if (verdict.kind === "open-outside") {
    void openOutside(verdict.url);
  }
  return verdict.kind === "allow";
};

const pushRoute = (route: EditorRoute): void => {
  if (route.kind === "note") {
    openNote(route.path);
    return;
  }
  const params: ThreadParams = { id: route.threadId, note: route.note };
  if (route.quote.trim() !== "") {
    params.quote = route.quote;
  }
  if (route.revision !== null) {
    params.revision = route.revision;
  }
  openThread(params);
};

type SaveError = NonNullable<PageEditorState["saveError"]>;

const unsavedLine = (error: SaveError): string =>
  error.kind === "vanished"
    ? "This note was deleted while it had edits that are not saved."
    : `Your last edits couldn't be saved: ${error.message}`;

// the note's comments, folded against the markers its text holds now
const loadComments = async (path: string): Promise<CommentsRead> => {
  const read = await readNote(path);
  return read.ok ? await readNoteComments(read) : { message: read.message, ok: false };
};

// One note in the desktop's editor: the page the app bundle carries, in a WebView that reaches the
// phone only through the bridge (editor-host.ts) and loads nothing but itself. Leaving the screen
// or the app writes what the page holds first.
const NoteScreen = () => {
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const params = useLocalSearchParams<{ path: string[]; focus?: string | string[] }>();
  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path ?? "");
  const route = useRoute();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const depth = useNavigationState((state) => depthOf(state.routes, route.key));
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [source] = useState(editorPageSource);
  const [opened, setOpened] = useState<string | null>(path);
  const [sheet, setSheet] = useState<{ ids: readonly string[] | null } | null>(null);
  const [comments, setComments] = useState<CommentsRead | null>(null);
  const [released, setReleased] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [openFailed, setOpenFailed] = useState<string | null>(null);

  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [ports] = useState(() =>
    createNoteEditorPorts({
      editorState: (state) => {
        setSaveError(state.saveError);
      },
      go: pushRoute,
      notify: (title, message) => {
        Alert.alert(title, message);
      },
      openFailed: setOpenFailed,
      opened: setOpened,
      showComments: (ids) => {
        setSheet({ ids });
      },
    }),
  );
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [host] = useState(() =>
    createEditorHost({
      init: { focus: focusOf(firstParam(params.focus)), path },
      mintNonce: mintBridgeNonce,
      onEvent: ports.handle,
      pageUrl: source?.uri ?? "",
      ports: ports.requests,
    }),
  );
  // the WebView's ref, one function for the screen's life: a fresh one each render would detach
  // the view and attach it again, and a detach forgets the loaded page
  const { attach: attachView } = host;

  useEffect(() => ports.watch(host.send), [ports, host]);

  useFocusEffect(
    useCallback(
      () => () => {
        void host.flush();
      },
      [host],
    ),
  );

  // A save the page could not make is held only by the page, so leaving then asks first. An
  // ordinary edit inside the autosave's pause needs no ask: the flush on the way out writes it.
  usePreventRemove(saveError !== null, ({ data }) => {
    const leave = (): void => {
      navigation.dispatch(data.action);
    };
    void (async () => {
      if (saveError === null || (await host.flush())) {
        leave();
        return;
      }
      Alert.alert("Leave without saving?", unsavedLine(saveError), [
        { style: "cancel", text: "Stay" },
        { onPress: leave, style: "destructive", text: "Discard edits" },
      ]);
    })();
  });

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

  const deep = depth >= RELEASE_DEPTH;
  useEffect(() => {
    if (!deep) {
      return;
    }
    let live = true;
    void (async () => {
      // a page whose edits could not be written holds the only copy, so it stays loaded
      const flushed = await host.flush();
      if (live && flushed) {
        setReleased(true);
        // the page loads afresh on the way back, and says again if it cannot open the note
        setOpenFailed(null);
      }
    })();
    return () => {
      live = false;
      setReleased(false);
    };
  }, [deep, host]);

  useEffect(() => {
    if (sheet === null || opened === null) {
      return;
    }
    let live = true;
    void (async () => {
      const threads = await loadComments(opened);
      if (live) {
        setComments(threads);
      }
    })();
    return () => {
      live = false;
      setComments(null);
    };
  }, [sheet, opened]);

  // an edit is on the phone once it answers, so the sheet reads the store again in place rather
  // than going back to Loading under the field being typed in
  const editComments = async (
    change: (path: string) => Promise<CommentOutcome>,
  ): Promise<CommentOutcome> => {
    if (opened === null) {
      return { kind: "refused", message: "This note is no longer on your phone." };
    }
    const outcome = await change(opened);
    if (outcome.kind === "done") {
      setComments(await loadComments(opened));
    }
    return outcome;
  };
  const commentEdits: CommentEdits = {
    reply: async (rootId, text) =>
      await editComments(async (notePath) => await ports.comments.reply(notePath, rootId, text)),
    remove: async (rootId) =>
      await editComments(async (notePath) => {
        const removed = await ports.comments.remove(notePath, rootId);
        return removed.kind === "done" ? { kind: "done" } : removed;
      }),
    resolve: async (rootId, resolved) =>
      await editComments(
        async (notePath) => await ports.comments.resolve(notePath, rootId, resolved),
      ),
  };

  const deleteOpened = (): void => {
    if (opened === null) {
      return;
    }
    confirmDeleteNote(opened, () => {
      void (async () => {
        await host.flush();
        try {
          await deleteNote(opened);
        } catch (error) {
          Alert.alert("Couldn't delete", error instanceof Error ? error.message : String(error));
          return;
        }
        router.back();
      })();
    });
  };

  // a fresh load reads the note again and holds no edits yet; it says again if it still cannot
  const loadPageAgain = (): void => {
    setOpenFailed(null);
    setSaveError(null);
    host.reload();
  };

  let body = null;
  if (source === null) {
    body = (
      <Text style={[styles.status, { color: theme.mutedForeground }]}>
        This build has no editor to open notes with.
      </Text>
    );
  } else if (!released) {
    body = (
      <WebView
        ref={attachView}
        style={[styles.screen, { backgroundColor: theme.background }]}
        source={{ uri: source.uri }}
        allowingReadAccessToURL={source.readAccess}
        originWhitelist={EVERY_ORIGIN}
        onShouldStartLoadWithRequest={(request) => followVerdict(loadVerdict(request, source.uri))}
        onOpenWindow={(event) => {
          followVerdict(openWindowVerdict(event.nativeEvent.targetUrl));
        }}
        onMessage={(event) => {
          host.receive({ data: event.nativeEvent.data, url: event.nativeEvent.url });
        }}
        onContentProcessDidTerminate={loadPageAgain}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        decelerationRate="normal"
        webviewDebuggingEnabled={__DEV__}
      />
    );
  }

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <Stack.Screen options={{ title: opened === null ? "Deleted" : docStem(opened) }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          hidden={opened === null}
          onPress={() => {
            if (opened !== null) {
              void ports.askAgent(opened, "");
            }
          }}
        >
          Ask agent
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Menu
          accessibilityLabel="More"
          hidden={opened === null}
          icon="ellipsis.circle"
        >
          <Stack.Toolbar.MenuAction
            onPress={() => {
              setSheet({ ids: null });
            }}
          >
            Comments
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction destructive onPress={deleteOpened}>
            Delete
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <OutboxBanner style={styles.banner} onOpen={openNote} />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        {body}
        {openFailed === null ? null : (
          <View
            style={[StyleSheet.absoluteFill, styles.failed, { backgroundColor: theme.background }]}
          >
            <Text style={[styles.failedText, { color: theme.mutedForeground }]}>
              {`Couldn't open this note: ${openFailed}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              hitSlop={SPACE.sm}
              style={({ pressed }) => pressed && styles.pressed}
              onPress={loadPageAgain}
            >
              <Text style={[styles.action, { color: theme.foreground }]}>Retry</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
      <CommentsSheet
        comments={comments}
        edits={commentEdits}
        ids={sheet?.ids ?? null}
        visible={sheet !== null}
        onClose={() => {
          setSheet(null);
        }}
      />
    </SafeAreaView>
  );
};

export default NoteScreen;
