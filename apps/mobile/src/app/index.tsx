import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { SyncPassOptions } from "@repo/notes/sync/engine";
import type { HeldSyncStatus, SyncStatus } from "@repo/notes/sync/status";

import { authClient, clearBearerToken } from "@/lib/auth";
import { appendCapture } from "@/lib/capture/daily-capture";
import { createVaultCaptureIo } from "@/lib/capture/capture-io";
import { useHostStatus } from "@/lib/host/connection";
import { hostStatusDotColor } from "@/lib/host/status-display";
import { disconnectDevice, useDevice } from "@/lib/sync/device";
import type { EnrolledDevice } from "@/lib/sync/device-store";
import { scheduleSync, stopSync, syncOnce, useSyncStatus } from "@/lib/sync/manager";
import { useRealtimeSync } from "@/lib/sync/realtime-manager";
import { listVaultFiles } from "@/lib/sync/vault-access";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// The home surface. Gates on either credential this device can hold: an
// enrolled device key (paired with a desktop vault) or a Better Auth session.
// Neither → the sign-in form, which also offers pairing. Either → the vault
// screen (local file list + manual sync + the matching way back out).
//
// The device key is checked FIRST and short-circuits the session: pairing is
// the deliberate act that moves this install onto the device model, and the
// account is left underneath it so disconnecting restores what was there.
// ---------------------------------------------------------------------------

export default function Index() {
  const theme = useTheme();
  const device = useDevice();
  const { data: session, isPending } = authClient.useSession();

  if (device !== null) return <VaultScreen device={device} />;

  if (isPending) {
    return (
      <SafeAreaView style={[styles.centeredScreen, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: "inteligir" }} />
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return session ? <VaultScreen device={null} /> : <SignInScreen />;
}

// ---- sign in / sign up ----------------------------------------------------

function nameFromEmail(email: string): string {
  const local = email.split("@")[0];
  return local !== undefined && local !== "" ? local : "there";
}

function SignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    const result =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name: nameFromEmail(email) })
        : await authClient.signIn.email({ email, password });
    setSubmitting(false);
    if (result.error) setError(result.error.message ?? "Authentication failed");
  }, [mode, email, password]);

  const disabled = submitting || email === "" || password === "";

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.signInBody}>
          <View style={styles.signInHeader}>
            <Text style={[styles.title, { color: theme.foreground }]}>inteligir</Text>
            <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>
              {mode === "signup"
                ? "Create an account to sync your vault."
                : "Sign in to sync your vault."}
            </Text>
          </View>

          <View style={styles.fields}>
            <TextInput
              style={[
                styles.input,
                { borderColor: theme.input, backgroundColor: theme.card, color: theme.foreground },
              ]}
              placeholder="Email"
              placeholderTextColor={theme.mutedForeground}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={[
                styles.input,
                { borderColor: theme.input, backgroundColor: theme.card, color: theme.foreground },
              ]}
              placeholder="Password"
              placeholderTextColor={theme.mutedForeground}
              autoCapitalize="none"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          {error !== null ? (
            <Text style={[styles.smallText, { color: theme.destructive }]}>{error}</Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              { backgroundColor: theme.primary },
              pressed && styles.pressed80,
              disabled && styles.disabled,
            ]}
            disabled={disabled}
            onPress={() => void submit()}
          >
            {submitting ? (
              <ActivityIndicator color={theme.primaryForeground} />
            ) : (
              <Text style={[styles.buttonLabel, { color: theme.primaryForeground }]}>
                {mode === "signup" ? "Create account" : "Sign in"}
              </Text>
            )}
          </Pressable>

          <Pressable
            style={styles.textButton}
            onPress={() => {
              setError(null);
              setMode(mode === "signup" ? "signin" : "signup");
            }}
          >
            <Text style={[styles.smallText, { color: theme.mutedForeground }]}>
              {mode === "signup" ? "Have an account? Sign in" : "No account? Sign up"}
            </Text>
          </Pressable>

          <Pressable style={styles.textButton} onPress={() => router.push("/pair")}>
            <Text style={[styles.smallText, { color: theme.foreground }]}>
              Pair with your desktop instead
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---- host nav ---------------------------------------------------------------

// Compact row into the desktop-connection surfaces. The Connect pill carries a
// live status dot so connection trouble is visible from the home screen.
function HostNavRow() {
  const router = useRouter();
  const { status } = useHostStatus();
  return (
    <View style={styles.navRow}>
      <NavPill label="Chat" onPress={() => router.push("/chat")} />
      <NavPill label="Delegations" onPress={() => router.push("/delegations")} />
      <NavPill
        label="Connect"
        dotColor={hostStatusDotColor(status)}
        onPress={() => router.push("/connect")}
      />
    </View>
  );
}

function NavPill({
  label,
  dotColor,
  onPress,
}: {
  label: string;
  dotColor?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.navPill,
        { borderColor: theme.border, backgroundColor: theme.card },
        pressed && styles.pressed70,
      ]}
      onPress={onPress}
    >
      {dotColor !== undefined ? (
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      ) : null}
      <Text style={[styles.navPillLabel, { color: theme.cardForeground }]}>{label}</Text>
    </Pressable>
  );
}

