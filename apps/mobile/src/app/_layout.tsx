import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "../styles.css";

// Resolved zinc surface/foreground tokens for the native navigation chrome
// (header + screen background), which is styled imperatively rather than via
// className. Kept in sync with src/styles.css.
const BG = { light: "#fafafa", dark: "#171717" };
const FG = { light: "#171717", dark: "#f5f5f5" };

// The root layout: SafeArea + a themed native Stack. No QueryClient — sync is
// direct via @repo/core, not an API/tRPC layer.
export default function RootLayout() {
  const dark = useColorScheme() === "dark";
  const bg = dark ? BG.dark : BG.light;
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: bg },
          headerTintColor: dark ? FG.dark : FG.light,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: bg },
        }}
      />
      {/* expo-status-bar defaults to "auto" — follows the device color scheme. */}
      <StatusBar />
    </SafeAreaProvider>
  );
}
