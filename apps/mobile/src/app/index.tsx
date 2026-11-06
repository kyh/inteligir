// Home: the library this phone holds, newest first, offline as online. A scope from the menu (every
// item, Unsorted, a folder, Deleted), the kind chips and the header's search narrow it, the search
// ranked by the replica's own full-text index; the field above saves a link or a thought where the
// scope saves. The menu opens the built-in agent's conversations, which need a connection.
// FlatList, not a ScrollView: a library holds thousands of items and an eager row each janks the
// open.

import { Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import type { LibraryScope } from "@repo/domain/library-scope";
import type { ReplicaListingRow } from "@repo/library-replica/library-replica";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { createPhoneSaves } from "@/items/phone-saves";
import { ingestPhoto } from "@/items/photo-ingest";
import type { SavedItem } from "@/items/phone-saves";
import { newBlockId } from "@/lib/app-runtime";
import { messageOf } from "@/lib/error-message";
import { useLibrary, useListing, useReplicaStatus } from "@/lib/library-hooks";
import { openConversations, openItem, openViewer } from "@/lib/routes";
import { SPACE, useTheme } from "@/lib/theme";
import { LibraryCardRow } from "@/library/library-card";
import { listingQuery, saveFolderOf, scopeTitle } from "@/library/library-query";
import { UnsentBanner } from "@/library/unsent-banner";
import { confirmSignOut } from "@/ui/confirm-sign-out";

// the chips over the list, in the order a person scans them
const KIND_CHIPS: readonly { kind: ItemKind; label: string }[] = [
  { kind: "link", label: "Links" },
  { kind: "video", label: "Videos" },
  { kind: "audio", label: "Audio" },
  { kind: "image", label: "Images" },
  { kind: "pdf", label: "PDFs" },
  { kind: "file", label: "Files" },
  { kind: "note", label: "Notes" },
];

// at most this many hits a search ranks
const SEARCH_HITS = 500;

// a picture or a PDF opens full size; everything else opens in the editor
const openRow = (row: ReplicaListingRow): void => {
  if (row.kind === "image" || row.kind === "pdf") {
    openViewer(row.id);
    return;
  }
  openItem(row.id);
};

const SaveField = ({ scope }: { scope: LibraryScope }) => {
  const { replica } = useLibrary();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const save = (): void => {
    if (draft.trim() === "" || saving) {
      return;
    }
    void (async () => {
      setSaving(true);
      let saved: SavedItem;
      try {
        saved = await createPhoneSaves({ newBlockId, replica }).saveText(draft, {
          folderId: saveFolderOf(scope),
        });
      } catch (error) {
        saved = { kind: "refused", message: messageOf(error) };
      }
      setSaving(false);
      if (saved.kind === "refused") {
        Alert.alert("Couldn't save", saved.message);
        return;
      }
      setDraft("");
      if (saved.made.folded) {
        Alert.alert("Already in your library", undefined, [
          { style: "cancel", text: "OK" },
          {
            onPress: () => {
              openItem(saved.made.id);
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
    {KIND_CHIPS.map(({ kind, label }) => {
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
            {label}
          </Text>
        </Pressable>
      );
    })}
  </ScrollView>
);

// the replica's ranked hits for the words typed, offline as online
const useSearchHits = (query: string): ReadonlyMap<string, number> | null => {
  const { replica } = useLibrary();
  const [hits, setHits] = useState<{ query: string; ranks: ReadonlyMap<string, number> } | null>(
    null,
  );
  const words = query.trim();
  useEffect(() => {
    if (words === "") {
      return;
    }
    let live = true;
    void (async () => {
      const found = await replica.search(words, SEARCH_HITS);
      if (live) {
        setHits({ query: words, ranks: new Map(found.map((hit, rank) => [hit.itemId, rank])) });
      }
    })();
    return () => {
      live = false;
    };
  }, [replica, words]);
  if (words === "") {
    return null;
  }
  return hits !== null && hits.query === words ? hits.ranks : new Map();
};

const emptyLabel = (pulled: boolean, filtered: boolean): string => {
  if (!pulled) {
    return "Loading your library…";
  }
  return filtered
    ? "Nothing here matches."
    : "Nothing saved yet. Share a page to Inteligir, or type a link or a thought above.";
};

const LibraryScreen = () => {
  const theme = useTheme();
  // a value, not a class: className draws nothing on a SafeAreaView
  const screen = { backgroundColor: theme.background, flex: 1 };
  const { replica } = useLibrary();
  const status = useReplicaStatus();
  const [scope, setScope] = useState<LibraryScope>({ kind: "all" });
  const [kinds, setKinds] = useState<ReadonlySet<ItemKind>>(() => new Set());
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const hits = useSearchHits(query);
  const listingAsked = useMemo(() => listingQuery({ hits, kinds, scope }), [hits, kinds, scope]);
  const { page } = useListing(listingAsked);
  const folders = replica.folders();

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    await replica.sync();
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
    const made = await createPhoneSaves({ newBlockId, replica }).newNote({
      folderId: saveFolderOf(scope),
    });
    openItem(made.id, "title");
  };

  const addPhoto = async (): Promise<void> => {
    const added = await ingestPhoto(replica, saveFolderOf(scope));
    if (added.kind === "refused") {
      Alert.alert("Couldn't add the photo", added.message);
    } else if (added.kind === "picked") {
      openViewer(added.itemId);
    }
  };

  const rowActions = (row: ReplicaListingRow): void => {
    const deleted = row.deletedAt !== null;
    const options = ["Cancel", "Open", deleted ? "Restore" : "Move to Deleted"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 0,
        destructiveButtonIndex: deleted ? undefined : 2,
        options,
        title: row.title,
      },
      (index) => {
        if (index === 1) {
          openRow(row);
        } else if (index === 2) {
          void (deleted ? replica.restoreItems([row.id]) : replica.deleteItems([row.id]));
        }
      },
    );
  };

  const filtered = scope.kind !== "all" || kinds.size > 0 || query.trim() !== "";

  return (
    <SafeAreaView style={screen} edges={["left", "right"]}>
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
                setScope({ kind: "all" });
              }}
            >
              All items
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              isOn={scope.kind === "unsorted"}
              onPress={() => {
                setScope({ kind: "unsorted" });
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
                    setScope({ folderId: folder.id, kind: "folder" });
                  }}
                >
                  {folder.name}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.MenuAction
              isOn={scope.kind === "deleted"}
              onPress={() => {
                setScope({ kind: "deleted" });
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
            onPress={() => {
              void refresh();
            }}
          >
            Sync now
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
        data={page.items}
        keyExtractor={(row) => row.id}
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
              {emptyLabel(status.cursor > 0 || status.failure !== null, filtered)}
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
