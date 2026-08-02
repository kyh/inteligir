import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { startHostConnection } from "@/lib/host/connection";
import { hostEnvironmentStore } from "@/lib/host/expo-environment-store";
import { themeFor } from "@/lib/theme";

// Reconnect to the paired desktop (if any) once per app launch — the saved
// environment carries the durable device token, so no user action is needed.
// Guarded module-level: the root layout can remount (fast refresh), and a
// second start() would needlessly tear down a healthy connection.
let hostAutoStarted = false;

function useHostAutoStart() {
  useEffect(() => {
    if (hostAutoStarted) return;
    hostAutoStarted = true;
    const env = hostEnvironmentStore.get();
    if (env !== null) startHostConnection(env);
  }, []);
}

// The root layout: SafeArea + a themed native Stack. No QueryClient — sync is
// direct via @repo/notes, not an API/tRPC layer.
export default function RootLayout() {
  useHostAutoStart();
  const theme = themeFor(useColorScheme() === "dark");
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.foreground,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      />
      {/* expo-status-bar defaults to "auto" — follows the device color scheme. */}
      <StatusBar />
    </SafeAreaProvider>
  );
}
