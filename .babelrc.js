const presets = ['next/babel'];
const plugins = [
  [
    'styled-components',
    {
      ssr: true,
      displayName: true,
    },
  ],
];

module.exports = { presets, plugins };
