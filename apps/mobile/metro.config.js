// oxlint-disable unicorn/prefer-module -- metro requires this file; the package is not type: module
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// no cacheStores override: it needs metro-cache, which does not resolve under pnpm here

// no compiler option here: react-native-css 3.0.7 never hands Metro's to its compiler, so
// src/styles.css carries its own rem
/** @type {import('expo/metro-config').MetroConfig} */
module.exports = withNativewind(config);
