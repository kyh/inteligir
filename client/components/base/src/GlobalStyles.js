import { createGlobalStyle } from 'styled-components';
import { font, colors } from '@client/utils/theme';

const GlobalStyles = createGlobalStyle`
@font-face {
  font-family: 'Proxima Nova';
  src: url('/static/fonts/ProximaNova-Light.woff2') format('woff2'),
    url('/static/fonts/ProximaNova-Light.woff') format('woff');
  font-weight: 300;
  font-style: normal;
}

@font-face {
  font-family: 'Proxima Nova';
  src: url('/static/fonts/ProximaNova-Regular.woff2') format('woff2'),
    url('/static/fonts/ProximaNova-Regular.woff') format('woff');
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: 'Proxima Nova';
  src: url('/static/fonts/ProximaNova-Semibold.woff2') format('woff2'),
    url('/static/fonts/ProximaNova-Semibold.woff') format('woff');
  font-weight: 500;
  font-style: normal;
}

@font-face {
  font-family: 'Proxima Nova';
  src: url('/static/fonts/ProximaNova-Bold.woff2') format('woff2'),
    url('/static/fonts/ProximaNova-Bold.woff') format('woff');
  font-weight: 700;
  font-style: normal;
}

html, body, div, span, applet, object, iframe,
h1, h2, h3, h4, h5, h6, p, blockquote, pre,
a, abbr, acronym, address, big, cite, code,
del, dfn, em, img, ins, kbd, q, s, samp,
small, strike, strong, sub, sup, tt, var,
b, u, i, center,
dl, dt, dd, ol, ul, li,
fieldset, form, label, legend,
table, caption, tbody, tfoot, thead, tr, th, td,
article, aside, canvas, details, embed,
figure, figcaption, footer, header, hgroup,
main, menu, nav, output, ruby, section, summary,
time, mark, audio, video {
  margin: 0;
  padding: 0;
  border: 0;
  vertical-align: baseline;
}

/* HTML5 display-role reset for older browsers */
article, aside, details, figcaption, figure,
footer, header, hgroup, main, menu, nav, section {
  display: block;
}

/* HTML5 hidden-attribute fix for newer browsers */
*[hidden] {
    display: none;
}

ol, ul {
  list-style: none;
}

table {
  border-collapse: collapse;
  border-spacing: 0;
}

.screen-reader-text {
  clip: rect(1px, 1px, 1px, 1px);
  position: absolute !important;
  height: 1px;
  width: 1px;
  overflow: hidden;
  word-wrap: normal !important;
}
.screen-reader-text:focus {
  font-size: 16px;
  letter-spacing: -0.1px;
  box-shadow: 0 0 2px 2px rgba(0, 0, 0, 0.6);
  clip: auto !important;
  display: block;
  font-weight: 500;
  line-height: 16px;
  text-decoration: none;
  background-color: #141516;
  color: #4353ff !important;
  border: none;
  height: auto;
  left: 8px;
  padding: 16px 36px;
  top: 8px;
  width: auto;
  z-index: 100000;
}

html {
  font-size: 62.5%;
  box-sizing: border-box;
  line-height: 1.15;
  -webkit-text-size-adjust: 100%;
  -ms-text-size-adjust: 100%;
  -ms-overflow-style: scrollbar;
  -webkit-tap-highlight-color: transparent;
}

body {
  margin: 0;
  font-size: 1.6rem;
  line-height: 1.77;
  font-family: ${font};
  color: ${colors.text};
  background-color: ${colors.darkBlack};
  overflow-x: hidden;
}

*,
*:before,
*:after {
  box-sizing: inherit;
}

.h1,
h1 {
  font-size: 40px;
  line-height: 50px;
  letter-spacing: -0.2px;
}
@media (min-width: 641px) {
  .h1,
  h1 {
    font-size: 48px;
    line-height: 58px;
    letter-spacing: 0;
  }
}
.h2,
h2 {
  font-size: 32px;
  line-height: 42px;
  letter-spacing: -0.1px;
}
@media (min-width: 641px) {
  .h2,
  h2 {
    font-size: 40px;
    line-height: 50px;
    letter-spacing: -0.2px;
  }
}
.h3,
.h4,
.h5,
.h6,
h3,
h4,
h5,
h6 {
  letter-spacing: -0.1px;
}
.h3,
h3 {
  font-size: 24px;
  line-height: 34px;
}
@media (min-width: 641px) {
  .h3,
  h3 {
    font-size: 32px;
    line-height: 42px;
    letter-spacing: -0.1px;
  }
}
.h4,
.h5,
.h6,
h4,
h5,
h6 {
  font-size: 20px;
  line-height: 32px;
}
`;

export default GlobalStyles;
