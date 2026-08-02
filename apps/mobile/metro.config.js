// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");

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

// No `cacheStores` override: @expo/metro-config installs a default FileStore
// (ExpoMetroConfig.js) under os.tmpdir(). The previous override required
// `metro-cache`, which apps/mobile has never declared — under pnpm's isolated
// node_modules it did not resolve, so loadConfig() threw MODULE_NOT_FOUND and
// `expo start` could not boot at all. Do not reintroduce it without adding the
// dependency; nothing in `pnpm verify` covers this file (apps/mobile declares
// no build script, so turbo never touches it).

/** @type {import('expo/metro-config').MetroConfig} */
module.exports = config;
