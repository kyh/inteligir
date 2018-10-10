import React from 'react';
import { ThemeProvider, createGlobalStyle } from 'styled-components';
import Meta from '@client/components/Meta';
import theme from '@client/utils/theme';

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
  text-align: left;
  font-family: ${theme['pxn-font']};
  color: ${theme['text-color']};
  background-color: ${theme['background-grey']};
}

*,
*:before,
*:after {
  box-sizing: inherit;
}

article,
aside,
dialog,
figcaption,
figure,
footer,
header,
hgroup,
main,
nav,
section {
  display: block;
}

[tabindex='-1']:focus {
  outline: 0 !important;
}

hr {
  box-sizing: content-box;
  height: 0;
  overflow: visible;
}

h1,
h2,
h3,
h4,
h5,
h6 {
  color: ${theme['title-color']});
  font-family: ${theme['ssp-font']});
  margin-top: 0;
  line-height: 1.2;
  margin-bottom: 2rem;
  letter-spacing: -0.6px;
}

h1,
.h1 {
  font-size: 3.5rem;
}

h2,
.h2 {
  font-size: 3rem;
}

h3,
.h3 {
  font-size: 2.5rem;
}

h4,
.h4 {
  font-size: 2.15rem;
}

h5,
.h5 {
  font-size: 2rem;
}

h6,
.h6 {
  font-size: 1.7rem;
}

p {
  margin-top: 0;
  margin-bottom: 2rem;
  line-height: 1.7;
}

abbr[title],
abbr[data-original-title] {
  text-decoration: underline;
  -webkit-text-decoration: underline dotted;
  text-decoration: underline dotted;
  cursor: help;
  border-bottom: 0;
}

address {
  margin-bottom: 1rem;
  font-style: normal;
  line-height: inherit;
}

ol,
ul,
dl {
  margin-top: 0;
  margin-bottom: 0;
  padding: 0;
}

ul {
  list-style-type: none;
}

dt {
  font-weight: 700;
}

dd {
  margin-bottom: 0.5rem;
  margin-left: 0;
}

blockquote {
  margin: 0 0 1rem;
}

dfn {
  font-style: italic;
}

b,
strong {
  font-weight: bolder;
}

small {
  font-size: 80%;
}

sub,
sup {
  position: relative;
  font-size: 75%;
  line-height: 0;
  vertical-align: baseline;
}

sub {
  bottom: -0.25em;
}

sup {
  top: -0.5em;
}

a {
  color: ${theme['brand-dark-blue']});
  text-decoration: none;
  background-color: transparent;
  -webkit-text-decoration-skip: objects;
  border-bottom: 1px solid ${theme['border-color']});
  transition: color, border-color 0.2s linear;
}

a:hover {
  border-bottom-color: ${theme['brand-dark-blue']});
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

pre,
code,
kbd,
samp {
  font-family: monospace, monospace;
  font-size: 1em;
}

pre {
  margin-top: 0;
  margin-bottom: 1rem;
  overflow: auto;
  -ms-overflow-style: scrollbar;
}

figure {
  margin: 0 0 1rem;
}

img {
  max-width: 100%;
  vertical-align: middle;
  border-style: none;
}

svg:not(:root) {
  overflow: hidden;
}

table {
  border-collapse: collapse;
}

caption {
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
  color: #6c757d;
  text-align: left;
  caption-side: bottom;
}

th {
  text-align: inherit;
}

label {
  display: inline-block;
  margin-bottom: 0.5rem;
}

button {
  border-radius: 0;
}

button:focus {
  outline: 1px dotted;
  outline: 5px auto -webkit-focus-ring-color;
}

input,
button,
select,
optgroup,
textarea {
  margin: 0;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

button,
input {
  overflow: visible;
}

button,
select {
  text-transform: none;
}

button,
html [type='button'],
[type='reset'],
[type='submit'] {
  -webkit-appearance: button;
}

button::-moz-focus-inner,
[type='button']::-moz-focus-inner,
[type='reset']::-moz-focus-inner,
[type='submit']::-moz-focus-inner {
  padding: 0;
  border-style: none;
}

input[type='radio'],
input[type='checkbox'] {
  box-sizing: border-box;
  padding: 0;
}

input[type='date'],
input[type='time'],
input[type='datetime-local'],
input[type='month'] {
  -webkit-appearance: listbox;
}

textarea {
  overflow: auto;
  resize: vertical;
}

fieldset {
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

legend {
  display: block;
  width: 100%;
  max-width: 100%;
  padding: 0;
  margin-bottom: 0.5rem;
  font-size: 1.5rem;
  line-height: inherit;
  color: inherit;
  white-space: normal;
}

progress {
  vertical-align: baseline;
}

[type='number']::-webkit-inner-spin-button,
[type='number']::-webkit-outer-spin-button {
  height: auto;
}

[type='search'] {
  outline-offset: -2px;
  -webkit-appearance: none;
}

[type='search']::-webkit-search-cancel-button,
[type='search']::-webkit-search-decoration {
  -webkit-appearance: none;
}

::-webkit-file-upload-button {
  font: inherit;
  -webkit-appearance: button;
}

output {
  display: inline-block;
}

summary {
  display: list-item;
  cursor: pointer;
}

template {
  display: none;
}

[hidden] {
  display: none !important;
}
`;

const Page = ({ children }) => (
  <ThemeProvider theme={theme}>
    <main>
      <Meta />
      {children}
      <GlobalStyle />
    </main>
  </ThemeProvider>
);

export default Page;
