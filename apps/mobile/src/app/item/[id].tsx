// An item in the editor page, by its id, over the account's library: its blocks drawn by the
// desktop's editor through the touch kit, read-only on the phone, as the cloud holds them or as the
// phone last read them. The menu opens the page it was saved from, its Info, a conversation about
// it with the built-in agent, and Delete, which moves it to Deleted on every device.

import { router, Stack, useLocalSearchParams, useRoute } from "expo-router";
import { useHeaderHeight, useNavigationState } from "expo-router/react-navigation";
import { onlineManager, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { UNREACHABLE } from "@repo/contract/library/call-outcome";
import { NEEDS_CONNECTION, refusalText } from "@repo/contract/refusal-text";
import { shownTitle } from "@repo/contract/items/item-name";
import { loadVerdict, openWindowVerdict } from "@/editor/editor-host";
import type { EditorPageEvent, LoadVerdict } from "@/editor/editor-host";
import { useItemEditor } from "@/editor/use-item-editor";
import { ItemInfoSheet } from "@/items/item-info-sheet";
import { useItem, useLibrary } from "@/lib/library-hooks";
import { firstParam, openAgent, openItem } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import { UnsentBanner } from "@/library/unsent-banner";

const screenOf = (background: string) => ({ backgroundColor: background, flex: 1 });

// the WebView hands anything its list does not admit to the OS itself, before the policy below
// runs, so the list admits every address and the policy is the one rule (editor-host.ts)
const EVERY_ORIGIN = ["*"];

// past this many screens above it, an item's page lets its WebView go; it loads again on the way
// back
const RELEASE_DEPTH = 2;

const depthOf = (routes: readonly { key: string }[], key: string): number => {
  const index = routes.findIndex((route) => route.key === key);
  return index === -1 ? 0 : routes.length - 1 - index;
};

const openOutside = async (url: string): Promise<void> => {
  try {
    await Linking.openURL(url);
  } catch {
    // no app takes the link; the WebView stays on the page either way
  }
};

const followVerdict = (verdict: LoadVerdict): boolean => {
  if (verdict.kind === "open-outside") {
    void openOutside(verdict.url);
  }
  return verdict.kind === "allow";
};

// a link the person followed in the page opens its item on the native stack
const followLink = (event: EditorPageEvent): void => {
  openItem(event.itemId);
};

const ItemScreen = () => {
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const params = useLocalSearchParams<{ id: string }>();
  const itemId = firstParam(params.id) ?? "";
  const route = useRoute();
  const depth = useNavigationState((state) => depthOf(state.routes, route.key));
  const { newId, queries } = useLibrary();
  const queryClient = useQueryClient();
  const read = useItem(itemId);
  const item = read.kind === "held" ? read.item : null;
  const folders = useQuery(queries.library.listing.scopes.queryOptions()).data?.folders ?? [];
  const remove = useMutation(
    queries.library.items.delete.mutationOptions({
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: queries.library.key() });
      },
    }),
  );
  const [showInfo, setShowInfo] = useState(false);
  const { host, source } = useItemEditor({ itemId }, followLink);
  const { attach: attachView } = host;

  const moveToDeleted = (): void => {
    if (!onlineManager.isOnline()) {
      Alert.alert(NEEDS_CONNECTION, "An item moves to Deleted once your library can be reached.");
      return;
    }
    Alert.alert(
      "Move to Deleted?",
      "It leaves your library on every device, and you can restore it from Deleted.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void (async () => {
              try {
                await remove.mutateAsync({ ids: [itemId], opId: newId() });
                router.back();
              } catch (error) {
                Alert.alert("Couldn't move it to Deleted", refusalText(error, UNREACHABLE));
              }
            })();
          },
          style: "destructive",
          text: "Move to Deleted",
        },
      ],
    );
  };

  const url = item?.fields.url ?? null;
  let body = null;
  if (source === null) {
    body = (
      <Text className="px-6 py-24 text-center text-16 text-muted-foreground">
        This build has no editor to open items with.
      </Text>
    );
  } else if (read.kind === "missing") {
    body = (
      <Text className="px-6 py-24 text-center text-16 text-muted-foreground">
        This item is not in your library.
      </Text>
    );
  } else if (read.kind === "unreachable") {
    body = (
      <Text className="px-6 py-24 text-center text-16 text-muted-foreground">{UNREACHABLE}</Text>
    );
  } else if (depth < RELEASE_DEPTH) {
    body = (
      <WebView
        ref={attachView}
        style={screenOf(theme.background)}
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
        onContentProcessDidTerminate={() => {
          host.reload();
        }}
        hideKeyboardAccessoryView
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        decelerationRate="normal"
        webviewDebuggingEnabled={__DEV__}
      />
    );
  }

  return (
    <SafeAreaView style={screenOf(theme.background)} edges={["left", "right"]}>
      <Stack.Screen
        options={{
          title: item === null ? "" : shownTitle(item.card.title),
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu
          accessibilityLabel="More"
          hidden={read.kind === "missing"}
          icon="ellipsis.circle"
        >
          <Stack.Toolbar.MenuAction
            hidden={url === null}
            onPress={() => {
              if (url !== null) {
                void openOutside(url);
              }
            }}
          >
            Open original
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            onPress={() => {
              setShowInfo(true);
            }}
          >
            Info
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            onPress={() => {
              openAgent(undefined, itemId);
            }}
          >
            Ask the agent
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction destructive onPress={moveToDeleted}>
            Delete
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <UnsentBanner className="px-4 pt-2" />
      <KeyboardAvoidingView
        className="grow basis-0"
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        {body}
      </KeyboardAvoidingView>
      <ItemInfoSheet
        fields={item?.fields ?? null}
        folders={folders}
        visible={showInfo}
        onClose={() => {
          setShowInfo(false);
        }}
      />
    </SafeAreaView>
  );
};

export default ItemScreen;
