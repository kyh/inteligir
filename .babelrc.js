const npmPackage = require('./package.json');

const presets = ['next/babel'];
const plugins = [
  ['module-resolver', { alias: npmPackage._moduleAliases }],
  'transform-flow-strip-types',
  [
    'styled-components',
    {
      ssr: true,
      displayName: true,
    },
  ],
];

module.exports = { presets, plugins };
