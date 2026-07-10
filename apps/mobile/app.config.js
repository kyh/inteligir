// Native + product identity for the inteligir mobile companion. Mirrors the
// template's app.config shape; the identity is inteligir's. `scheme` MUST stay
// in sync with the Better Auth expo client (`expoClient({ scheme })` in
// src/lib/auth.ts) — it is the deep-link callback origin the auth flow uses.
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
  assetBundlePatterns: ["**/*"],
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
  // The coordinator (Cloudflare Worker) origin, baked at build time. In dev the
  // client falls back to the Metro host on the wrangler port (see
  // src/lib/base-url.ts), so this may stay unset locally. Fill `eas.projectId`
  // once the app is registered with EAS (`eas init`).
  extra: {
    coordinatorUrl: process.env.EXPO_PUBLIC_COORDINATOR_URL,
    // eas: { projectId: "your-eas-project-id" },
  },
  experiments: {
    tsconfigPaths: true,
    typedRoutes: true,
    reactCanary: true,
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