// ---- quick capture --------------------------------------------------------

// The phone's actual job: 5-second capture into TODAY's daily note. One input,
// two verbs — "Note" appends a bullet, "Task" an unchecked box (which feeds
// the desktop's checkbox-delegation surface after sync). The write is local
// and synchronous (works offline); a debounced sync pass is kicked after, and
// concurrent desktop appends to the same journal merge via the engine's
// append-union rung.
function CaptureBox({ onCaptured }: { onCaptured: () => void }) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending confirmation timer on unmount.
  useEffect(
    () => () => {
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    },
    [],
  );

  const capture = useCallback(
    (kind: "append" | "task") => {
      const result = appendCapture(createVaultCaptureIo(), kind, text, new Date());
      if (result.kind === "empty") return;
      setText("");
      setConfirmation(`Added to ${result.path}`);
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmation(null), 2500);
      scheduleSync();
      onCaptured();
    },
    [text, onCaptured],
  );

  const disabled = text.trim() === "";

  return (
    <View style={styles.captureBox}>
      <TextInput
        style={[
          styles.input,
          { borderColor: theme.input, backgroundColor: theme.card, color: theme.foreground },
        ]}
        placeholder="Capture to today’s note…"
        placeholderTextColor={theme.mutedForeground}
        value={text}
        onChangeText={setText}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onSubmitEditing={() => capture("append")}
      />
      <View style={styles.captureActions}>
        <Pressable
          style={({ pressed }) => [
            styles.captureButton,
            { backgroundColor: theme.primary },
            pressed && styles.pressed80,
            disabled && styles.disabled,
          ]}
          disabled={disabled}
          onPress={() => capture("append")}
        >
          <Text style={[styles.captureButtonLabel, { color: theme.primaryForeground }]}>
            Note it
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.captureButton,
            styles.outlineButton,
            { borderColor: theme.border, backgroundColor: theme.card },
            pressed && styles.pressed70,
            disabled && styles.disabled,
          ]}
          disabled={disabled}
          onPress={() => capture("task")}
        >
          <Text style={[styles.captureButtonLabel, { color: theme.cardForeground }]}>Task it</Text>
        </Pressable>
      </View>
      {confirmation !== null ? (
        <Text style={[styles.captionText, { color: theme.mutedForeground }]}>{confirmation}</Text>
      ) : null}
    </View>
  );
}

// ---- vault ----------------------------------------------------------------

function describeStatus(status: SyncStatus): string {
  switch (status.phase) {
    case "idle":
      return "Not synced yet";
    case "syncing":
      return "Syncing…";
    case "ok":
      return `Synced — ↑${status.pushed} ↓${status.pulled} ✕${status.deleted} ⚠${status.conflicts}`;
    // The confirmation has to live HERE. The gate runs per device against that
    // device's own anchor, so a desktop confirmation does not clear this
    // phone's hold — it is what causes it, once those deletes reach the
    // coordinator. And a hold is held WHOLE: notes captured on this phone stop
    // leaving it too, until someone releases the pass on this screen.
    case "held":
      return `Sync paused — ${status.deletions} of ${status.baseCount} files would be deleted. Nothing was changed. Tap to review.`;
    case "error":
      return `Sync failed: ${status.message}`;
  }
}

