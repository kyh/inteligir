// oxlint-disable unicorn/prefer-module -- metro requires this file; the package is not type: module
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// no cacheStores override: it needs metro-cache, which does not resolve under pnpm here

/** @type {import('expo/metro-config').MetroConfig} */
module.exports = config;
