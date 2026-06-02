import { useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import "../styles.css";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#1a1a1a" },
          headerTintColor: "#fff",
          contentStyle: {
            backgroundColor: colorScheme === "dark" ? "#111" : "#fff",
          },
        }}
      />
      <StatusBar style="light" />
    </>
  );
}
