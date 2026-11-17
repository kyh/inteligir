// oxlint-disable unicorn/prefer-module -- babel requires this file; the package is not type: module
// app.config.js only switches the React Compiler on, so its options are the preset's: a hook or
// component defined inside a function fails the bundle, as the extension's does (wxt.config.ts)
const babelConfig = (api) => {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          "react-compiler": {
            environment: { validateNoDynamicallyCreatedComponentsOrHooks: true },
          },
        },
      ],
    ],
  };
};

module.exports = babelConfig;
