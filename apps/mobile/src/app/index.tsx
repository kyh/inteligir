import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { SyncStatus } from "@repo/notes/sync/status";

import { authClient, clearBearerToken } from "@/lib/auth";
import { appendCapture } from "@/lib/capture/daily-capture";
import { createVaultCaptureIo } from "@/lib/capture/capture-io";
import { useHostStatus } from "@/lib/host/connection";
import { hostStatusDotClass } from "@/lib/host/status-display";
import { scheduleSync, syncOnce, useSyncStatus } from "@/lib/sync/manager";
import { useRealtimeSync } from "@/lib/sync/realtime-manager";
import { listVaultFiles } from "@/lib/sync/vault-access";

// ---------------------------------------------------------------------------
// The home surface. Gates on the Better Auth session: signed out → email/password
// form; signed in → the vault screen (local file list + manual sync + sign-out).
// ---------------------------------------------------------------------------

export default function Index() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: "inteligir" }} />
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return session ? <VaultScreen /> : <SignInScreen />;
}

// ---- sign in / sign up ----------------------------------------------------

function nameFromEmail(email: string): string {
  const local = email.split("@")[0];
  return local !== undefined && local !== "" ? local : "there";
}

function SignInScreen() {
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
    <SafeAreaView className="flex-1 bg-background">
      <Stack.Screen options={{ title: "inteligir" }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-center gap-5 px-6">
          <View className="gap-1">
            <Text className="text-3xl font-bold text-foreground">inteligir</Text>
            <Text className="text-base text-muted-foreground">
              {mode === "signup"
                ? "Create an account to sync your vault."
                : "Sign in to sync your vault."}
            </Text>
          </View>

          <View className="gap-3">
            <TextInput
              className="rounded-lg border border-input bg-card px-4 py-3 text-base text-foreground"
              placeholder="Email"
              placeholderTextColor="#737373"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              className="rounded-lg border border-input bg-card px-4 py-3 text-base text-foreground"
              placeholder="Password"
              placeholderTextColor="#737373"
              autoCapitalize="none"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          {error !== null ? <Text className="text-sm text-destructive">{error}</Text> : null}

          <Pressable
            className="items-center rounded-lg bg-primary py-3 active:opacity-80 disabled:opacity-50"
            disabled={disabled}
            onPress={() => void submit()}
          >
            {submitting ? (
              <ActivityIndicator color="#fafafa" />
            ) : (
              <Text className="text-base font-semibold text-primary-foreground">
                {mode === "signup" ? "Create account" : "Sign in"}
              </Text>
            )}
          </Pressable>

          <Pressable
            className="items-center py-1"
            onPress={() => {
              setError(null);
              setMode(mode === "signup" ? "signin" : "signup");
            }}
          >
            <Text className="text-sm text-muted-foreground">
              {mode === "signup" ? "Have an account? Sign in" : "No account? Sign up"}
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
    <View className="flex-row gap-2 px-4 pt-3">
      <NavPill label="Chat" onPress={() => router.push("/chat")} />
      <NavPill label="Delegations" onPress={() => router.push("/delegations")} />
      <NavPill
        label="Connect"
        dotClass={hostStatusDotClass(status)}
        onPress={() => router.push("/connect")}
      />
    </View>
  );
}

function NavPill({
  label,
  dotClass,
  onPress,
}: {
  label: string;
  dotClass?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 active:opacity-70"
      onPress={onPress}
    >
      {dotClass !== undefined ? <View className={`h-2 w-2 rounded-full ${dotClass}`} /> : null}
      <Text className="text-sm font-medium text-card-foreground">{label}</Text>
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
    <View className="gap-2 px-4 pt-3">
      <TextInput
        className="rounded-lg border border-input bg-card px-4 py-3 text-base text-foreground"
        placeholder="Capture to today’s note…"
        placeholderTextColor="#737373"
        value={text}
        onChangeText={setText}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onSubmitEditing={() => capture("append")}
      />
      <View className="flex-row items-center gap-2">
        <Pressable
          className="flex-1 items-center rounded-lg bg-primary py-2.5 active:opacity-80 disabled:opacity-50"
          disabled={disabled}
          onPress={() => capture("append")}
        >
          <Text className="text-sm font-semibold text-primary-foreground">Note it</Text>
        </Pressable>
        <Pressable
          className="flex-1 items-center rounded-lg border border-border bg-card py-2.5 active:opacity-70 disabled:opacity-50"
          disabled={disabled}
          onPress={() => capture("task")}
        >
          <Text className="text-sm font-semibold text-card-foreground">Task it</Text>
        </Pressable>
      </View>
      {confirmation !== null ? (
        <Text className="text-xs text-muted-foreground">{confirmation}</Text>
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
    case "error":
      return `Sync failed: ${status.message}`;
  }
}

function VaultScreen() {
  const router = useRouter();
  const status = useSyncStatus();
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

  const runSync = useCallback(async () => {
    setRefreshing(true);
    await syncOnce();
    reload();
    setRefreshing(false);
  }, [reload]);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    clearBearerToken();
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Vault" }} />
      <HostNavRow />
      <CaptureBox onCaptured={reload} />
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="flex-1 pr-3 text-sm text-muted-foreground">{describeStatus(status)}</Text>
        <Pressable
          className="rounded-lg bg-primary px-4 py-2 active:opacity-80"
          disabled={refreshing}
          onPress={() => void runSync()}
        >
          <Text className="text-sm font-semibold text-primary-foreground">
            {refreshing ? "Syncing…" : "Sync"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void runSync()} />}
      >
        {files.length === 0 ? (
          <View className="items-center gap-2 py-24">
            <Text className="text-base text-muted-foreground">No notes on this device yet.</Text>
            <Text className="text-sm text-muted-foreground">Pull to refresh or tap Sync.</Text>
          </View>
        ) : (
          files.map((path) => (
            <Pressable
              key={path}
              className="mb-2 rounded-lg border border-border bg-card px-4 py-3 active:opacity-70"
              onPress={() => router.push({ pathname: "/note/[path]", params: { path } })}
            >
              <Text className="text-base text-card-foreground" numberOfLines={1}>
                {path}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>

      <View className="border-t border-border px-4 py-3">
        <Pressable className="items-center py-1" onPress={() => void signOut()}>
          <Text className="text-sm text-muted-foreground">Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
