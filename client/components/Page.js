import React from 'react';
import { ThemeProvider, createGlobalStyle } from 'styled-components';
import { Normalize } from 'styled-normalize';

import Meta from '@client/components/Meta';
import theme from '@client/utils/theme';
import Navigation from '@client/components/Navigation';

const GlobalStyle = createGlobalStyle`
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
  font-size: 2rem;
  line-height: 1.77;
  font-family: ${theme.pxnFont};
  color: ${theme.textColor};
  background-color: ${theme.backgroundColor};
}

*,
*:before,
*:after {
  box-sizing: inherit;
}

a {
  color: ${theme.brandCyan};
  text-decoration: none;
  background-color: transparent;
  -webkit-text-decoration-skip: objects;
  border-bottom: 1px solid ${theme.borderColor};
  transition: color 0.2s linear, border-color 0.2s linear;
}

a:hover {
  border-bottom-color: ${theme.brandCyanDark};
}

a:not([href]):not([tabindex]) {
  color: inherit;
  text-decoration: none;
}

a:not([href]):not([tabindex]):hover,
a:not([href]):not([tabindex]):focus {
  color: inherit;
  text-decoration: none;
}

a:not([href]):not([tabindex]):focus {
  outline: 0;
}
`;

const Page = ({ children }) => (
  <ThemeProvider theme={theme}>
    <main>
      <Meta />
      <Navigation />
      {children}
      <Normalize />
      <GlobalStyle />
    </main>
  </ThemeProvider>
);

export default Page;
