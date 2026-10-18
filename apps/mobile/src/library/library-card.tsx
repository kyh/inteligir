import { Image, Pressable, Text, View } from "react-native";
import { useCoverThumb } from "@/lib/app-runtime";
import type { LibraryCard } from "./library-view";

const THUMB_SIZE = 64;

const THUMB = { height: THUMB_SIZE, width: THUMB_SIZE } as const;

// a stub is a link no Mac has read yet: its title and cover come when one does
const PENDING_LINE = "Details arrive from your Mac";

const savedLine = (card: LibraryCard): string => {
  const parts = [card.site, card.saved === null ? null : new Date(card.saved).toLocaleDateString()];
  return parts.filter((part) => part !== null && part !== "").join(" · ");
};

// a placeholder holds the cover's place while it is not on this phone yet, so rows do not jump
const Thumb = ({ cover }: { cover: string }) => {
  const uri = useCoverThumb(cover);
  return uri === null ? (
    <View className="rounded-lg bg-muted" style={THUMB} />
  ) : (
    <Image accessibilityIgnoresInvertColors className="rounded-lg" source={{ uri }} style={THUMB} />
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
  const caption = card.pending ? PENDING_LINE : savedLine(card);
  return (
    <Pressable
      accessibilityRole="button"
      className="mb-2 flex-row items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 active:opacity-70"
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View className="grow basis-0 gap-0.5">
        <Text className="text-16 text-card-foreground" numberOfLines={2}>
          {card.title}
        </Text>
        {caption === "" ? null : (
          <Text className="text-13 text-muted-foreground" numberOfLines={1}>
            {caption}
          </Text>
        )}
        {card.tags.length === 0 ? null : (
          <Text className="text-12 text-muted-foreground" numberOfLines={1}>
            {card.tags.map((tag) => `#${tag}`).join(" ")}
          </Text>
        )}
      </View>
      {card.cover === null ? null : <Thumb cover={card.cover} />}
    </Pressable>
  );
};
