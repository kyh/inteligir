const { resolve } = require('path')
const resolveTsconfigPathsToAlias = require('../tools/resolveTsConfig')
const JS_BUNDLE_PATH = resolve(__dirname, '../client')
const TS_CONFIG_PATH = resolve(__dirname, '../tsconfig.json')

module.exports = {
  stories: [`${JS_BUNDLE_PATH}/components/**/*.stories.tsx`],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-storysource',
    '@storybook/addon-knobs/register',
    '@storybook/addon-actions/register',
    '@storybook/addon-a11y/register',
    {
      name: '@storybook/preset-typescript',
      options: {
        tsLoaderOptions: {
          configFile: TS_CONFIG_PATH,
        },
        tsDocgenLoaderOptions: {
          tsconfigPath: TS_CONFIG_PATH,
        },
        include: [JS_BUNDLE_PATH],
      },
    },
    {
      name: '@storybook/addon-docs/preset',
      options: {
        configureJSX: true,
      },
    },
  ],
  webpackFinal: async (config) => {
    // `configType` has a value of 'DEVELOPMENT' or 'PRODUCTION'
    // You can change the configuration based on that.
    // 'PRODUCTION' is used when building the static version of storybook.

    // Make whatever fine-grained changes you need
    config.resolve.alias = {
      ...config.resolve.alias,
      ...resolveTsconfigPathsToAlias({
        webpackConfigBasePath: resolve(__dirname, '../'),
      }),
    }

    // Return the altered config
    return config
  },
}
