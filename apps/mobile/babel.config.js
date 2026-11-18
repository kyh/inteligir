// oxlint-disable unicorn/prefer-module -- babel requires this file; the package is not type: module
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
