// oxlint-disable unicorn/prefer-module -- metro requires this file; the package is not type: module
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// each checkout keys its own transforms: use-dom's output embeds absolute paths and Metro's keys
// carry none, so the shared tmpdir cache would serve one worktree another's paths. Not a
// cacheStores of our own: Metro's stock FileStore keeps the PostCSS stylesheet Expo's store refuses
config.cacheVersion = __dirname;

// no inlineRem here: the rem is src/styles.css's own `:root` font size, which react-native-css reads
/** @type {import('expo/metro-config').MetroConfig} */
module.exports = withNativewind(config);
