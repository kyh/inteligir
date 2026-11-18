import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { ShareIntentProvider } from "expo-share-intent";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ShareInbox } from "@/items/share-inbox";
import { ensureStarted, getRuntime, useSession } from "@/lib/app-runtime";
import type { PhoneSession } from "@/lib/compose-runtime";
import { LibraryContext } from "@/lib/library-hooks";
import { useTheme } from "@/lib/theme";

import "../styles.css";

void SplashScreen.preventAutoHideAsync();

const SHARE_OPTIONS = { resetOnBackground: false };

const stoppedLine = (session: Extract<PhoneSession, { kind: "outdated" | "failed" }>) =>
  session.kind === "outdated"
    ? "This version of Inteligir is too old for your library. Update it from the App Store to go on."
    : `Your library couldn't open on this iPhone: ${session.message}`;

const RootLayout = () => {
  const session = useSession();
  const theme = useTheme();
  const restoring = session.kind === "restoring";

  useEffect(() => {
    void ensureStarted();
  }, []);

  useEffect(() => {
    if (!restoring) {
      SplashScreen.hide();
    }
  }, [restoring]);

  if (restoring) {
    return null;
  }

  if (session.kind === "outdated" || session.kind === "failed") {
    return (
      <View className="grow basis-0 items-center justify-center bg-background px-8">
        <Text className="text-center text-16 text-foreground">{stoppedLine(session)}</Text>
      </View>
    );
  }

  const library = session.kind === "signed-in" ? session.library : null;
  const { persistOptions, queryClient } = getRuntime();

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <LibraryContext value={library}>
          <ShareIntentProvider options={SHARE_OPTIONS}>
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: theme.background },
                headerShadowVisible: false,
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.foreground,
              }}
            >
              <Stack.Protected guard={library !== null}>
                <Stack.Screen name="index" />
                <Stack.Screen name="item/[id]" />
                <Stack.Screen name="view/[id]" />
                <Stack.Screen name="agent/index" options={{ title: "Conversations" }} />
                <Stack.Screen name="agent/[thread]" />
              </Stack.Protected>
              <Stack.Protected guard={library === null}>
                <Stack.Screen name="sign-in" />
              </Stack.Protected>
            </Stack>
            {library === null ? null : <ShareInbox />}
            <StatusBar />
          </ShareIntentProvider>
        </LibraryContext>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
};

export default RootLayout;
