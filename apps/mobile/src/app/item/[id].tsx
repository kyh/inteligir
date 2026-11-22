import { router, Stack, useLocalSearchParams, useNavigation, useRoute } from "expo-router";
import {
  useHeaderHeight,
  useNavigationState,
  usePreventRemove,
} from "expo-router/react-navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UNREACHABLE } from "@repo/contract/rpc/call-outcome";
import { shownTitle } from "@repo/contract/items/item-name";
import NotePage from "@/editor/page/note-page";
import { useNotePage } from "@/editor/use-note-page";
import { EVERY_ORIGIN, loadVerdict, openWindowVerdict } from "@/editor/web-view-policy";
import type { LoadVerdict } from "@/editor/web-view-policy";
import { ItemInfoSheet } from "@/items/item-info-sheet";
import type { InfoFolder } from "@/items/item-info-sheet";
import { useItem, useLibrary, useMoveToDeleted } from "@/lib/library-hooks";
import { FOCUS, firstParam, openAgent } from "@/lib/routes";
import { screenStyle, useTheme } from "@/lib/theme";
import { UnsentBanner } from "@/library/unsent-banner";
import { online } from "@/ui/needs-connection";

const RELEASE_DEPTH = 2;

const LEAVE_TITLE = "Leave without saving?";
const LEAVE_BODY = "Some of what you typed hasn't saved yet. Leave now and it's lost.";

const depthOf = (routes: readonly { key: string }[], key: string) => {
  const index = routes.findIndex((route) => route.key === key);

  return index === -1 ? 0 : routes.length - 1 - index;
};

const openOutside = async (url: string) => {
  await Promise.allSettled([Linking.openURL(url)]);
};

const followVerdict = (verdict: LoadVerdict) => {
  if (verdict.kind === "open-outside") {
    void openOutside(verdict.url);
  }

  return verdict.kind === "allow";
};

interface HeldParent {
  readonly id: string;
  readonly card: { readonly title: string };
  readonly fields: { readonly parentId: string | null; readonly deletedAt: number | null };
}

const filedPlace = (
  containers: readonly InfoFolder[],
  parent: HeldParent | undefined,
  parentId: string | null,
) => {
  if (parent === undefined) {
    return { folders: containers, parentId };
  }

  if (parent.fields.deletedAt !== null) {
    return { folders: containers, parentId: null };
  }

  return {
    folders: [
      ...containers,
      { id: parent.id, parentId: parent.fields.parentId, title: shownTitle(parent.card.title) },
    ],
    parentId,
  };
};

const ItemScreen = () => {
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
  const itemId = firstParam(params.id) ?? "";
  const route = useRoute();
  const depth = useNavigationState((state) => depthOf(state.routes, route.key));
  const { queries } = useLibrary();
  const read = useItem(itemId);
  const item = read.kind === "held" ? read.item : null;
  const containers = useQuery(queries.library.listing.scopes.queryOptions()).data?.containers ?? [];
  const parentId = item?.fields.parentId ?? null;
  const parentNoted = parentId !== null && !containers.some(({ id }) => id === parentId);

  const parentNote = useQuery({
    ...queries.library.items.row.queryOptions({ input: { id: parentId ?? "" } }),
    enabled: parentNoted,
  }).data;

  const filed = filedPlace(containers, parentNoted ? parentNote : undefined, parentId);

  const moveToDeleted = useMoveToDeleted();
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
          { onPress: discard, style: "destructive", text: "Leave anyway" },
        ]);
      },
    );
  });

  const confirmDelete = () => {
    if (!online()) {
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
              if (await moveToDeleted(itemId)) {
                router.back();
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
  } else if (page.shown && page.ready) {
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
          style: screenStyle(theme),
          useExpoDOMWebView: false,
          webviewDebuggingEnabled: __DEV__,
        }}
      />
    );
  }

  return (
    <SafeAreaView style={screenStyle(theme)} edges={["left", "right"]}>
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
            hidden={item === null}
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
          <Stack.Toolbar.MenuAction destructive onPress={confirmDelete}>
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
      {item === null ? null : (
        <ItemInfoSheet
          fields={{ ...item.fields, parentId: filed.parentId }}
          folders={filed.folders}
          visible={showInfo}
          onClose={() => {
            setShowInfo(false);
          }}
        />
      )}
    </SafeAreaView>
  );
};

export default ItemScreen;
