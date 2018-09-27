const path = require('path');

module.exports = {
  parser: 'babel-eslint',
  extends: ['airbnb', 'plugin:prettier/recommended'],
  env: {
    browser: true,
    node: true,
    jest: true,
  },
  rules: {
    'react/jsx-filename-extension': [1, { extensions: ['.js', '.jsx'] }],
    // See: https://github.com/airbnb/javascript/commit/b6a268f780177e03b573a4f0df95ecc0d2e8783e
    // Disable destructuring lint.
    // TODO: re-enable when component detection is fixed
    'react/destructuring-assignment': 'off',
    // Disable one expression per line.
    // TODO: re-enable when an option for text children is available.
    'react/jsx-one-expression-per-line': 'off',
    // Allow console logs in our codebase.
    'no-console': 'off',
    // AirBnB opted to use operators at the beginning of line breaks.
    'operator-linebreak': 'off',
  },
  settings: {
    'import/resolver': {},
  },
};
