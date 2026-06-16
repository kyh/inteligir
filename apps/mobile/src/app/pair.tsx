import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { parsePairingString } from "@repo/dispatch/pairing";

import { setCredential } from "@/utils/session-store";

export default function PairScreen() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleConnect = () => {
    const credential = parsePairingString(value);
    if (!credential) {
      setError(
        "That doesn't look like a pairing string. Copy the full string " +
          "(XXXX-XXXX-XXXX-XXXX.token) from Remote Access on your desktop.",
      );
      return;
    }
    setCredential(credential);
    router.replace("/dispatch");
  };

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Pair" }} />
      <View className="flex-1 justify-center px-6">
        <Text className="text-foreground mb-2 text-center text-2xl font-bold">
          Pair with your desktop
        </Text>
        <Text className="text-muted-foreground mb-10 text-center text-sm leading-5">
          Enable Remote Access in the desktop app, then paste the pairing string it shows you.
        </Text>

        <TextInput
          className="border-primary bg-muted text-foreground mb-3 rounded-xl border-2 p-4 text-center font-mono text-base"
          value={value}
          onChangeText={(text) => {
            setValue(text);
            setError(null);
          }}
          placeholder="XXXX-XXXX-XXXX-XXXX.token"
          placeholderTextColor="#444"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textAlign="center"
          returnKeyType="go"
          onSubmitEditing={handleConnect}
        />

        {error !== null && (
          <Text className="text-destructive mb-3 text-center text-xs leading-4">{error}</Text>
        )}

        <Pressable
          className="bg-primary items-center rounded-xl p-4 disabled:opacity-50"
          onPress={handleConnect}
          disabled={!value.trim()}
        >
          <Text className="text-primary-foreground text-base font-semibold">Pair</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
