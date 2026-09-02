const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// no cacheStores override: it needs metro-cache, which does not resolve under pnpm here,
// and nothing in verify runs this file

/** @type {import('expo/metro-config').MetroConfig} */
module.exports = config;
