// oxlint-disable unicorn/prefer-module -- expo requires this file; the package is not type: module
// plain JS: expo's config loader needs the compiler JS API that TypeScript 7 dropped
/** @param {import("expo/config").ConfigContext} ctx the config expo read from app.json
 *  @returns {import("expo/config").ExpoConfig} the config expo builds the app from */
const appConfig = ({ config }) => ({
  ...config,
  android: {
    adaptiveIcon: {
      backgroundColor: "#171717",
      foregroundImage: "./assets/icon-light.png",
    },
    package: "app.inteligir.mobile",
  },
  experiments: {
    reactCompiler: true,
    typedRoutes: true,
  },
  extra: {
    cloudUrl: process.env.EXPO_PUBLIC_CLOUD_URL,
  },
  icon: "./assets/icon-light.png",
  ios: {
    bundleIdentifier: "app.inteligir.mobile",
    icon: {
      dark: "./assets/icon-dark.png",
      light: "./assets/icon-light.png",
    },
    supportsTablet: true,
  },
  name: "inteligir",
  orientation: "portrait",
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#FAFAFA",
        dark: {
          backgroundColor: "#171717",
          image: "./assets/icon-dark.png",
        },
        image: "./assets/icon-light.png",
      },
    ],
  ],
  scheme: "inteligir",
  slug: "inteligir",
  // declared explicitly: knip's expo plugin otherwise assumes expo-updates is a dependency
  updates: { enabled: false },
  userInterfaceStyle: "automatic",
  version: "0.1.0",
});

module.exports = appConfig;
