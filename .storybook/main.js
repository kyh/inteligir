const path = require('path')

const JS_BUNDLE_PATH = path.resolve(__dirname, '../client')
const TS_CONFIG_PATH = path.resolve(__dirname, '../tsconfig.json')

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
}
