// plain JS: expo's config loader needs the compiler JS API that TypeScript 7 dropped
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
  extra: {
    cloudUrl: process.env.EXPO_PUBLIC_CLOUD_URL,
  },
  // declared explicitly: knip's expo plugin otherwise assumes expo-updates is a dependency
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
