// An item, by its id, over the account's library: its note in the editor every device draws, in a
// web view of its own (note-page.tsx), live with the other devices while there is a connection, and
// read-only under the words every screen says while there is none. The menu opens the page it was
// saved from, its Info, a conversation about it with the built-in agent, and Delete, which moves it
// to Deleted on every device. While the note is being edited, a leave waits until the note holds
// every edit made here, or the person says to discard them.

import { router, Stack, useLocalSearchParams, useNavigation, useRoute } from "expo-router";
import {
  useHeaderHeight,
  useNavigationState,
  usePreventRemove,
} from "expo-router/react-navigation";
import { onlineManager, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UNREACHABLE } from "@repo/contract/library/call-outcome";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { refusalText } from "@repo/contract/refusal-text";
import { shownTitle } from "@repo/contract/items/item-name";
import NotePage from "@/editor/page/note-page";
import { useNotePage } from "@/editor/use-note-page";
import { loadVerdict, openWindowVerdict } from "@/editor/web-view-policy";
import type { LoadVerdict } from "@/editor/web-view-policy";
import { ItemInfoSheet } from "@/items/item-info-sheet";
import { useItem, useLibrary } from "@/lib/library-hooks";
import { FOCUS, firstParam, openAgent } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import { UnsentBanner } from "@/library/unsent-banner";

const screenOf = (background: string) => ({ backgroundColor: background, flex: 1 });

// the web view hands anything its list does not admit to the OS itself, before the policy below
// runs, so the list admits every address and the policy is the one rule (web-view-policy.ts)
const EVERY_ORIGIN = ["*"];

// past this many screens above it, an item lets its web view go once the note holds every edit
// made here; it loads again on the way back
const RELEASE_DEPTH = 2;

// the words the library's tab asks a leave in (apps/web/src/library/item/leave-item.ts)
const LEAVE_TITLE = "Leave without saving?";
const LEAVE_BODY =
  "Some of what you typed here hasn't reached your library, since there's no connection. Leave now and it's lost.";

const depthOf = (routes: readonly { key: string }[], key: string): number => {
  const index = routes.findIndex((route) => route.key === key);
  return index === -1 ? 0 : routes.length - 1 - index;
};

const openOutside = async (url: string): Promise<void> => {
  try {
    await Linking.openURL(url);
  } catch {
    // no app takes the link; the web view stays on the page either way
  }
};

const followVerdict = (verdict: LoadVerdict): boolean => {
  if (verdict.kind === "open-outside") {
    void openOutside(verdict.url);
  }
  return verdict.kind === "allow";
};

const ItemScreen = () => {
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
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
  const page = useNotePage(itemId, {
    deep: depth >= RELEASE_DEPTH,
    focus: firstParam(params.focus) === FOCUS,
  });
  const { guarded, leave } = page;

  usePreventRemove(guarded, ({ data }) => {
    leave(
      () => {
        navigation.dispatch(data.action);
      },
      (discard) => {
        Alert.alert(LEAVE_TITLE, LEAVE_BODY, [
          { style: "cancel", text: "Stay" },
          { onPress: discard, style: "destructive", text: "Discard edits" },
        ]);
      },
    );
  });

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
  if (read.kind === "missing") {
    body = (
      <Text className="px-6 py-24 text-center text-16 text-muted-foreground">
        This item is not in your library.
      </Text>
    );
  } else if (read.kind === "unreachable") {
    body = (
      <Text className="px-6 py-24 text-center text-16 text-muted-foreground">{UNREACHABLE}</Text>
    );
  } else if (page.shown) {
    body = (
      <NotePage
        {...page.props}
        dom={{
          allowFileAccessFromFileURLs: false,
          allowsLinkPreview: false,
          contentInsetAdjustmentBehavior: "never",
          dataDetectorTypes: "none",
          decelerationRate: "normal",
          hideKeyboardAccessoryView: true,
          keyboardDisplayRequiresUserAction: false,
          onOpenWindow: (event) => {
            followVerdict(openWindowVerdict(event.nativeEvent.targetUrl));
          },
          onShouldStartLoadWithRequest: (request) => followVerdict(loadVerdict(request, __DEV__)),
          originWhitelist: EVERY_ORIGIN,
          style: screenOf(theme.background),
          useExpoDOMWebView: false,
          webviewDebuggingEnabled: __DEV__,
        }}
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
