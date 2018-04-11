const path = require('path');

module.exports = {
  parser: 'babel-eslint',
  extends: ['airbnb', 'plugin:prettier/recommended'],
  env: {
    browser: true,
    node: true,
    mocha: true,
  },
  rules: {
    'react/jsx-filename-extension': [1, { extensions: ['.js', '.jsx'] }],
  },
  settings: {
    'import/resolver': {
      node: {
        paths: [
          path.resolve(__dirname, './node_modules'),
          path.resolve(__dirname, './client/node_modules'),
          path.resolve(__dirname, './client/src'),
        ],
      },
    },
  },
};
