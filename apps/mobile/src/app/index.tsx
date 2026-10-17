import { Stack } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { basenamePath, extnamePath } from "@repo/notes/knowledge/vault-path";
import type { SavedItem } from "@/items/item-ops";
import {
  createNote,
  deleteNote,
  refreshNotes,
  renameNote,
  listsNow,
  saveText,
  syncNow,
  useLibrary,
} from "@/lib/app-runtime";
import { messageOf } from "@/lib/error-message";
import { openItem, openThreads, openViewer } from "@/lib/routes";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";
import { LibraryCardRow } from "@/library/library-card";
import type { LibraryCard, LibraryFilter, PhoneScope } from "@/library/library-view";
import { confirmDeleteNote } from "@/notes/confirm-delete-note";
import { linksKeptLine } from "@/notes/file-ops";
import type { NotesTreeState } from "@/notes/notes-store";
import { OutboxBanner } from "@/notes/outbox-banner";
import { confirmSignOut } from "@/ui/confirm-sign-out";

const styles = StyleSheet.create({
  body: { fontSize: 16, textAlign: "center" },
  caption: { fontSize: 13 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs,
  },
  chipLabel: { fontSize: 14 },
  chips: { gap: SPACE.sm, paddingVertical: SPACE.sm },
  empty: { alignItems: "center", gap: SPACE.sm, paddingHorizontal: SPACE.xxl, paddingVertical: 96 },
  field: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flex: 1,
    fontSize: 16,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  list: { paddingBottom: 32, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  notice: { marginBottom: SPACE.sm },
  pressed: { opacity: 0.7 },
  save: { fontSize: 16, fontWeight: "600" },
  saveRow: { alignItems: "center", flexDirection: "row", gap: SPACE.md },
  screen: { flex: 1 },
});

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

const LOADING = "Loading your library…";

const scopeTitle = (scope: PhoneScope): string => {
  switch (scope.kind) {
    case "all": {
      return "Library";
    }
    case "unsorted": {
      return UNSORTED_FOLDER;
    }
    case "folder": {
      return scope.path.split("/").at(-1) ?? scope.path;
    }
    case "tag": {
      return `#${scope.tag}`;
    }
    // no default
  }
};

const emptyLabel = (tree: NotesTreeState, filtered: boolean): string => {
  if (tree.state === "idle" || tree.state === "loading") {
    return LOADING;
  }
  if (tree.state === "empty" || tree.state === "error") {
    return tree.message;
  }
  return filtered
    ? "Nothing here matches."
    : "Nothing saved yet. Share a page to Inteligir, or type a link or a thought above.";
};

// a folder scope's new note lands in that folder; every other scope's in Unsorted
const folderOf = (scope: PhoneScope): string =>
  scope.kind === "folder" ? scope.path : UNSORTED_FOLDER;

// an image or a PDF opens full size, and so does a file that is an item of its own; everything
// else opens in the editor
const openCard = (card: LibraryCard): void => {
  const bare = card.file === card.path;
  if ((card.kind === "image" || card.kind === "pdf" || bare) && card.file !== null) {
    openViewer(card.file, bare ? null : card.path);
    return;
  }
  openItem(card.path);
};

// the name a rename starts from: a note's title, a file's name without its extension, which the
// rename keeps
const renameStem = (path: string): string => {
  if (isDocPath(path)) {
    return docStem(path);
  }
  const name = basenamePath(path);
  return name.slice(0, name.length - extnamePath(path).length);
};

const rename = (path: string): void => {
  Alert.prompt(
    "Rename",
    undefined,
    [
      { style: "cancel", text: "Cancel" },
      {
        onPress: (name?: string) => {
          void (async () => {
            const outcome = await renameNote(path, name ?? "");
            if (outcome.kind === "refused") {
              Alert.alert("Couldn't rename", outcome.message);
            } else if (outcome.unlinked.length > 0) {
              Alert.alert("Renamed", linksKeptLine(outcome.unlinked));
            }
          })();
        },
        text: "Rename",
      },
    ],
    "plain-text",
    renameStem(path),
  );
};

const confirmDelete = (path: string): void => {
  confirmDeleteNote(path, () => {
    void (async () => {
      try {
        await deleteNote(path);
      } catch (error) {
        Alert.alert("Couldn't delete", messageOf(error));
      }
    })();
  });
};

interface CardAction {
  readonly label: string;
  readonly role?: "cancel" | "destructive";
  readonly run: ((card: LibraryCard) => void) | null;
}

const CARD_ACTIONS: readonly CardAction[] = [
  { label: "Cancel", role: "cancel", run: null },
  { label: "Open", run: openCard },
  {
    label: "Rename",
    run: (card) => {
      rename(card.path);
    },
  },
  {
    label: "Delete",
    role: "destructive",
    run: (card) => {
      confirmDelete(card.path);
    },
  },
];

const showCardActions = (card: LibraryCard): void => {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      cancelButtonIndex: CARD_ACTIONS.findIndex((action) => action.role === "cancel"),
      destructiveButtonIndex: CARD_ACTIONS.findIndex((action) => action.role === "destructive"),
      options: CARD_ACTIONS.map((action) => action.label),
      title: card.title,
    },
    (index) => {
      CARD_ACTIONS[index]?.run?.(card);
    },
  );
};

