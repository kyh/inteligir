const path = require('path')

module.exports = {
  addons: [
    {
      name: '@storybook/preset-typescript',
      options: {
        include: [path.resolve(__dirname, '../components')],
      },
    },
  ],
  stories: ['../components/**/*.stories.mdx'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-storysource',
    '@storybook/addon-a11y',
    {
      name: '@storybook/addon-docs',
      options: {
        configureJSX: true,
      },
    },
  ],
}
