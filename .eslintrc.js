const path = require('path');

module.exports = {
  parser: 'babel-eslint',
  extends: ['plugin:prettier/recommended'],
  parserOptions: {
    ecmaVersion: 2018,
  },
  env: {
    browser: true,
    node: true,
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
