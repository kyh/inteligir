import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { TRPCReactProvider } from "@/lib/trpc";

export default function RootLayout() {
  return (
    <TRPCReactProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#1a1a1a" },
          headerTintColor: "#fff",
          contentStyle: { backgroundColor: "#111" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Inteligir" }} />
        <Stack.Screen name="pair" options={{ title: "Pair Device" }} />
        <Stack.Screen name="dispatch" options={{ title: "Dispatch" }} />
        <Stack.Screen name="auth" options={{ title: "Sign In", headerShown: false }} />
      </Stack>
    </TRPCReactProvider>
  );
}
