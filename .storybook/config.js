import React from 'react';
import { ThemeProvider } from 'styled-components';
import { configure, addDecorator } from '@storybook/react';

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

const req = require.context('../client', true, /[\w\d\s]+\.stories.js$/);

const load = () => {
  req.keys().forEach((key) => {
    req(key);
  });
};

configure(load, module);
