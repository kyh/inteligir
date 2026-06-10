import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Inteligir",
  slug: "inteligir",
  scheme: "inteligir",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  // No OTA updates configured; expo-updates is intentionally not installed.
  updates: { enabled: false },
  ios: {
    bundleIdentifier: "com.inteligir.mobile",
    supportsTablet: true,
  },
  android: {
    package: "com.inteligir.mobile",
    adaptiveIcon: {
      backgroundColor: "#d1684e",
    },
  },
  experiments: {
    tsconfigPaths: true,
    typedRoutes: true,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#18181B",
      },
    ],
  ],
});
