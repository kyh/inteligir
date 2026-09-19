import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ensureStarted } from "@/lib/app-runtime";
import { themeFor } from "@/lib/theme";

// ensureStarted is idempotent; the guard only spares a fast-refresh remount re-running it.
let started = false;

const useAppStart = (): void => {
  useEffect(() => {
    if (started) {
      return;
    }
    started = true;
    void ensureStarted();
  }, []);
};

const RootLayout = () => {
  useAppStart();
  const theme = themeFor(useColorScheme() === "dark");
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: theme.background },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.foreground,
        }}
      />
      <StatusBar />
    </SafeAreaProvider>
  );
};

export default RootLayout;
