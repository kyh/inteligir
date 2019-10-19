const webpack = require('webpack');
const withOffline = require('next-offline');

const ENV = ['API_URL', 'APP_URL'];

const nextConfig = {
  webpack(config) {
    config.plugins.push(new webpack.EnvironmentPlugin(ENV));
    return config;
  },
};

module.exports = withOffline(nextConfig);