// a saved link or thought just lists; one the list in view leaves out (a scope, a kind or a
// search hides Unsorted's newest), one already here, and one that could not be, each say so
const tellSaved = (saved: SavedItem, filter: LibraryFilter): void => {
  if (saved.kind === "refused") {
    Alert.alert("Couldn't save", saved.message);
    return;
  }
  if (saved.kind === "saved" && !listsNow(filter, saved.path)) {
    Alert.alert(`Saved to ${UNSORTED_FOLDER}`, docStem(saved.path), [
      { style: "cancel", text: "OK" },
      {
        onPress: () => {
          openItem(saved.path);
        },
        text: "Open",
      },
    ]);
    return;
  }
  if (saved.kind === "already") {
    Alert.alert("Already in your library", docStem(saved.path), [
      { style: "cancel", text: "OK" },
      {
        onPress: () => {
          openItem(saved.path);
        },
        text: "Open",
      },
    ]);
  }
};

const SaveField = ({ filter }: { filter: LibraryFilter }) => {
  const theme = useTheme();
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
        saved = await saveText(draft);
      } catch (error) {
        saved = { kind: "refused", message: messageOf(error) };
      }
      setSaving(false);
      if (saved.kind !== "refused") {
        setDraft("");
      }
      tellSaved(saved, filter);
    })();
  };
  return (
    <View style={styles.saveRow}>
      <TextInput
        accessibilityLabel="Save a link or a thought"
        style={[
          styles.field,
          { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground },
        ]}
        placeholder="Save a link or a thought"
        placeholderTextColor={theme.mutedForeground}
        value={draft}
        editable={!saving}
        autoCapitalize="none"
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onChangeText={setDraft}
        onSubmitEditing={save}
      />
      <Pressable accessibilityRole="button" disabled={saving} hitSlop={SPACE.sm} onPress={save}>
        <Text style={[styles.save, { color: theme.foreground }]}>Save</Text>
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
}) => {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
    >
      {KIND_CHIPS.map(({ kind, label }) => {
        const on = kinds.has(kind);
        return (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: on ? theme.primary : theme.card,
                borderColor: on ? theme.primary : theme.border,
              },
              pressed && styles.pressed,
            ]}
            onPress={() => {
              toggle(kind);
            }}
          >
            <Text
              style={[styles.chipLabel, { color: on ? theme.primaryForeground : theme.foreground }]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
};

const Notices = ({ tree }: { tree: NotesTreeState }) => {
  const theme = useTheme();
  if (tree.state !== "ready") {
    return null;
  }
  const style = [styles.caption, styles.notice, { color: theme.mutedForeground }];
  return (
    <>
      {tree.progress === null ? null : (
        <Text style={style}>
          {LOADING} {String(tree.progress.fetched)} of {String(tree.progress.total)}
        </Text>
      )}
      {tree.refreshError === null ? null : (
        <Text style={style}>Refresh issue: {tree.refreshError}</Text>
      )}
    </>
  );
};

const isFolderScope = (scope: PhoneScope, path: string): boolean =>
  scope.kind === "folder" && scope.path === path;

const isTagScope = (scope: PhoneScope, tag: string): boolean =>
  scope.kind === "tag" && scope.tag === tag;

// Home: everything saved, newest first. A scope from the menu, the kind chips and the header's
// search narrow it; the field above saves a link or a thought into Unsorted. FlatList, not a
// ScrollView: a library holds thousands of items and an eager row each janks the open.
const LibraryScreen = () => {
  const theme = useTheme();
  const [scope, setScope] = useState<PhoneScope>({ kind: "all" });
  const [kinds, setKinds] = useState<ReadonlySet<ItemKind>>(() => new Set());
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const filter = useMemo(() => ({ kinds, query, scope }), [kinds, query, scope]);
  const { cards, scopes, tree } = useLibrary(filter);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([syncNow(), refreshNotes()]);
    setRefreshing(false);
  }, []);

  const toggleKind = useCallback((kind: ItemKind) => {
    setKinds((held) => {
      const next = new Set(held);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }, []);

  const newNote = useCallback(async () => {
    const created = await createNote(folderOf(scope));
    if (created.kind === "refused") {
      Alert.alert("Couldn't create a note", created.message);
      return;
    }
    openItem(created.path, "title");
  }, [scope]);

  const filtered = scope.kind !== "all" || kinds.size > 0 || query.trim() !== "";

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            autoCapitalize: "none",
            hideWhenScrolling: true,
            onChangeText: (event) => {
              setQuery(event.nativeEvent.text);
            },
            placeholder: "Search titles, sites and links",
          },
          title: scopeTitle(scope),
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
              All
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              isOn={scope.kind === "unsorted"}
              onPress={() => {
                setScope({ kind: "unsorted" });
              }}
            >
              {UNSORTED_FOLDER}
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.Menu title="Folders" hidden={scopes.folders.length === 0}>
              {scopes.folders.map((folder) => (
                <Stack.Toolbar.MenuAction
                  key={folder}
                  isOn={isFolderScope(scope, folder)}
                  onPress={() => {
                    setScope({ kind: "folder", path: folder });
                  }}
                >
                  {folder}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.Menu title="Tags" hidden={scopes.tags.length === 0}>
              {scopes.tags.map(({ count, tag }) => (
                <Stack.Toolbar.MenuAction
                  key={tag}
                  isOn={isTagScope(scope, tag)}
                  subtitle={String(count)}
                  onPress={() => {
                    setScope({ kind: "tag", tag });
                  }}
                >
                  {`#${tag}`}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction
            disabled={tree.state !== "ready"}
            onPress={() => {
              void newNote();
            }}
          >
            New note
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction onPress={openThreads}>Threads</Stack.Toolbar.MenuAction>
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
        style={styles.screen}
        contentContainerStyle={styles.list}
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
        data={cards}
        keyExtractor={(card) => card.path}
        ListHeaderComponent={
          <>
            <OutboxBanner onOpen={openItem} />
            <SaveField filter={filter} />
            <KindChips kinds={kinds} toggle={toggleKind} />
            <Notices tree={tree} />
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.body, { color: theme.mutedForeground }]}>
              {emptyLabel(tree, filtered)}
            </Text>
          </View>
        }
        renderItem={({ item: card }) => (
          <LibraryCardRow
            card={card}
            onPress={() => {
              openCard(card);
            }}
            onLongPress={() => {
              showCardActions(card);
            }}
          />
        )}
      />
    </SafeAreaView>
  );
};

export default LibraryScreen;
