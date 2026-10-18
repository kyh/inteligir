import { Stack } from "expo-router";
import { ShareIntentProvider } from "expo-share-intent";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ShareInbox } from "@/items/share-inbox";
import { ensureStarted, useSyncStatus } from "@/lib/app-runtime";
import { useTheme } from "@/lib/theme";

// the app's classes: one sheet, read once at the root, so every screen's className resolves
import "../styles.css";

// held until the stored credential is read, so a cold launch never flashes the sign-in form.
void SplashScreen.preventAutoHideAsync();

// a share waits through the background: one made while the app was asleep or signed out is saved
// once the inbox is mounted, never dropped on the way to the foreground
const SHARE_OPTIONS = { resetOnBackground: false };

const RootLayout = () => {
  const status = useSyncStatus();
  const theme = useTheme();
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
      <ShareIntentProvider options={SHARE_OPTIONS}>
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
            <Stack.Screen name="item/[...path]" />
            <Stack.Screen name="view/[...path]" />
            <Stack.Screen name="threads" />
            <Stack.Screen name="thread/[id]" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
        </Stack>
        {signedIn ? <ShareInbox /> : null}
        <StatusBar />
      </ShareIntentProvider>
    </SafeAreaProvider>
  );
};

export default RootLayout;
