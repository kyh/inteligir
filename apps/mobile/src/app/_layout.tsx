import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { refreshSession } from "@/lib/session";
import { themeFor } from "@/lib/theme";

// The stored token is checked against the server once per launch. Guarded
// module-level: the root layout remounts on fast refresh, and a second check
// would be a wasted round trip.
let sessionChecked = false;

function useSessionRestore() {
  useEffect(() => {
    if (sessionChecked) return;
    sessionChecked = true;
    void refreshSession();
  }, []);
}

// The root layout: SafeArea + a themed native Stack.
export default function RootLayout() {
  useSessionRestore();
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
