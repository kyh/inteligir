// oxlint-disable unicorn/prefer-module -- metro requires this file; the package is not type: module
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

config.cacheVersion = __dirname;

module.exports = withNativewind(config);
