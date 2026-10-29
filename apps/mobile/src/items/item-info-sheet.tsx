import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SPACE } from "@/lib/theme";
import type { LibraryCard } from "@/library/library-view";

const KIND_LABELS: Record<LibraryCard["kind"], string> = {
  audio: "Audio",
  file: "File",
  image: "Image",
  link: "Link",
  note: "Note",
  pdf: "PDF",
  video: "Video",
};

// what Info shows of an item, each row only when the item says it
const rowsOf = (card: LibraryCard): { label: string; value: string }[] =>
  [
    { label: "Link", value: card.url },
    { label: "Site", value: card.site },
    {
      label: "Saved",
      value: card.saved === null ? null : new Date(card.saved).toLocaleString(),
    },
    { label: "Kind", value: KIND_LABELS[card.kind] },
    { label: "Folder", value: card.folder === "" ? "Library" : card.folder },
    {
      label: "Tags",
      value: card.tags.length === 0 ? null : card.tags.map((tag) => `#${tag}`).join(" "),
    },
  ].flatMap((row) => (row.value === null ? [] : [{ label: row.label, value: row.value }]));

// an item's Info: where it came from, when it was saved, what it is and where it is filed
export const ItemInfoSheet = ({
  card,
  onClose,
  visible,
}: {
  card: LibraryCard | null;
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
        {(card === null ? [] : rowsOf(card)).map((row) => (
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
