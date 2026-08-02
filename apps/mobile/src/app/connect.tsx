import { Stack } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { startHostConnection, stopHostConnection, useHostStatus } from "@/lib/host/connection";
import type { KnownEnvironment } from "@/lib/host/environment-store";
import { hostEnvironmentStore } from "@/lib/host/expo-environment-store";
import { pairWithHost, parsePairingInput } from "@/lib/host/pairing";
import { hostStatusDotColor, hostStatusLabel } from "@/lib/host/status-display";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Pair-with-desktop: redeem the one-time code shown in the desktop's
// Settings → Remote access for a durable device token, then keep the saved
// environment visible (name, address, live status) with re-pair / forget
// affordances. A sticky `unauthorized` status (remote access off, or the
// pairing revoked on the desktop) gets an explainer plus both recovery paths.
// ---------------------------------------------------------------------------

const DEFAULT_DEVICE_NAME = Platform.select({
  ios: "iPhone",
  android: "Android phone",
  default: "Mobile device",
});

export default function ConnectScreen() {
  const theme = useTheme();
  const { status } = useHostStatus();
  const [env, setEnv] = useState<KnownEnvironment | null>(() => hostEnvironmentStore.get());
  const [formOpen, setFormOpen] = useState(env === null);

  const forget = useCallback(() => {
    Alert.alert(
      "Forget this desktop?",
      "This device disconnects and its pairing is dropped locally. You'll need a new pairing code to reconnect.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            stopHostConnection();
            hostEnvironmentStore.clear();
            setEnv(null);
            setFormOpen(true);
          },
        },
      ],
    );
  }, []);

  const onPaired = useCallback((paired: KnownEnvironment) => {
    setEnv(paired);
    setFormOpen(false);
    startHostConnection(paired);
  }, []);

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: theme.background }]}
      edges={["left", "right", "bottom"]}
    >
      <Stack.Screen options={{ title: "Connect" }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {env !== null ? (
            <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <View style={styles.cardHeader}>
                <View style={styles.flex}>
                  <Text style={[styles.envName, { color: theme.cardForeground }]} numberOfLines={1}>
                    {env.name}
                  </Text>
                  <Text style={[styles.bodySm, { color: theme.mutedForeground }]} numberOfLines={1}>
                    {env.wsUrl}
                  </Text>
                </View>
                <View style={styles.statusRow}>
                  <View
                    style={[styles.statusDot, { backgroundColor: hostStatusDotColor(status) }]}
                  />
                  <Text style={[styles.bodySm, { color: theme.mutedForeground }]}>
                    {hostStatusLabel(status)}
                  </Text>
                </View>
              </View>

              {status === "unauthorized" ? (
                <View style={[styles.explainer, { backgroundColor: theme.muted }]}>
                  <Text style={[styles.bodySm, { color: theme.foreground }]}>
                    The desktop no longer authorizes this device — remote access may be turned off,
                    or the pairing was revoked there. Try again, or pair with a fresh code.
                  </Text>
                  <Pressable
                    style={({ pressed }) => [
                      styles.retryButton,
                      { borderColor: theme.border, backgroundColor: theme.card },
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() => startHostConnection(env)}
                  >
                    <Text style={[styles.actionLabel, { color: theme.foreground }]}>Try again</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.actions}>
                {!formOpen ? (
                  <Pressable
                    style={({ pressed }) => [styles.actionHit, pressed && { opacity: 0.7 }]}
                    onPress={() => setFormOpen(true)}
                  >
                    <Text style={[styles.actionLabel, { color: theme.foreground }]}>
                      Pair again
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={({ pressed }) => [styles.actionHit, pressed && { opacity: 0.7 }]}
                  onPress={forget}
                >
                  <Text style={[styles.actionLabel, { color: theme.destructive }]}>
                    Forget this desktop
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {formOpen ? <PairForm onPaired={onPaired} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---- pairing form -----------------------------------------------------------

function PairForm({ onPaired }: { onPaired: (env: KnownEnvironment) => void }) {
  const theme = useTheme();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState(DEFAULT_DEVICE_NAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Either field accepts the whole pasted blob: parsePairingInput splits a
  // combined "address + code" paste into the right fields.
  const changeAddress = useCallback((text: string) => {
    const parsed = parsePairingInput(text);
    if (parsed.wsUrl !== null && parsed.pairingToken !== null) {
      setAddress(parsed.wsUrl);
      setCode(parsed.pairingToken);
      return;
    }
    setAddress(parsed.wsUrl ?? text);
  }, []);

  const changeCode = useCallback((text: string) => {
    const parsed = parsePairingInput(text);
    if (parsed.wsUrl !== null && parsed.pairingToken !== null) {
      setAddress(parsed.wsUrl);
      setCode(parsed.pairingToken);
      return;
    }
    setCode(parsed.pairingToken ?? text);
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    setBusy(true);
    const trimmed = address.trim();
    // A bare "ip:port" (typed by hand) is fine — default the scheme.
    const wsUrl = /^wss?:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
    const name = deviceName.trim() === "" ? DEFAULT_DEVICE_NAME : deviceName.trim();
    const result = await pairWithHost({
      wsUrl,
      pairingToken: code.trim(),
      deviceName: name,
      store: hostEnvironmentStore,
    });
    setBusy(false);
    if (result.ok) onPaired(result.env);
    else setError(result.error);
  }, [address, code, deviceName, onPaired]);

  const disabled = busy || address.trim() === "" || code.trim() === "";

  return (
    <View style={styles.form}>
      <View style={styles.formIntro}>
        <Text style={[styles.formTitle, { color: theme.foreground }]}>Pair with your desktop</Text>
        <Text style={[styles.formBlurb, { color: theme.mutedForeground }]}>
          On your desktop, open Settings → Remote access, allow other devices, and choose Pair a
          device. Paste the address and one-time code below — either field takes the whole thing.
        </Text>
      </View>

      <View style={styles.fields}>
        <View style={styles.field}>
          <Text style={[styles.bodySm, { color: theme.mutedForeground }]}>Desktop address</Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: theme.input, backgroundColor: theme.card, color: theme.foreground },
            ]}
            placeholder="ws://192.168.1.20:47890"
            placeholderTextColor={theme.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={address}
            onChangeText={changeAddress}
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.bodySm, { color: theme.mutedForeground }]}>Pairing code</Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: theme.input, backgroundColor: theme.card, color: theme.foreground },
            ]}
            placeholder="Paste the one-time code"
            placeholderTextColor={theme.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            value={code}
            onChangeText={changeCode}
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.bodySm, { color: theme.mutedForeground }]}>This device's name</Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: theme.input, backgroundColor: theme.card, color: theme.foreground },
            ]}
            placeholder={DEFAULT_DEVICE_NAME}
            placeholderTextColor={theme.mutedForeground}
            value={deviceName}
            onChangeText={setDeviceName}
          />
        </View>
      </View>

      {error !== null ? (
        <Text style={[styles.bodySm, { color: theme.destructive }]}>{error}</Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.submit,
          { backgroundColor: theme.primary },
          disabled && { opacity: 0.5 },
          pressed && { opacity: 0.8 },
        ]}
        disabled={disabled}
        onPress={() => void submit()}
      >
        {busy ? (
          <ActivityIndicator color={theme.primaryForeground} />
        ) : (
          <Text style={[styles.submitLabel, { color: theme.primaryForeground }]}>Pair</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    gap: SPACE.xxl,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.lg,
  },
  card: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACE.md,
  },
  envName: { fontSize: 16, fontWeight: "600" },
  bodySm: { fontSize: 14 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { height: 8, width: 8, borderRadius: RADIUS.full },
  explainer: {
    marginTop: SPACE.md,
    gap: 10,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: 10,
  },
  retryButton: {
    alignSelf: "flex-start",
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.md,
    paddingVertical: 6,
  },
  actions: { marginTop: SPACE.md, flexDirection: "row", gap: SPACE.xl },
  actionHit: { paddingVertical: SPACE.xs },
  actionLabel: { fontSize: 14, fontWeight: "600" },
  form: { gap: SPACE.lg },
  formIntro: { gap: SPACE.xs },
  formTitle: { fontSize: 18, fontWeight: "600" },
  formBlurb: { fontSize: 14, lineHeight: 20 },
  fields: { gap: SPACE.md },
  field: { gap: 6 },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    fontSize: 16,
  },
  submit: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    paddingVertical: SPACE.md,
  },
  submitLabel: { fontSize: 16, fontWeight: "600" },
});
