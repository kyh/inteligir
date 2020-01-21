const webpack = require('webpack')
const withOffline = require('next-offline')
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin')

const ENV = ['API_URL', 'APP_URL']

const nextConfig = {
  webpack(config, options) {
    config.plugins.push(new webpack.EnvironmentPlugin(ENV))

    config.module.rules.push({
      test: /\.graphql$/,
      exclude: /node_modules/,
      use: [options.defaultLoaders.babel, { loader: 'graphql-let/loader' }],
    })

    config.module.rules.push({
      test: /\.graphqls$/,
      exclude: /node_modules/,
      loader: 'graphql-tag/loader',
    })

    config.resolve.plugins.push(new TsconfigPathsPlugin())

    return config
  },
}

module.exports = withOffline(nextConfig)
