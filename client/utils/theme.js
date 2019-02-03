// const theme = {
//   /* Colors
// –––––––––––––––––––––––––––––––––––––––––––––– */
//   brandCyan: '#00ddf8',
//   brandCyanDark: '#15C6E3',
//   brandPurple: '#8389E1',
//   brandPurpleDark: '#484A9F',
//   brandBlack: '#3d3f58',
//   brandBlack1: '#313348',
//   brandBlack2: '#242537',
//
//   /* Text colors */
//   textColor: '#C3CBD0',
//   textGrey: '#8A96AD',
//
//   /* Background Colors */
//   borderColor: '#535473',
//   backgroundColor: '#242537',
//
//   /* Spacing */
//   baseSpacing: '8px',
//   baseSpacing2: '16px',
//   baseSpacing3: '24px',
//   baseSpacing4: '32px',
//   baseSpacing5: '40px',
//
//
//   /* Layout
// –––––––––––––––––––––––––––––––––––––––––––––– */
//   container: '1400px',
//   containerSmall: '1000px',
//   containerXSmall: '600px',
// };
//
// export default theme;

const createMediaQuery = (n) => `@media screen and (min-width:${n}em)`;

const addAliases = (arr, aliases) =>
  aliases.forEach((key, i) =>
    Object.defineProperty(arr, key, {
      enumerable: false,
      get() {
        return this[i];
      },
    }),
  );

export const breakpoints = [32, 40, 48, 64];

export const mediaQueries = breakpoints.map(createMediaQuery);

const aliases = ['sm', 'md', 'lg', 'xl'];

addAliases(breakpoints, aliases);
addAliases(mediaQueries, aliases);

export const space = [0, 4, 8, 16, 32, 64, 128];

export const font = `Proxima Nova, Helvetica Neue, sans-serif`;

export const fontSizes = [12, 14, 16, 20, 24, 32, 48];

export const regular = 400;
export const bold = 600;

// styled-system's `fontWeight` function can hook into the `fontWeights` object
export const fontWeights = {
  regular,
  bold,
};

const letterSpacings = {
  normal: 'normal',
  title: '-0.5px',
  caps: '0.025em',
};

// color palette
const black = '#242537';
const white = '#fff';

const text = '#C3CBD0';

// Brand Colors.
const lightBlue = '#cdf';
const blue = '#00ddf8'; // primary
const darkBlue = '#15C6E3';

const lightPurple = '#ecf';
const purple = '#8389E1'; // secondary
const darkPurple = '#484A9F';

const lightGray = '#f6f8fa';
const gray = '#687B8E'; // primary
const darkGray = '#364049';
const borderGray = '#535473';

const lightGreen = '#cec';
const green = '#0a0'; // secondary
const darkGreen = '#060';

const lightRed = '#fcc';
const red = '#c00'; // secondary
const darkRed = '#800';

const lightOrange = '#feb';
const orange = '#fa0'; // secondary
const darkOrange = '#a50';

// tints
const flatten = (name, colors) =>
  colors.reduce((a, b, i) => {
    const color = {
      [name + i]: b,
    };
    return { ...a, ...color };
  }, {});

const blues = [lightBlue, lightBlue, blue, blue];
const purples = [lightPurple, lightPurple, purple, purple];
const grays = [lightGray, lightGray, gray, gray];
const greens = [lightGreen, lightGreen, green, green];
const reds = [lightRed, lightRed, red, red];
const oranges = [lightOrange, lightOrange, orange, orange];

const colors = {
  black,
  white,
  text,
  blue,
  lightBlue,
  darkBlue,
  gray,
  lightGray,
  borderGray,
  darkGray,
  green,
  lightGreen,
  darkGreen,
  red,
  lightRed,
  darkRed,
  orange,
  lightOrange,
  darkOrange,
  purple,
  lightPurple,
  darkPurple,
  blues,
  greens,
  reds,
  oranges,
  purples,
  ...flatten('blue', blues),
  ...flatten('gray', grays),
  ...flatten('green', greens),
  ...flatten('red', reds),
  ...flatten('orange', oranges),
  ...flatten('purple', purples),
};

export { colors };

// styled-system's `borderRadius` function can hook into the `radii` object/array
export const radii = [0, 2, 6];
export const radius = '2px';

export const maxContainerWidth = '1280px';

// boxShadows
export const boxShadows = [
  `0 0 2px 0 rgba(0,0,0,.08),0 1px 4px 0 rgba(0,0,0,.16)`,
  `0 0 2px 0 rgba(0,0,0,.08),0 2px 8px 0 rgba(0,0,0,.16)`,
  `0 0 2px 0 rgba(0,0,0,.08),0 4px 16px 0 rgba(0,0,0,.16)`,
  `0 0 2px 0 rgba(0,0,0,.08),0 8px 32px 0 rgba(0,0,0,.16)`,
];

// animation duration
export const duration = {
  fast: `150ms`,
  normal: `300ms`,
  slow: `450ms`,
  slowest: `600ms`,
};

// animation easing curves
const easeInOut = 'cubic-bezier(0.5, 0, 0.25, 1)';
const easeOut = 'cubic-bezier(0, 0, 0.25, 1)';
const easeIn = 'cubic-bezier(0.5, 0, 1, 1)';

const timingFunctions = {
  easeInOut,
  easeOut,
  easeIn,
};

// animation delay
const transitionDelays = {
  small: `60ms`,
  medium: `160ms`,
  large: `260ms`,
  xLarge: `360ms`,
};

const theme = {
  breakpoints,
  mediaQueries,
  space,
  font,
  fontSizes,
  fontWeights,
  letterSpacings,
  regular,
  bold,
  colors,
  radii,
  radius,
  boxShadows,
  maxContainerWidth,
  duration,
  timingFunctions,
  transitionDelays,
};

export default theme;
