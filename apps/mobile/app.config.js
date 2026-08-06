// Native + product identity for the inteligir mobile companion. Mirrors the
// template's app.config shape; the identity is inteligir's.
//
// Plain JS, not TS: the workspace TypeScript is the 7.x native preview, which
// drops the compiler JS API that expo's config loader (@expo/require-utils)
// needs to evaluate a .ts config — a TS config crashes `expo start` on every
// target.
/** @param {import("expo/config").ConfigContext} ctx
 *  @returns {import("expo/config").ExpoConfig} */
module.exports = ({ config }) => ({
  ...config,
  name: "inteligir",
  slug: "inteligir",
  scheme: "inteligir",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon-light.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "app.inteligir.mobile",
    supportsTablet: true,
    icon: {
      light: "./assets/icon-light.png",
      dark: "./assets/icon-dark.png",
    },
  },
  android: {
    package: "app.inteligir.mobile",
    adaptiveIcon: {
      foregroundImage: "./assets/icon-light.png",
      backgroundColor: "#171717",
    },
  },
  // Fill `eas.projectId` once the app is registered with EAS (`eas init`).
  extra: {
    // eas: { projectId: "your-eas-project-id" },
  },
  // No OTA updates: this is a companion shipped through the store, and the app
  // is not registered with EAS. Declared explicitly rather than
  // left to default — Expo's tooling (and knip's expo plugin) otherwise assume
  // `expo-updates` is a dependency, which meant carrying a knip ignore for a
  // package nothing installs. State the truth in the native config instead.
  updates: { enabled: false },
  // Only the flags that still gate behaviour in SDK 57 belong here.
  // `tsconfigPaths` was dropped because @expo/cli reads it as `?? true`, and
  // `reactCanary` because React 19 is the default — its sole remaining effect
  // was the CLI's "remove unused experiments.reactCanary flag" warning.
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#FAFAFA",
        image: "./assets/icon-light.png",
        dark: {
          backgroundColor: "#171717",
          image: "./assets/icon-dark.png",
        },
      },
    ],
  ],
});
