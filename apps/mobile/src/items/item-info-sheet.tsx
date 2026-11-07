// An item's Info: where it came from, when it was saved, what it is and where it is filed, read from
// the item's own fields and the folders the replica holds.

import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { ListingFolder } from "@repo/notes/library/library-index";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { SPACE } from "@/lib/theme";

const KIND_LABELS: Record<LibraryItemFields["kind"], string> = {
  audio: "Audio",
  file: "File",
  image: "Image",
  link: "Link",
  note: "Note",
  pdf: "PDF",
  video: "Video",
};

// a folder's path from the top, by the names the replica holds
const folderPath = (folders: readonly ListingFolder[], folderId: string | null): string => {
  const names: string[] = [];
  let at = folders.find((folder) => folder.id === folderId);
  while (at !== undefined && names.length < folders.length) {
    names.unshift(at.name);
    const { parentId } = at;
    at = folders.find((folder) => folder.id === parentId);
  }
  return names.length === 0 ? "Unsorted" : names.join(" / ");
};

// what Info shows of an item, each row only when the item says it
const rowsOf = (
  fields: LibraryItemFields,
  folders: readonly ListingFolder[],
): { label: string; value: string }[] =>
  [
    { label: "Link", value: fields.url },
    { label: "Site", value: fields.site },
    { label: "Saved", value: new Date(fields.savedAt).toLocaleString() },
    { label: "Kind", value: KIND_LABELS[fields.kind] },
    { label: "Folder", value: folderPath(folders, fields.folderId) },
    {
      label: "Tags",
      value: fields.tags.length === 0 ? null : fields.tags.map((tag) => `#${tag}`).join(" "),
    },
  ].flatMap((row) => (row.value === null ? [] : [{ label: row.label, value: row.value }]));

export const ItemInfoSheet = ({
  fields,
  folders,
  onClose,
  visible,
}: {
  fields: LibraryItemFields | null;
  folders: readonly ListingFolder[];
  onClose: () => void;
  visible: boolean;
}) => (
  <Modal
    visible={visible}
    animationType="slide"
    presentationStyle="pageSheet"
    onRequestClose={onClose}
  >
    <View className="grow basis-0 bg-background">
      <View className="flex-row items-center justify-end px-4 pt-4">
        <Pressable accessibilityRole="button" hitSlop={SPACE.md} onPress={onClose}>
          <Text className="text-16 font-semibold text-foreground">Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerClassName="gap-4 px-4 pt-6 pb-12">
        {(fields === null ? [] : rowsOf(fields, folders)).map((row) => (
          <View key={row.label} className="gap-1">
            <Text className="text-12 font-semibold tracking-[0.5px] uppercase text-muted-foreground">
              {row.label}
            </Text>
            <Text selectable className="text-16 text-foreground">
              {row.value}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  </Modal>
);
