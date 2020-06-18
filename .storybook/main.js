const path = require('path')

module.exports = {
  stories: ['../components/**/*.stories.mdx'],
  addons: [
    {
      name: '@storybook/preset-typescript',
      options: {
        include: [path.resolve(__dirname, '../components')],
      },
    },
    {
      name: '@storybook/addon-docs',
      options: {
        configureJSX: true,
      },
    },
    '@storybook/addon-essentials',
    '@storybook/addon-storysource',
    '@storybook/addon-a11y',
  ],
}
