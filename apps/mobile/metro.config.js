// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// No `cacheStores` override: @expo/metro-config installs a default FileStore
// under os.tmpdir(). An override requires `metro-cache`, which this app does
// not declare — under pnpm's isolated node_modules it would not resolve, so
// loadConfig() throws MODULE_NOT_FOUND and `expo start` cannot boot. Do not
// reintroduce one without adding the dependency; nothing in `pnpm verify`
// covers this file (this app declares no build script, so turbo never runs it).

/** @type {import('expo/metro-config').MetroConfig} */
module.exports = config;
