import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Delegation, ListDelegationsResult } from "@repo/bridge/delegation";
import { getHostBridge, useHostStatus } from "@/lib/host/connection";
import { DOT_BUSY, DOT_ERROR, DOT_IDLE, DOT_OK, hostStatusLabel } from "@/lib/host/status-display";
import { useHostChannel } from "@/lib/host/use-host-channel";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// The desktop's delegation queue, live over the ws bridge: list on mount /
// reconnect, then follow onDelegationsUpdated. Running work can be cancelled;
// completed work can restore the file's pre-run snapshot (confirmed first —
// it rewrites the note on the desktop byte-exactly).
// ---------------------------------------------------------------------------

export default function DelegationsScreen() {
  const router = useRouter();
  const theme = useTheme();
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
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right", "bottom"]}
    >
      <Stack.Screen options={{ title: "Delegations" }} />

      {!connected ? (
        <View style={styles.disconnected}>
          <Text style={[styles.disconnectedText, { color: theme.mutedForeground }]}>
            {status === "none"
              ? "Pair with your desktop to see its delegations."
              : `${hostStatusLabel(status)} — delegations live on the paired desktop.`}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.connectButton,
              { borderColor: theme.border, backgroundColor: theme.card },
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => router.push("/connect")}
          >
            <Text style={[styles.buttonLabel, { color: theme.foreground }]}>Open Connect</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {actionError !== null ? (
            <Text style={[styles.actionError, { color: theme.destructive }]}>{actionError}</Text>
          ) : null}

          {delegations === null ? (
            <Text style={[styles.placeholder, { color: theme.mutedForeground }]}>Loading…</Text>
          ) : delegations.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.mutedForeground }]}>
                No delegations yet.
              </Text>
              <Text style={[styles.emptyHint, { color: theme.mutedForeground }]}>
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
  const theme = useTheme();
  const task = delegation.anchor.text !== "" ? delegation.anchor.text : delegation.lineText;
  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.task, { color: theme.cardForeground }]} numberOfLines={2}>
          {task}
        </Text>
        <StatusBadge status={delegation.status} />
      </View>

      <Text style={[styles.meta, { color: theme.mutedForeground }]} numberOfLines={1}>
        {delegation.sourceFile} · {relativeTime(delegation.createdAt)}
      </Text>

      {delegation.status === "done" && delegation.resultSummary !== null ? (
        <Text style={[styles.detail, { color: theme.mutedForeground }]} numberOfLines={3}>
          {delegation.resultSummary}
        </Text>
      ) : null}
      {delegation.status === "failed" && delegation.error !== null ? (
        <Text style={[styles.detail, { color: theme.destructive }]} numberOfLines={3}>
          {delegation.error}
        </Text>
      ) : null}
      {delegation.restoredAt !== null ? (
        <Text style={[styles.restored, { color: theme.mutedForeground }]}>
          Original restored {relativeTime(delegation.restoredAt)}
        </Text>
      ) : null}

      {delegation.status === "running" ? (
        <Pressable
          style={({ pressed }) => [
            styles.cardButton,
            { borderColor: theme.border },
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => void onCancel(delegation.id)}
        >
          <Text style={[styles.buttonLabel, { color: theme.foreground }]}>Cancel</Text>
        </Pressable>
      ) : null}
      {delegation.status === "done" && delegation.hasSnapshot ? (
        <Pressable
          style={({ pressed }) => [
            styles.cardButton,
            { borderColor: theme.border },
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => onRestore(delegation)}
        >
          <Text style={[styles.buttonLabel, { color: theme.foreground }]}>Restore original</Text>
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
  const theme = useTheme();
  const badge = BADGES[status];
  return (
    <View style={[styles.badge, { backgroundColor: theme.muted }]}>
      <View style={[styles.badgeDot, { backgroundColor: badge.dot }]} />
      <Text style={[styles.badgeLabel, { color: theme.mutedForeground }]}>{badge.label}</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  disconnected: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACE.md,
    paddingHorizontal: SPACE.xxl,
  },
  disconnectedText: { fontSize: 16, textAlign: "center" },
  connectButton: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
  },
  buttonLabel: { fontSize: 14, fontWeight: "600" },
  list: { flex: 1 },
  listContent: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg },
  actionError: { marginBottom: SPACE.md, fontSize: 14 },
  placeholder: { paddingVertical: 96, fontSize: 14, textAlign: "center" },
  empty: { alignItems: "center", gap: SPACE.sm, paddingVertical: 96 },
  emptyTitle: { fontSize: 16 },
  emptyHint: { paddingHorizontal: SPACE.xxl, fontSize: 14, textAlign: "center" },
  card: {
    marginBottom: SPACE.sm,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: SPACE.md,
  },
  task: { flex: 1, fontSize: 16 },
  meta: { marginTop: SPACE.xs, fontSize: 12 },
  detail: { marginTop: SPACE.sm, fontSize: 14 },
  restored: { marginTop: SPACE.sm, fontSize: 12 },
  cardButton: {
    marginTop: SPACE.md,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: SPACE.xs,
  },
  badgeDot: { height: 6, width: 6, borderRadius: RADIUS.full },
  badgeLabel: { fontSize: 12, fontWeight: "500" },
});
