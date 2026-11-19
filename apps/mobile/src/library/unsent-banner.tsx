import { Alert, Text, View } from "react-native";
import { useSyncExternalStore } from "react";
import { savesWaiting } from "@repo/client/waiting-saves";
import type { WaitingShare } from "@/items/share-outbox";
import { useLibrary } from "@/lib/library-hooks";
import { TextButton } from "@/ui/text-button";

const FRAME = "gap-2 rounded-lg border border-border bg-card p-3";

const shareName = (share: WaitingShare) =>
  share.payload.kind === "link" ? share.payload.url : share.payload.text;

const confirmDiscard = (letGo: () => void) => {
  Alert.alert("Let this save go?", "It was kept only on this iPhone, and goes for good.", [
    { style: "cancel", text: "Cancel" },
    { onPress: letGo, style: "destructive", text: "Let it go" },
  ]);
};

const Refused = ({ share }: { share: WaitingShare }) => {
  const { shares } = useLibrary();

  return (
    <View className={FRAME}>
      <Text className="text-14 font-semibold text-card-foreground">
        A save didn&rsquo;t reach your library
      </Text>
      <Text className="text-14 text-card-foreground" numberOfLines={2}>
        {shareName(share)}
      </Text>
      <Text className="text-14 text-muted-foreground">{share.refused}</Text>
      <View className="flex-row flex-wrap gap-4">
        <TextButton
          fontSize={14}
          label="Try again"
          onPress={() => {
            void shares.retry(share.opId);
          }}
        />
        <TextButton
          fontSize={14}
          label="Let it go"
          onPress={() => {
            confirmDiscard(() => {
              void shares.discard(share.opId);
            });
          }}
        />
      </View>
    </View>
  );
};

export const UnsentBanner = ({ className = "" }: { className?: string }) => {
  const { shares } = useLibrary();
  const waiting = useSyncExternalStore(shares.waiting.subscribe, shares.waiting.get);

  if (waiting.length === 0) {
    return null;
  }

  const refused = waiting.filter((share) => share.refused !== null);
  const unsent = waiting.length - refused.length;

  return (
    <View className={`gap-2 pb-2 ${className}`}>
      {refused.map((share) => (
        <Refused key={share.opId} share={share} />
      ))}
      {unsent === 0 ? null : (
        <View className={FRAME}>
          <Text className="text-14 font-semibold text-card-foreground">{savesWaiting(unsent)}</Text>
          <Text className="text-14 text-muted-foreground">
            They go to your library once it can be reached.
          </Text>
        </View>
      )}
    </View>
  );
};
