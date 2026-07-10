// Learn more: https://docs.expo.dev/guides/monorepos/
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// @sinclair/typebox's ESM build has circular imports Metro's import interop
// can't handle (proven crashing the web target; the same resolution applies
// on native). Pin it to the CJS build.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@sinclair/typebox" || moduleName.startsWith("@sinclair/typebox/")) {
    return context.resolveRequest(
      { ...context, unstable_conditionNames: ["require", "default"] },
      moduleName,
      platform,
    );
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

config.cacheStores = [
  new FileStore({
    root: path.join(__dirname, "node_modules", ".cache", "metro"),
  }),
];

/** @type {import('expo/metro-config').MetroConfig} */
module.exports = withNativewind(config);
