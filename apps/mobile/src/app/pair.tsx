import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";

import { setRoomCode } from "@/utils/session-store";

export default function PairScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");

  const handleConnect = () => {
    const roomCode = code.toUpperCase().trim();
    if (roomCode.length !== 6) return;
    setRoomCode(roomCode);
    router.replace({
      pathname: "/dispatch",
      params: { roomCode },
    });
  };

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Connect" }} />
      <View className="flex-1 justify-center px-6">
        <Text className="text-foreground mb-2 text-center text-2xl font-bold">
          Connect to Desktop
        </Text>
        <Text className="text-muted-foreground mb-10 text-center text-sm leading-5">
          Enter the 6-character code displayed on your desktop app.
        </Text>

        <TextInput
          className="border-primary bg-muted text-foreground mb-6 rounded-xl border-2 p-5 text-center text-3xl font-bold tracking-widest"
          value={code}
          onChangeText={(text) => setCode(text.toUpperCase().slice(0, 6))}
          placeholder="ABC123"
          placeholderTextColor="#444"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          textAlign="center"
        />

        <Pressable
          className="bg-primary items-center rounded-xl p-4 disabled:opacity-50"
          onPress={handleConnect}
          disabled={code.length !== 6}
        >
          <Text className="text-primary-foreground text-base font-semibold">
            Connect
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
