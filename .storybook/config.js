import React from 'react';
import { ThemeProvider } from 'styled-components';
import { configure, addDecorator } from '@storybook/react';
import { withKnobs } from '@storybook/addon-knobs';

import theme from '../client/utils/theme';
import { GlobalStyles, Box } from '../client/components';

addDecorator((story) => (
  <ThemeProvider theme={theme}>
    <main>
      <GlobalStyles />
      <Box p={3}>{story()}</Box>
    </main>
  </ThemeProvider>
));

addDecorator(withKnobs);

const req = require.context(
  '../client/components',
  true,
  /[\w\d\s]+\.stories.js$/,
);

const loadStories = () => {
  req.keys().forEach((key) => {
    req(key);
  });
};

configure(loadStories, module);
