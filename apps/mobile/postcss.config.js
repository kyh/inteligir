// oxlint-disable unicorn/prefer-module -- expo requires this file; the package is not type: module
// Expo runs src/styles.css through PostCSS before react-native-css compiles it to native styles,
// and looks for this config only as postcss.config.mjs, .js or .json.
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
