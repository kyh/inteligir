// What the phone holds that has not reached the library, said above the list and the open item:
// a change the library refused waits here for the person, who sends it again or lets it go, and
// changes held while the cloud cannot be reached say they will go once it can. Nothing shows while
// everything is up to date or on its way.

import { Alert, Text, View } from "react-native";
import type { ParkedWrite, ReplicaStatus } from "@repo/library-replica/library-replica";
import { useLibrary, useReplicaStatus } from "@/lib/library-hooks";
import { TextButton } from "@/ui/text-button";

// a notice's card, the same for each kind
const FRAME = "gap-2 rounded-lg border border-border bg-card p-3";

const changes = (count: number): string => (count === 1 ? "1 change" : `${String(count)} changes`);

// what waits on a connection, said once whatever the reason the last pass stopped
export const waitingLine = (status: ReplicaStatus): string | null => {
  if (status.unsent === status.parked.length) {
    return null;
  }
  return status.failure?.kind === "unreachable"
    ? `${changes(status.unsent - status.parked.length)} on this iPhone will be saved to your library once it can be reached.`
    : null;
};

const confirmDiscard = (letGo: () => void): void => {
  Alert.alert("Let this change go?", "It was kept only on this iPhone, and goes for good.", [
    { style: "cancel", text: "Cancel" },
    { onPress: letGo, style: "destructive", text: "Let it go" },
  ]);
};

const Parked = ({ write }: { write: ParkedWrite }) => {
  const { replica } = useLibrary();
  return (
    <View className={FRAME}>
      <Text className="text-14 font-semibold text-card-foreground">
        A change was not saved to your library
      </Text>
      <Text className="text-14 text-muted-foreground">{write.reason}</Text>
      <View className="flex-row flex-wrap gap-4">
        <TextButton
          fontSize={14}
          label="Try again"
          onPress={() => {
            void replica.retry(write.seq);
          }}
        />
        <TextButton
          fontSize={14}
          label="Let it go"
          onPress={() => {
            confirmDiscard(() => {
              void replica.discard(write.seq);
            });
          }}
        />
      </View>
    </View>
  );
};

export const UnsentBanner = ({ className = "" }: { className?: string }) => {
  const status = useReplicaStatus();
  const waiting = waitingLine(status);
  if (status.parked.length === 0 && waiting === null) {
    return null;
  }
  return (
    <View className={`gap-2 pb-2 ${className}`}>
      {status.parked.map((write) => (
        <Parked key={write.seq} write={write} />
      ))}
      {waiting === null ? null : (
        <View className={FRAME}>
          <Text className="text-14 text-card-foreground">{waiting}</Text>
        </View>
      )}
    </View>
  );
};
