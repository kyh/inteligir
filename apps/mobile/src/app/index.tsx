// Home: the account's library, newest first, a page at a time as the list scrolls, and as the phone
// last read it while there is no connection. A scope from the menu (every item, Unsorted, a
// folder, Deleted), the kind chips and the header's search narrow it, the search ranked by the
// cell's own index; the field above saves a link or a thought where the scope saves. Pulling the
// list down reads it again. The menu opens the built-in agent's conversations, which need a
// connection. FlatList, not a ScrollView: a library holds thousands of items and an eager row each
// janks the open.

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
import { CHIP_ORDER, KIND_CHIP_LABELS, saveFolderOf } from "@repo/client/library-labels";
import { UNREACHABLE } from "@repo/contract/library/call-outcome";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { refusalText } from "@repo/contract/refusal-text";
import { listedScope } from "@repo/contract/library-scope";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { shownTitle } from "@repo/contract/items/item-name";
import { ingestPhoto } from "@/items/photo-ingest";
import type { SaveOutcome } from "@/items/phone-saves";
import { useLibrary, useMoveToDeleted } from "@/lib/library-hooks";
import { openConversations, openItem, openViewer } from "@/lib/routes";
import { screenStyle, SPACE, useTheme } from "@/lib/theme";
import { LibraryCardRow } from "@/library/library-card";
import type { ListedItem } from "@/library/library-card";
import { listingPage, scopeTitle } from "@/library/library-query";
import { UnsentBanner } from "@/library/unsent-banner";
import { confirmSignOut } from "@/ui/confirm-sign-out";
import { online } from "@/ui/needs-connection";

// the search waits for a pause in the typing before it asks the cloud
const SEARCH_PAUSE_MS = 300;

// a save that met no connection, or a sign-in that ended under it, said as the screen says it
const NOT_SAVED = `${UNREACHABLE} Try again once it can.`;

// a picture or a PDF opens full size; everything else opens in the editor
const openRow = (row: ListedItem): void => {
  if (row.fields.kind === "image" || row.fields.kind === "pdf") {
    openViewer(row.id);
    return;
  }
  openItem(row.id);
};

// a save the cloud did not take, said; true for one it took
const saidIfNotSaved = (saved: SaveOutcome): saved is Extract<SaveOutcome, { kind: "saved" }> => {
  if (saved.kind === "refused") {
    Alert.alert("Couldn't save", saved.message);
  } else if (saved.kind !== "saved") {
    Alert.alert("Couldn't save", NOT_SAVED);
  }
  return saved.kind === "saved";
};

const SaveField = ({ scope }: { scope: LibraryScope }) => {
  const { queries, saves } = useLibrary();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const save = (): void => {
    if (draft.trim() === "" || saving) {
      return;
    }
    if (!online()) {
      return;
    }
    void (async () => {
      setSaving(true);
      const saved = await saves.saveText(draft, { folderId: saveFolderOf(scope) });
      setSaving(false);
      if (!saidIfNotSaved(saved)) {
        return;
      }
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: queries.library.listing.key() });
      if (!saved.created) {
        Alert.alert("Already in your library", undefined, [
          { style: "cancel", text: "OK" },
          {
            onPress: () => {
              openItem(saved.id);
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

// the words typed, once the typing pauses
const usePaused = (words: string): string => {
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
    // a first read with no connection waits for one rather than fail
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
  const folders = scopes.data?.folders ?? [];
  // a folder deleted on another device reads as every item, so nothing lists under it or saves
  // into it
  const scope = scopes.data === undefined ? chosenScope : listedScope(chosenScope, folders);
  const words = usePaused(query.trim());
  const listing = useInfiniteQuery(
    queries.library.listing.page.infiniteOptions({
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      initialPageParam: undefined,
      input: (cursor: number | undefined) => listingPage({ kinds, scope, words }, cursor),
      placeholderData: keepPreviousData,
    }),
  );
  const rows = listing.data?.pages.flatMap((page) => page.items) ?? [];
  const changedItems = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queries.library.key() });
  };
  const moveToDeleted = useMoveToDeleted();
  const restore = useMutation(
    queries.library.items.restore.mutationOptions({ onSettled: changedItems }),
  );

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    await Promise.allSettled([listing.refetch(), scopes.refetch()]);
    setRefreshing(false);
  };

  const toggleKind = (kind: ItemKind): void => {
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

  const newNote = async (): Promise<void> => {
    if (!online()) {
      return;
    }
    const made = await saves.newNote({ folderId: saveFolderOf(scope) });
    if (saidIfNotSaved(made)) {
      void changedItems();
      openItem(made.id, { focus: true });
    }
  };

  const addPhoto = async (): Promise<void> => {
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

  const restoreRow = async (row: ListedItem): Promise<void> => {
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

  const rowActions = (row: ListedItem): void => {
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
          title: scopeTitle(scope, folders),
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
            <Stack.Toolbar.Menu title="Folders" hidden={folders.length === 0}>
              {folders.map((folder) => (
                <Stack.Toolbar.MenuAction
                  key={folder.id}
                  isOn={scope.kind === "folder" && scope.folderId === folder.id}
                  onPress={() => {
                    setChosenScope({ folderId: folder.id, kind: "folder" });
                  }}
                >
                  {folder.name}
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
