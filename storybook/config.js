import React from 'react';
import { configure, addDecorator } from '@storybook/react';

import { ThemeProvider, Box } from '../client/components';

addDecorator((story) => (
  <ThemeProvider>
    <Box p={3}>{story()}</Box>
  </ThemeProvider>
));

const req = require.context('../client', true, /storybook\/[\w\d\s]+\.js$/);

const load = () => {
  req.keys().forEach((key) => {
    req(key);
  });
};

configure(load, module);
