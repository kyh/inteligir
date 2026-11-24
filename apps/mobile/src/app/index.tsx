import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { FetchStatus } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CHIP_ORDER,
  KIND_CHIP_LABELS,
  saveFolderOf,
  scopeTitle,
} from "@repo/client/library-labels";
import { listingView } from "@repo/client/listing-view";
import { UNREACHABLE } from "@repo/contract/rpc/call-outcome";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import { listedScope } from "@repo/contract/library-scope";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { shownTitle } from "@repo/contract/items/item-name";
import { ingestPhoto } from "@/items/photo-ingest";
import type { SaveOutcome } from "@/items/phone-saves";
import { useLibrary, useMoveToDeleted } from "@/runtime/library-hooks";
import { openConversations, openItem, openViewer } from "@/lib/routes";
import { screenStyle, SPACE, useTheme } from "@/lib/theme";
import { LibraryCardRow } from "@/library/library-card";
import type { ListedItem } from "@/library/library-card";
import { listingPage } from "@/library/library-query";
import { UnsentBanner } from "@/library/unsent-banner";
import { confirmSignOut } from "@/runtime/confirm-sign-out";
import { online } from "@/ui/needs-connection";

const SEARCH_PAUSE_MS = 300;

const NOT_SAVED = `${UNREACHABLE} Try again once it can.`;

const openRow = (row: ListedItem) => {
  if (row.fields.kind === "image" || row.fields.kind === "pdf") {
    openViewer(row.id);

    return;
  }

  openItem(row.id);
};

const saidIfNotSaved = (saved: SaveOutcome): saved is Extract<SaveOutcome, { kind: "landed" }> => {
  if (saved.kind === "refused") {
    Alert.alert("Couldn't save", saved.message);
  } else if (saved.kind !== "landed") {
    Alert.alert("Couldn't save", NOT_SAVED);
  }

  return saved.kind === "landed";
};

const SaveField = ({ scope }: { scope: LibraryScope }) => {
  const { queries, saves } = useLibrary();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const save = () => {
    if (draft.trim() === "" || saving) {
      return;
    }

    if (!online()) {
      return;
    }

    void (async () => {
      setSaving(true);
      const saved = await saves.saveText(draft, { parentId: saveFolderOf(scope) });
      setSaving(false);

      if (!saidIfNotSaved(saved)) {
        return;
      }

      setDraft("");
      void queryClient.invalidateQueries({ queryKey: queries.library.listing.key() });

      if (!saved.answer.created) {
        Alert.alert("Already in your library", undefined, [
          { style: "cancel", text: "OK" },
          {
            onPress: () => {
              openItem(saved.answer.id);
            },
            text: "Open",
          },
        ]);
      }
    })();
  };

  return (
    <View className="flex-row items-center gap-3">
      <TextInput
        accessibilityLabel="Save a link or a thought"
        className="grow basis-0 rounded-lg border border-input bg-card px-3 py-2 text-16 text-foreground placeholder:text-muted-foreground"
        placeholder="Save a link or a thought"
        value={draft}
        editable={!saving}
        autoCapitalize="none"
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onChangeText={setDraft}
        onSubmitEditing={save}
      />
      <Pressable accessibilityRole="button" disabled={saving} hitSlop={SPACE.sm} onPress={save}>
        <Text className="text-16 font-semibold text-foreground">Save</Text>
      </Pressable>
    </View>
  );
};

const KindChips = ({
  kinds,
  toggle,
}: {
  kinds: ReadonlySet<ItemKind>;
  toggle: (kind: ItemKind) => void;
}) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerClassName="gap-2 py-2"
  >
    {CHIP_ORDER.map((kind) => {
      const on = kinds.has(kind);

      return (
        <Pressable
          key={kind}
          accessibilityRole="button"
          accessibilityState={{ selected: on }}
          className={`rounded-full border px-3 py-1 active:opacity-70 ${on ? "border-primary bg-primary" : "border-border bg-card"}`}
          onPress={() => {
            toggle(kind);
          }}
        >
          <Text className={`text-14 ${on ? "text-primary-foreground" : "text-foreground"}`}>
            {KIND_CHIP_LABELS[kind]}
          </Text>
        </Pressable>
      );
    })}
  </ScrollView>
);

