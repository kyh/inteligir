import React from 'react';
import { create } from '@storybook/theming';

import { ThemeProvider } from '@material-ui/styles';
import CssBaseline from '@material-ui/core/CssBaseline';

import uiTheme, { theme } from '@utils/theme';
import { Box } from '@components';

export const storyTheme = create({
  base: 'light',
  brandTitle: 'Inteligir Design System',
  brandUrl: 'https://github.com/its-bananas/inteligir',
  colorPrimary: theme.brand.primary,
  colorSecondary: theme.brand.secondary,
});

export const withTheme = (story) => (
  <ThemeProvider theme={uiTheme}>
    <main>
      <CssBaseline />
      {story()}
    </main>
  </ThemeProvider>
);

export const withContainer = (story) => (
  <Box
    display="flex"
    flexDirection="column"
    justifyContent="center"
    alignItems="center"
    maxWidth={theme.brand.maxWidth}
    m="auto"
    p={3}
  >
    {story}
  </Box>
);
