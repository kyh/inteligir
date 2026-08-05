import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
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

import { enrollDevice } from "@/lib/sync/device";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Pair this phone with a desktop vault: paste the block the desktop's
// Settings → Sync → Devices produces, and this device generates a key, joins
// the vault the block names, and starts syncing it.
//
// Paste, not scan: it is the muscle the desktop pairing already trains, and it
// costs no camera dependency. The block is a live capability for the few
// minutes its offer lasts, so it is treated like a password field — no
// autocorrect, no autocapitalize, nothing kept after a successful join.
//
// This device NEVER founds a vault. The vault is the desktop's folder on disk;
// a phone-founded one is a second vault that never converges with it.
// ---------------------------------------------------------------------------

const DEFAULT_DEVICE_NAME = Platform.select({
  ios: "iPhone",
  android: "Android phone",
  default: "Mobile device",
});

export default function PairScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [blob, setBlob] = useState("");
  const [deviceName, setDeviceName] = useState(DEFAULT_DEVICE_NAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setError(null);
    setBusy(true);
    const name = deviceName.trim() === "" ? DEFAULT_DEVICE_NAME : deviceName.trim();
    const result = await enrollDevice(blob, name);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBlob("");
    router.replace("/");
  }, [blob, deviceName, router]);

  const disabled = busy || blob.trim() === "";

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: theme.background }]}
      edges={["left", "right", "bottom"]}
    >
      <Stack.Screen options={{ title: "Pair vault" }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.intro}>
            <Text style={[styles.title, { color: theme.foreground }]}>Pair with your desktop</Text>
            <Text style={[styles.blurb, { color: theme.mutedForeground }]}>
              On your desktop, open Settings → Sync → Devices and choose Pair a device. Paste the
              whole block below. It works once and expires within minutes.
            </Text>
          </View>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.mutedForeground }]}>Pairing code</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.blobInput,
                  {
                    borderColor: theme.input,
                    backgroundColor: theme.card,
                    color: theme.foreground,
                  },
                ]}
                placeholder="Paste the block from the desktop"
                placeholderTextColor={theme.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                multiline
                value={blob}
                onChangeText={setBlob}
              />
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.mutedForeground }]}>
                This device's name
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: theme.input,
                    backgroundColor: theme.card,
                    color: theme.foreground,
                  },
                ]}
                placeholder={DEFAULT_DEVICE_NAME}
                placeholderTextColor={theme.mutedForeground}
                value={deviceName}
                onChangeText={setDeviceName}
              />
            </View>
          </View>

          {error !== null ? (
            <Text style={[styles.label, { color: theme.destructive }]}>{error}</Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.submit,
              { backgroundColor: theme.primary },
              disabled && styles.disabled,
              pressed && styles.pressed80,
            ]}
            disabled={disabled}
            onPress={() => void submit()}
          >
            {busy ? (
              <ActivityIndicator color={theme.primaryForeground} />
            ) : (
              <Text style={[styles.submitLabel, { color: theme.primaryForeground }]}>
                Pair this device
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: SPACE.xl, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg },
  intro: { gap: SPACE.xs },
  title: { fontSize: 22, fontWeight: "700" },
  blurb: { fontSize: 14, lineHeight: 20 },
  fields: { gap: SPACE.md },
  field: { gap: 6 },
  label: { fontSize: 14 },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    fontSize: 16,
  },
  blobInput: { minHeight: 96, textAlignVertical: "top" },
  submit: { alignItems: "center", borderRadius: RADIUS.md, paddingVertical: SPACE.md },
  submitLabel: { fontSize: 16, fontWeight: "600" },
  pressed80: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
