/** @type {import('prettier').Config} */
export default {
  endOfLine: 'lf',
  plugins: [
    'prettier-plugin-packagejson',
    'prettier-plugin-jsdoc',
    'prettier-plugin-tailwindcss',
  ],
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  tailwindFunctions: ['cva', 'cn', 'withCn'],
  tailwindStylesheet: './src/app/globals.css',
  trailingComma: 'es5',
};
