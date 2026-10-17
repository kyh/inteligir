import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SPACE, useTheme } from "@/lib/theme";
import type { LibraryCard } from "@/library/library-view";

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.lg,
  },
  body: { gap: SPACE.lg, paddingBottom: 48, paddingHorizontal: SPACE.lg, paddingTop: SPACE.xxl },
  done: { fontSize: 16, fontWeight: "600" },
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  row: { gap: SPACE.xs },
  sheet: { flex: 1 },
  value: { fontSize: 16 },
});

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
}) => {
  const theme = useTheme();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" hitSlop={SPACE.md} onPress={onClose}>
            <Text style={[styles.done, { color: theme.foreground }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {(card === null ? [] : rowsOf(card)).map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={[styles.label, { color: theme.mutedForeground }]}>{row.label}</Text>
              <Text selectable style={[styles.value, { color: theme.foreground }]}>
                {row.value}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
};
