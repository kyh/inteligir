// oxlint-disable unicorn/prefer-module -- expo requires this file; the package is not type: module
// plain JS: expo's config loader needs the compiler JS API that TypeScript 7 dropped
const { version } = require("./package.json");

// `eas init` mints both (README § Shipping). null until they are committed, and until then a build
// has no EAS project to belong to and no update to take.
/** @type {{ owner: string, projectId: string } | null} */
const easProject = null;

const easFields =
  easProject === null
    ? { updates: { enabled: false } }
    : {
        extra: { eas: { projectId: easProject.projectId } },
        owner: easProject.owner,
        updates: { url: `https://u.expo.dev/${easProject.projectId}` },
      };

// Apple refuses a build that calls a required-reason API its own manifest does not declare, and
// does not reliably read the manifests static pods carry; src/__tests__/app-config.test.ts holds
// this list to every autolinked module's.
const accessedApiTypes = [
  {
    NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
    NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"],
  },
  {
    NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
    NSPrivacyAccessedAPITypeReasons: ["0A2A.1", "3B52.1"],
  },
  {
    // 1C8F.1: the share extension hands what was shared over through the App Group's defaults
    NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
    NSPrivacyAccessedAPITypeReasons: ["CA92.1", "1C8F.1"],
  },
];

// what the share sheet offers Save to Inteligir for: a page or a link, and text that may hold one;
// never a photo or a file, which the phone keeps from its own photo picker
const shareActivationRules = {
  NSExtensionActivationSupportsText: true,
  NSExtensionActivationSupportsWebPageWithMaxCount: 1,
  NSExtensionActivationSupportsWebURLWithMaxCount: 1,
};

/** @param {import("expo/config").ConfigContext} ctx the config expo read from app.json
 *  @returns {import("expo/config").ExpoConfig} the config expo builds the app from */
const appConfig = ({ config }) => ({
  ...config,
  ...easFields,
  experiments: {
    reactCompiler: true,
    typedRoutes: true,
  },
  icon: "./assets/icon-light.png",
  ios: {
    bundleIdentifier: "com.inteligir.mobile",
    config: {
      usesNonExemptEncryption: false,
    },
    icon: {
      dark: "./assets/icon-dark.png",
      light: "./assets/icon-light.png",
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: accessedApiTypes,
    },
    supportsTablet: false,
  },
  name: "Inteligir",
  orientation: "portrait",
  platforms: ["ios"],
  plugins: [
    "expo-router",
    "./plugins/with-editor-page",
    [
      "expo-image-picker",
      {
        cameraPermission: "Inteligir uses the camera when you take a photo to add to your library.",
        microphonePermission: false,
        photosPermission: "Inteligir opens your photos when you choose one to add to your library.",
      },
    ],
    ["expo-secure-store", { faceIDPermission: false }],
    // the share extension only hands what was shared to the app, through the App Group and the
    // app's own link; the app saves it (src/items/share-inbox.tsx). The App Group and the
    // extension's id are the plugin's defaults, and EAS signs both.
    [
      "expo-share-intent",
      {
        disableAndroid: true,
        iosActivationRules: shareActivationRules,
        iosShareExtensionName: "Save to Inteligir",
      },
    ],
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
  // an update reaches only builds whose native code fingerprints the same, so a JS fix ships
  // over the air and a native change needs a new build
  runtimeVersion: { policy: "fingerprint" },
  scheme: "inteligir",
  slug: "inteligir",
  userInterfaceStyle: "automatic",
  version,
});

module.exports = appConfig;
