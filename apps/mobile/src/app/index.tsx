import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, Redirect, Stack } from "expo-router";

import {
  getMobileToken,
  getDeviceId,
  getDeviceName,
} from "@/utils/session-store";

export default function Index() {
  const mobileToken = getMobileToken();
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();

  // If already paired, go straight to dispatch
  if (mobileToken && deviceId) {
    return (
      <Redirect
        href={{
          pathname: "/dispatch",
          params: { deviceId, deviceName: deviceName ?? "Desktop" },
        }}
      />
    );
  }

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Inteligir" }} />
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-primary mb-2 text-center text-4xl font-bold">
          Inteligir
        </Text>
        <Text className="text-muted-foreground mb-10 text-center text-base">
          Connect to your desktop agent
        </Text>

        <Link href="/pair" asChild>
          <Pressable className="bg-primary w-full items-center rounded-xl p-4">
            <Text className="text-primary-foreground text-base font-semibold">
              Pair Device
            </Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}
