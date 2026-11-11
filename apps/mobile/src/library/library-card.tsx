// One Library row: the title, the site and when it was saved, the tags, and the cover on the right,
// drawn small from the phone's file cache, with a placeholder holding its place while it comes so
// rows do not jump.

import { Image, Pressable, Text, View } from "react-native";
import type { z } from "zod";
import type { listedItemSchema } from "@repo/contract/library/library-wire";
import { shownTitle } from "@repo/contract/items/item-name";
import { useFileUri } from "@/lib/library-hooks";
import { cardCaption } from "./card-caption";

export type ListedItem = z.infer<typeof listedItemSchema>;

const THUMB_SIZE = 64;

const THUMB = { height: THUMB_SIZE, width: THUMB_SIZE } as const;

const Thumb = ({ cover }: { cover: string }) => {
  const uri = useFileUri(cover, true);
  return uri === null || uri === undefined ? (
    <View className="rounded-lg bg-muted" style={THUMB} />
  ) : (
    <Image accessibilityIgnoresInvertColors className="rounded-lg" source={{ uri }} style={THUMB} />
  );
};

export const LibraryCardRow = ({
  onLongPress,
  onPress,
  row,
}: {
  row: ListedItem;
  onPress: () => void;
  onLongPress: () => void;
}) => {
  const caption = cardCaption(row);
  return (
    <Pressable
      accessibilityRole="button"
      className="mb-2 flex-row items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 active:opacity-70"
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View className="grow basis-0 gap-0.5">
        <Text className="text-16 text-card-foreground" numberOfLines={2}>
          {shownTitle(row.card.title)}
        </Text>
        {caption === "" ? null : (
          <Text className="text-13 text-muted-foreground" numberOfLines={1}>
            {caption}
          </Text>
        )}
        {row.tags.length === 0 ? null : (
          <Text className="text-12 text-muted-foreground" numberOfLines={1}>
            {row.tags.map((tag) => `#${tag}`).join(" ")}
          </Text>
        )}
      </View>
      {row.fields.coverSha === null ? null : <Thumb cover={row.fields.coverSha} />}
    </Pressable>
  );
};
