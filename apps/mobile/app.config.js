// oxlint-disable unicorn/prefer-module -- expo requires this file; the package is not type: module
const { version } = require("../../package.json");

const easProject = null;

const easFields =
  easProject === null
    ? { updates: { enabled: false } }
    : {
        extra: { eas: { projectId: easProject.projectId } },
        owner: easProject.owner,
        updates: { url: `https://u.expo.dev/${easProject.projectId}` },
      };

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
    NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
    NSPrivacyAccessedAPITypeReasons: ["CA92.1", "1C8F.1"],
  },
];

const shareActivationRules = {
  NSExtensionActivationSupportsText: true,
  NSExtensionActivationSupportsWebPageWithMaxCount: 1,
  NSExtensionActivationSupportsWebURLWithMaxCount: 1,
};

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
    [
      "expo-image-picker",
      {
        cameraPermission: "Inteligir uses the camera when you take a photo to add to your library.",
        microphonePermission: false,
        photosPermission: "Inteligir opens your photos when you choose one to add to your library.",
      },
    ],
    ["expo-secure-store", { faceIDPermission: false }],
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
  runtimeVersion: { policy: "fingerprint" },
  scheme: "inteligir",
  slug: "inteligir",
  userInterfaceStyle: "automatic",
  version,
});

module.exports = appConfig;
