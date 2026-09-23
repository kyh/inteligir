import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ensureStarted, useSyncStatus } from "@/lib/app-runtime";
import { themeFor } from "@/lib/theme";

// held until the stored credential is read, so a cold launch never flashes the sign-in form.
void SplashScreen.preventAutoHideAsync();

const RootLayout = () => {
  const status = useSyncStatus();
  const theme = themeFor(useColorScheme() === "dark");
  const restoring = status.state === "restoring";

  useEffect(() => {
    void ensureStarted();
  }, []);

  useEffect(() => {
    if (!restoring) {
      SplashScreen.hide();
    }
  }, [restoring]);

  // no navigator until then, so no guard is decided on a status about to change: a guard that
  // flips drops the history of the screens it covered.
  if (restoring) {
    return null;
  }

  const signedIn = status.state === "signed-in";
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: theme.background },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.foreground,
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="notes/index" />
          <Stack.Screen name="notes/[...path]" />
          <Stack.Screen name="thread/[id]" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
      <StatusBar />
    </SafeAreaProvider>
  );
};

export default RootLayout;