const usePaused = (words: string) => {
  const [paused, setPaused] = useState(words);
  useEffect(() => {
    const timer = setTimeout(() => {
      setPaused(words);
    }, SEARCH_PAUSE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [words]);

  return paused;
};

const emptyLabel = (
  listing: { isPending: boolean; isError: boolean; fetchStatus: FetchStatus },
  filtered: boolean,
) => {
  if (listing.isError) {
    return UNREACHABLE;
  }

  if (listing.isPending) {
    return listing.fetchStatus === "paused" ? NEEDS_CONNECTION : "Loading your library…";
  }

  return filtered
    ? "Nothing here matches."
    : "Nothing saved yet. Share a page to Inteligir, or type a link or a thought above.";
};

const LibraryScreen = () => {
  const theme = useTheme();
  const { newId, queries, saves } = useLibrary();
  const queryClient = useQueryClient();
  const [chosenScope, setChosenScope] = useState<LibraryScope>({ kind: "all" });
  const [kinds, setKinds] = useState<ReadonlySet<ItemKind>>(() => new Set());
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const scopes = useQuery(queries.library.listing.scopes.queryOptions());
  const containers = scopes.data?.containers ?? [];
  const scope = scopes.data === undefined ? chosenScope : listedScope(chosenScope, containers);
  const words = usePaused(query.trim());

  const listing = useInfiniteQuery(
    queries.library.listing.page.infiniteOptions({
      getNextPageParam: (page) => page.cursor ?? undefined,
      initialPageParam: undefined,
      input: (cursor: number | undefined) => listingPage({ kinds, scope, words }, cursor),
      placeholderData: keepPreviousData,
    }),
  );

  const rows = listingView(listing.data?.pages ?? [])?.items ?? [];

  const changedItems = async () => {
    await queryClient.invalidateQueries({ queryKey: queries.library.key() });
  };

  const moveToDeleted = useMoveToDeleted();

  const restore = useMutation(
    queries.library.items.restore.mutationOptions({ onSettled: changedItems }),
  );

  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([listing.refetch(), scopes.refetch()]);
    setRefreshing(false);
  };

  const toggleKind = (kind: ItemKind) => {
    setKinds((held) => {
      const next = new Set(held);

      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }

      return next;
    });
  };

  const newNote = async () => {
    if (!online()) {
      return;
    }

    const made = await saves.newNote({ parentId: saveFolderOf(scope) });

    if (saidIfNotSaved(made)) {
      void changedItems();
      openItem(made.answer.id, { focus: true });
    }
  };

  const addPhoto = async () => {
    if (!online()) {
      return;
    }

    const added = await ingestPhoto(saves, saveFolderOf(scope));

    if (added.kind === "refused") {
      Alert.alert("Couldn't add the photo", added.message);
    } else if (added.kind === "picked") {
      void changedItems();
      openViewer(added.itemId);
    }
  };

  const restoreRow = async (row: ListedItem) => {
    if (!online()) {
      return;
    }

    try {
      const { addressHeld } = await restore.mutateAsync({ ids: [row.id], opId: newId() });

      if (addressHeld.length > 0) {
        Alert.alert(
          "Couldn't restore",
          "Another item already holds this address. Delete it and try again.",
        );
      }
    } catch (error) {
      Alert.alert("Couldn't restore", refusalText(error, UNREACHABLE));
    }
  };

  const rowActions = (row: ListedItem) => {
    const deleted = row.fields.deletedAt !== null;
    const options = ["Cancel", "Open", deleted ? "Restore" : "Move to Deleted"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 0,
        destructiveButtonIndex: deleted ? undefined : 2,
        options,
        title: shownTitle(row.card.title),
      },
      (index) => {
        if (index === 1) {
          openRow(row);
        } else if (index === 2) {
          void (deleted ? restoreRow(row) : moveToDeleted(row.id));
        }
      },
    );
  };

  const filtered = scope.kind !== "all" || kinds.size > 0 || query.trim() !== "";

  return (
    <SafeAreaView style={screenStyle(theme)} edges={["left", "right"]}>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            autoCapitalize: "none",
            hideWhenScrolling: true,
            onChangeText: (event) => {
              setQuery(event.nativeEvent.text);
            },
            placeholder: "Search your library",
          },
          title: scopeTitle(scope, containers, "Library"),
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu accessibilityLabel="Library" icon="line.3.horizontal.decrease.circle">
          <Stack.Toolbar.Menu inline title="Show">
            <Stack.Toolbar.MenuAction
              isOn={scope.kind === "all"}
              onPress={() => {
                setChosenScope({ kind: "all" });
              }}
            >
              All items
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              isOn={scope.kind === "unsorted"}
              onPress={() => {
                setChosenScope({ kind: "unsorted" });
              }}
            >
              Unsorted
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.Menu title="Folders" hidden={containers.length === 0}>
              {containers.map((container) => (
                <Stack.Toolbar.MenuAction
                  key={container.id}
                  icon={container.kind === "list" ? "list.bullet" : "folder"}
                  isOn={scope.kind === "parent" && scope.parentId === container.id}
                  onPress={() => {
                    setChosenScope({ kind: "parent", parentId: container.id });
                  }}
                >
                  {container.title}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.MenuAction
              isOn={scope.kind === "deleted"}
              onPress={() => {
                setChosenScope({ kind: "deleted" });
              }}
            >
              Deleted
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction
            hidden={scope.kind === "deleted"}
            onPress={() => {
              void newNote();
            }}
          >
            New note
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            hidden={scope.kind === "deleted"}
            onPress={() => {
              void addPhoto();
            }}
          >
            Add a photo
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction onPress={openConversations}>
            Ask the agent
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            destructive
            onPress={() => {
              void confirmSignOut();
            }}
          >
            Sign out
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <FlatList
        className="grow basis-0"
        contentContainerClassName="px-4 pt-3 pb-8"
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void refresh();
            }}
          />
        }
        data={rows}
        keyExtractor={(row) => row.id}
        onEndReached={() => {
          if (listing.hasNextPage && !listing.isFetchingNextPage) {
            void listing.fetchNextPage();
          }
        }}
        ListHeaderComponent={
          <>
            <UnsentBanner />
            {scope.kind === "deleted" ? null : <SaveField scope={scope} />}
            <KindChips kinds={kinds} toggle={toggleKind} />
          </>
        }
        ListEmptyComponent={
          <View className="items-center gap-2 px-6 py-24">
            <Text className="text-center text-16 text-muted-foreground">
              {emptyLabel(listing, filtered)}
            </Text>
          </View>
        }
        renderItem={({ item: row }) => (
          <LibraryCardRow
            row={row}
            onPress={() => {
              openRow(row);
            }}
            onLongPress={() => {
              rowActions(row);
            }}
          />
        )}
      />
    </SafeAreaView>
  );
};

export default LibraryScreen;
