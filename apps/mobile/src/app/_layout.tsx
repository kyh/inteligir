import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ensureStarted } from "@/lib/app-runtime";
import { themeFor } from "@/lib/theme";

// Read the stored credential, arm the pairing deep-link listener, and start
// syncing — once per launch. `ensureStarted` is idempotent; the guard just keeps
// a fast-refresh remount from re-running it.
let started = false;

function useAppStart(): void {
  useEffect(() => {
    if (started) return;
    started = true;
    void ensureStarted();
  }, []);
}

export default function RootLayout() {
  useAppStart();
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
      <StatusBar />
    </SafeAreaProvider>
  );
}
