import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";

import { usePairDevice } from "@/lib/use-dispatch";

export default function PairScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const pairDevice = usePairDevice();

  const handlePair = () => {
    if (code.length !== 6) return;

    pairDevice.mutate(
      { code: code.toUpperCase() },
      {
        onSuccess: (data) => {
          router.replace({
            pathname: "/dispatch",
            params: { deviceId: data.deviceId, deviceName: data.name },
          });
        },
      },
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Pair Your Desktop</Text>
        <Text style={styles.subtitle}>
          Enter the 6-character code displayed on your desktop app.
        </Text>

        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(text) => setCode(text.toUpperCase().slice(0, 6))}
          placeholder="ABC123"
          placeholderTextColor="#444"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          textAlign="center"
        />

        {pairDevice.error && (
          <Text style={styles.error}>
            {pairDevice.error.message ?? "Failed to pair device"}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.button, code.length !== 6 && styles.buttonDisabled]}
          onPress={handlePair}
          disabled={code.length !== 6 || pairDevice.isPending}
        >
          {pairDevice.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Pair Device</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#999",
    textAlign: "center",
    marginBottom: 40,
    lineHeight: 22,
  },
  codeInput: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 20,
    fontSize: 32,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 12,
    borderWidth: 2,
    borderColor: "#d1684e",
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#d1684e",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: "#ef4444",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
});
