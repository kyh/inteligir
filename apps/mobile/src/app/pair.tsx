import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";

import { trpc } from "@/utils/api";
import { setDeviceId, setDeviceName, setMobileToken } from "@/utils/session-store";

export default function PairScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");

  const pairMutation = useMutation(
    trpc.dispatch.pair.mutationOptions({
      async onSuccess(data) {
        await setMobileToken(data.mobileToken);
        await setDeviceId(data.deviceId);
        await setDeviceName(data.name);
        router.replace({
          pathname: "/dispatch",
          params: { deviceId: data.deviceId, deviceName: data.name },
        });
      },
    }),
  );

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Pair Device" }} />
      <View className="flex-1 justify-center px-6">
        <Text className="text-foreground mb-2 text-center text-2xl font-bold">
          Pair Your Desktop
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

        {pairMutation.error && (
          <Text className="text-destructive mb-4 text-center text-sm">
            {pairMutation.error.message ?? "Failed to pair device"}
          </Text>
        )}

        <Pressable
          className="bg-primary items-center rounded-xl p-4 disabled:opacity-50"
          onPress={() => pairMutation.mutate({ code: code.toUpperCase() })}
          disabled={code.length !== 6 || pairMutation.isPending}
        >
          {pairMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-primary-foreground text-base font-semibold">
              Pair Device
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