function VaultScreen({ device }: { device: EnrolledDevice | null }) {
  const theme = useTheme();
  const router = useRouter();
  const status = useSyncStatus();
  const held = status.phase === "held" ? status : null;
  const [files, setFiles] = useState(listVaultFiles);
  const [refreshing, setRefreshing] = useState(false);

  // Foregrounded + signed in (this screen only mounts with a session): sync on
  // activation and hold the SSE change stream — remote edits sync in near-real
  // time. Backgrounding closes the stream; manual triggers below are untouched.
  useRealtimeSync();

  const reload = useCallback(() => {
    setFiles(listVaultFiles());
  }, []);

  // A realtime/foreground pass lands outside `runSync` below — refresh the
  // listing whenever any pass completes so pulled files appear without a pull.
  useEffect(() => {
    if (status.phase === "ok") reload();
  }, [status, reload]);

  const runSync = useCallback(
    async (opts?: SyncPassOptions) => {
      setRefreshing(true);
      await syncOnce(opts);
      reload();
      setRefreshing(false);
    },
    [reload],
  );

  // The only place a `confirmDeletions` may originate on this device: the user
  // read the count and the sample and pressed the destructive action. The
  // approved COUNT rides along, so a plan that grew since this alert was drawn
  // holds again instead of being waived by it.
  const reviewHold = useCallback(
    (hold: HeldSyncStatus) => {
      const more = hold.deletions - hold.sample.length;
      const listing = hold.sample.join("\n") + (more > 0 ? `\n…and ${more} more` : "");
      Alert.alert(
        `Delete ${hold.deletions} file${hold.deletions === 1 ? "" : "s"}?`,
        `This pass would delete ${hold.deletions} of the ${hold.baseCount} files the last sync recorded. Syncing removes them from this device and from every other device that still has them, permanently — sync deletes do not go to the trash.\n\n${listing}`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete and sync",
            style: "destructive",
            onPress: () => void runSync({ confirmDeletions: hold.deletions }),
          },
        ],
      );
    },
    [runSync],
  );

  const signOut = useCallback(async () => {
    stopSync();
    await authClient.signOut();
    clearBearerToken();
  }, []);

  // The only way off a paired vault, and it is purely local: the coordinator
  // cannot tell "I am leaving" from "strand this vault", so it is never asked.
  // The desktop's device list is where this phone's key gets revoked.
  const disconnect = useCallback(() => {
    Alert.alert(
      "Disconnect this vault?",
      "This phone stops syncing and forgets its key. Notes already on the device stay; nothing is removed from the vault. Pair again with a new code from the desktop, and remove this device there when you're done with it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            stopSync();
            disconnectDevice();
          },
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["top", "left", "right"]}
    >
      <Stack.Screen options={{ title: "Vault" }} />
      <HostNavRow />
      <CaptureBox onCaptured={reload} />
      <View style={styles.syncRow}>
        <Pressable
          style={({ pressed }) => [
            styles.syncStatusSlot,
            pressed && held !== null && styles.pressed70,
          ]}
          disabled={held === null}
          onPress={() => {
            if (held !== null) reviewHold(held);
          }}
        >
          <Text
            style={[
              styles.syncStatus,
              { color: held !== null ? theme.destructive : theme.mutedForeground },
            ]}
          >
            {describeStatus(status)}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.syncButton,
            { backgroundColor: theme.primary },
            pressed && styles.pressed80,
          ]}
          disabled={refreshing}
          onPress={() => void runSync()}
        >
          <Text style={[styles.captureButtonLabel, { color: theme.primaryForeground }]}>
            {refreshing ? "Syncing…" : "Sync"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.fileList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void runSync()} />}
      >
        {files.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>
              No notes on this device yet.
            </Text>
            <Text style={[styles.smallText, { color: theme.mutedForeground }]}>
              Pull to refresh or tap Sync.
            </Text>
          </View>
        ) : (
          files.map((path) => (
            <Pressable
              key={path}
              style={({ pressed }) => [
                styles.fileRow,
                { borderColor: theme.border, backgroundColor: theme.card },
                pressed && styles.pressed70,
              ]}
              onPress={() => router.push({ pathname: "/note/[path]", params: { path } })}
            >
              <Text style={[styles.bodyText, { color: theme.cardForeground }]} numberOfLines={1}>
                {path}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        {device !== null ? (
          <View style={styles.footerRow}>
            <Text
              style={[styles.captionText, { color: theme.mutedForeground }]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {`Vault ${device.vaultId}`}
            </Text>
            <Pressable style={styles.textButton} onPress={disconnect}>
              <Text style={[styles.smallText, { color: theme.destructive }]}>Disconnect</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.textButton} onPress={() => void signOut()}>
            <Text style={[styles.smallText, { color: theme.mutedForeground }]}>Sign out</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centeredScreen: { flex: 1, alignItems: "center", justifyContent: "center" },

  signInBody: {
    flex: 1,
    justifyContent: "center",
    gap: SPACE.xl,
    paddingHorizontal: SPACE.xxl,
  },
  signInHeader: { gap: SPACE.xs },
  fields: { gap: SPACE.md },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    fontSize: 16,
  },
  submitButton: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    paddingVertical: SPACE.md,
  },
  textButton: { alignItems: "center", paddingVertical: SPACE.xs },

  navRow: {
    flexDirection: "row",
    gap: SPACE.sm,
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.md,
  },
  navPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: SPACE.md,
    paddingVertical: 6,
  },
  navPillLabel: { fontSize: 14, fontWeight: "500" },
  statusDot: { height: 8, width: 8, borderRadius: RADIUS.full },

  captureBox: { gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
  captureActions: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  captureButton: {
    flex: 1,
    alignItems: "center",
    borderRadius: RADIUS.md,
    paddingVertical: 10,
  },
  outlineButton: { borderWidth: 1 },
  captureButtonLabel: { fontSize: 14, fontWeight: "600" },

  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  syncStatusSlot: { flex: 1, paddingRight: SPACE.md },
  syncStatus: { fontSize: 14 },
  syncButton: {
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
  },

  fileList: { paddingHorizontal: SPACE.lg, paddingBottom: 32 },
  emptyState: { alignItems: "center", gap: SPACE.sm, paddingVertical: 96 },
  fileRow: {
    marginBottom: SPACE.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACE.md,
  },

  title: { fontSize: 30, fontWeight: "700" },
  bodyText: { fontSize: 16 },
  smallText: { fontSize: 14 },
  captionText: { fontSize: 12 },
  buttonLabel: { fontSize: 16, fontWeight: "600" },

  pressed70: { opacity: 0.7 },
  pressed80: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
