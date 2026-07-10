import { Stack } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { startHostConnection, stopHostConnection, useHostStatus } from "@/lib/host/connection";
import type { KnownEnvironment } from "@/lib/host/environment-store";
import { hostEnvironmentStore } from "@/lib/host/expo-environment-store";
import { pairWithHost, parsePairingInput } from "@/lib/host/pairing";
import { hostStatusDotClass, hostStatusLabel } from "@/lib/host/status-display";

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
    <SafeAreaView className="flex-1 bg-background" edges={["left", "right", "bottom"]}>
      <Stack.Screen options={{ title: "Connect" }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-4 py-4"
          keyboardShouldPersistTaps="handled"
        >
          {env !== null ? (
            <View className="rounded-lg border border-border bg-card px-4 py-3">
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-base font-semibold text-card-foreground" numberOfLines={1}>
                    {env.name}
                  </Text>
                  <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                    {env.wsUrl}
                  </Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <View className={`h-2 w-2 rounded-full ${hostStatusDotClass(status)}`} />
                  <Text className="text-sm text-muted-foreground">{hostStatusLabel(status)}</Text>
                </View>
              </View>

              {status === "unauthorized" ? (
                <View className="mt-3 gap-2.5 rounded-lg bg-muted px-3 py-2.5">
                  <Text className="text-sm text-foreground">
                    The desktop no longer authorizes this device — remote access may be turned off,
                    or the pairing was revoked there. Try again, or pair with a fresh code.
                  </Text>
                  <Pressable
                    className="self-start rounded-lg border border-border bg-card px-3 py-1.5 active:opacity-70"
                    onPress={() => startHostConnection(env)}
                  >
                    <Text className="text-sm font-semibold text-foreground">Try again</Text>
                  </Pressable>
                </View>
              ) : null}

              <View className="mt-3 flex-row gap-5">
                {!formOpen ? (
                  <Pressable className="py-1 active:opacity-70" onPress={() => setFormOpen(true)}>
                    <Text className="text-sm font-semibold text-foreground">Pair again</Text>
                  </Pressable>
                ) : null}
                <Pressable className="py-1 active:opacity-70" onPress={forget}>
                  <Text className="text-sm font-semibold text-destructive">
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
    <View className="gap-4">
      <View className="gap-1">
        <Text className="text-lg font-semibold text-foreground">Pair with your desktop</Text>
        <Text className="text-sm leading-5 text-muted-foreground">
          On your desktop, open Settings → Remote access, allow other devices, and choose Pair a
          device. Paste the address and one-time code below — either field takes the whole thing.
        </Text>
      </View>

      <View className="gap-3">
        <View className="gap-1.5">
          <Text className="text-sm text-muted-foreground">Desktop address</Text>
          <TextInput
            className="rounded-lg border border-input bg-card px-4 py-3 text-base text-foreground"
            placeholder="ws://192.168.1.20:47890"
            placeholderTextColor="#737373"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={address}
            onChangeText={changeAddress}
          />
        </View>
        <View className="gap-1.5">
          <Text className="text-sm text-muted-foreground">Pairing code</Text>
          <TextInput
            className="rounded-lg border border-input bg-card px-4 py-3 text-base text-foreground"
            placeholder="Paste the one-time code"
            placeholderTextColor="#737373"
            autoCapitalize="none"
            autoCorrect={false}
            value={code}
            onChangeText={changeCode}
          />
        </View>
        <View className="gap-1.5">
          <Text className="text-sm text-muted-foreground">This device's name</Text>
          <TextInput
            className="rounded-lg border border-input bg-card px-4 py-3 text-base text-foreground"
            placeholder={DEFAULT_DEVICE_NAME}
            placeholderTextColor="#737373"
            value={deviceName}
            onChangeText={setDeviceName}
          />
        </View>
      </View>

      {error !== null ? <Text className="text-sm text-destructive">{error}</Text> : null}

      <Pressable
        className="items-center rounded-lg bg-primary py-3 active:opacity-80 disabled:opacity-50"
        disabled={disabled}
        onPress={() => void submit()}
      >
        {busy ? (
          <ActivityIndicator color="#fafafa" />
        ) : (
          <Text className="text-base font-semibold text-primary-foreground">Pair</Text>
        )}
      </Pressable>
    </View>
  );
}
