import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useCoverThumb } from "@/lib/app-runtime";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";
import type { LibraryCard } from "./library-view";

const THUMB_SIZE = 64;

const styles = StyleSheet.create({
  caption: { fontSize: 13 },
  pressed: { opacity: 0.7 },
  row: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: SPACE.md,
    marginBottom: SPACE.sm,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  tags: { fontSize: 12 },
  text: { flex: 1, gap: 2 },
  thumb: { borderRadius: RADIUS.md, height: THUMB_SIZE, width: THUMB_SIZE },
  title: { fontSize: 16 },
});

// a stub is a link no Mac has read yet: its title and cover come when one does
const PENDING_LINE = "Details arrive from your Mac";

const savedLine = (card: LibraryCard): string => {
  const parts = [card.site, card.saved === null ? null : new Date(card.saved).toLocaleDateString()];
  return parts.filter((part) => part !== null && part !== "").join(" · ");
};

// a placeholder holds the cover's place while it is not on this phone yet, so rows do not jump
const Thumb = ({ cover }: { cover: string }) => {
  const theme = useTheme();
  const uri = useCoverThumb(cover);
  return uri === null ? (
    <View style={[styles.thumb, { backgroundColor: theme.muted }]} />
  ) : (
    <Image accessibilityIgnoresInvertColors source={{ uri }} style={styles.thumb} />
  );
};

// one Library row: the title, the site and when it was saved, the tags, and the cover on the right
export const LibraryCardRow = ({
  card,
  onLongPress,
  onPress,
}: {
  card: LibraryCard;
  onPress: () => void;
  onLongPress: () => void;
}) => {
  const theme = useTheme();
  const caption = card.pending ? PENDING_LINE : savedLine(card);
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.card, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View style={styles.text}>
        <Text style={[styles.title, { color: theme.cardForeground }]} numberOfLines={2}>
          {card.title}
        </Text>
        {caption === "" ? null : (
          <Text style={[styles.caption, { color: theme.mutedForeground }]} numberOfLines={1}>
            {caption}
          </Text>
        )}
        {card.tags.length === 0 ? null : (
          <Text style={[styles.tags, { color: theme.mutedForeground }]} numberOfLines={1}>
            {card.tags.map((tag) => `#${tag}`).join(" ")}
          </Text>
        )}
      </View>
      {card.cover === null ? null : <Thumb cover={card.cover} />}
    </Pressable>
  );
};
