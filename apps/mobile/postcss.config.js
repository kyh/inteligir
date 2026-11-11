// oxlint-disable unicorn/prefer-module -- expo requires this file; the package is not type: module
// Expo runs every stylesheet through PostCSS: src/styles.css before react-native-css compiles it to
// native styles, and the note page's sheet into its DOM bundle, whose fonts inline-fonts.js then
// writes in. Expo looks for this config only as postcss.config.mjs, .js or .json, and takes a
// local plugin by its path.
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
    "./inline-fonts": {},
  },
};
