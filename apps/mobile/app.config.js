// Native + product identity for the inteligir mobile companion. `scheme` is the
// custom URL scheme the pairing deep-link callback rides
// (`inteligir://pair/callback`, src/pairing/) — it is the redirect target a
// browser-approve hands the code back through.
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
  // The cloud Worker origin, baked at build time. In dev the client falls back
  // to the Metro host on the wrangler port (see src/lib/cloud-url.ts), so this
  // may stay unset locally. Fill `eas.projectId` once the app is registered
  // with EAS (`eas init`).
  extra: {
    cloudUrl: process.env.EXPO_PUBLIC_CLOUD_URL,
    // eas: { projectId: "your-eas-project-id" },
  },
  // No OTA updates: this is a sync/read companion shipped through the store,
  // and the app is not registered with EAS. Declared explicitly rather than
  // left to default — Expo's tooling (and knip's expo plugin) otherwise assume
  // `expo-updates` is a dependency, which meant carrying a knip ignore for a
  // package nothing installs. State the truth in the native config instead.
  updates: { enabled: false },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
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
