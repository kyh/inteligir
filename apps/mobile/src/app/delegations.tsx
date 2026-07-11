import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Delegation, ListDelegationsResult } from "@repo/features/delegation";
import { getHostBridge, useHostStatus } from "@/lib/host/connection";
import { DOT_BUSY, DOT_ERROR, DOT_IDLE, DOT_OK, hostStatusLabel } from "@/lib/host/status-display";
import { useHostChannel } from "@/lib/host/use-host-channel";

// ---------------------------------------------------------------------------
// The desktop's delegation queue, live over the ws bridge: list on mount /
// reconnect, then follow onDelegationsUpdated. Running work can be cancelled;
// completed work can restore the file's pre-run snapshot (confirmed first —
// it rewrites the note on the desktop byte-exactly).
// ---------------------------------------------------------------------------

export default function DelegationsScreen() {
  const router = useRouter();
  const { status } = useHostStatus();
  const [delegations, setDelegations] = useState<readonly Delegation[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Live updates + a list reload on every (re)connect.
  useHostChannel<ListDelegationsResult, ListDelegationsResult>({
    subscribe: (bridge, onEvent) => bridge.onDelegationsUpdated(onEvent),
    load: (bridge) => bridge.listDelegations(),
    onEvent: (result) => setDelegations(sortNewestFirst(result.delegations)),
    onLoad: (result) => setDelegations(sortNewestFirst(result.delegations)),
  });

  const cancel = useCallback(async (id: string) => {
    const bridge = getHostBridge();
    if (bridge === null) return;
    setActionError(null);
    try {
      const result = await bridge.cancelDelegation(id);
      if (!result.ok) setActionError("Could not cancel — it may have just finished.");
    } catch {
      setActionError("Could not cancel — connection lost.");
    }
  }, []);

  const doRestore = useCallback(async (id: string) => {
    const bridge = getHostBridge();
    if (bridge === null) return;
    setActionError(null);
    try {
      const result = await bridge.restoreDelegationSnapshot(id);
      if (!result.ok) setActionError(result.error);
    } catch {
      setActionError("Could not restore — connection lost.");
    }
  }, []);

  const restore = useCallback(
    (delegation: Delegation) => {
      Alert.alert(
        "Restore original?",
        `${delegation.sourceFile} is rewritten back to its exact bytes from before the agent ran. The agent's changes to that file are undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Restore",
            style: "destructive",
            onPress: () => void doRestore(delegation.id),
          },
        ],
      );
    },
    [doRestore],
  );

  const connected = status === "connected";

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["left", "right", "bottom"]}>
      <Stack.Screen options={{ title: "Delegations" }} />

      {!connected ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-center text-base text-muted-foreground">
            {status === "none"
              ? "Pair with your desktop to see its delegations."
              : `${hostStatusLabel(status)} — delegations live on the paired desktop.`}
          </Text>
          <Pressable
            className="rounded-lg border border-border bg-card px-4 py-2 active:opacity-70"
            onPress={() => router.push("/connect")}
          >
            <Text className="text-sm font-semibold text-foreground">Open Connect</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 py-4">
          {actionError !== null ? (
            <Text className="mb-3 text-sm text-destructive">{actionError}</Text>
          ) : null}

          {delegations === null ? (
            <Text className="py-24 text-center text-sm text-muted-foreground">Loading…</Text>
          ) : delegations.length === 0 ? (
            <View className="items-center gap-2 py-24">
              <Text className="text-base text-muted-foreground">No delegations yet.</Text>
              <Text className="px-6 text-center text-sm text-muted-foreground">
                Highlight a checkbox on your desktop and choose Delegate.
              </Text>
            </View>
          ) : (
            delegations.map((delegation) => (
              <DelegationCard
                key={delegation.id}
                delegation={delegation}
                onCancel={cancel}
                onRestore={restore}
              />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function sortNewestFirst(delegations: readonly Delegation[]): readonly Delegation[] {
  return delegations.toSorted((a, b) => b.createdAt - a.createdAt);
}

// ---- card -------------------------------------------------------------------

function DelegationCard({
  delegation,
  onCancel,
  onRestore,
}: {
  delegation: Delegation;
  onCancel: (id: string) => Promise<void>;
  onRestore: (delegation: Delegation) => void;
}) {
  const task = delegation.anchor.text !== "" ? delegation.anchor.text : delegation.lineText;
  return (
    <View className="mb-2 rounded-lg border border-border bg-card px-4 py-3">
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 text-base text-card-foreground" numberOfLines={2}>
          {task}
        </Text>
        <StatusBadge status={delegation.status} />
      </View>

      <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={1}>
        {delegation.sourceFile} · {relativeTime(delegation.createdAt)}
      </Text>

      {delegation.status === "done" && delegation.resultSummary !== null ? (
        <Text className="mt-2 text-sm text-muted-foreground" numberOfLines={3}>
          {delegation.resultSummary}
        </Text>
      ) : null}
      {delegation.status === "failed" && delegation.error !== null ? (
        <Text className="mt-2 text-sm text-destructive" numberOfLines={3}>
          {delegation.error}
        </Text>
      ) : null}
      {delegation.restoredAt !== null ? (
        <Text className="mt-2 text-xs text-muted-foreground">
          Original restored {relativeTime(delegation.restoredAt)}
        </Text>
      ) : null}

      {delegation.status === "running" ? (
        <Pressable
          className="mt-3 self-start rounded-lg border border-border px-3 py-1.5 active:opacity-70"
          onPress={() => void onCancel(delegation.id)}
        >
          <Text className="text-sm font-semibold text-foreground">Cancel</Text>
        </Pressable>
      ) : null}
      {delegation.status === "done" && delegation.hasSnapshot ? (
        <Pressable
          className="mt-3 self-start rounded-lg border border-border px-3 py-1.5 active:opacity-70"
          onPress={() => onRestore(delegation)}
        >
          <Text className="text-sm font-semibold text-foreground">Restore original</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const BADGES: Record<Delegation["status"], { label: string; dot: string }> = {
  queued: { label: "Queued", dot: DOT_IDLE },
  running: { label: "Running", dot: DOT_BUSY },
  done: { label: "Done", dot: DOT_OK },
  failed: { label: "Failed", dot: DOT_ERROR },
};

function StatusBadge({ status }: { status: Delegation["status"] }) {
  const badge = BADGES[status];
  return (
    <View className="flex-row items-center gap-1.5 rounded-full bg-muted px-2.5 py-1">
      <View className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
      <Text className="text-xs font-medium text-muted-foreground">{badge.label}</Text>
    </View>
  );
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
