import React from 'react'

import { ThemeProvider } from '@material-ui/styles'
import CssBaseline from '@material-ui/core/CssBaseline'

import theme from '@utils/theme'
import { Box } from '@components'

export const withTheme = (story) => (
  <ThemeProvider theme={theme}>
    <main>
      <CssBaseline />
      {story()}
    </main>
  </ThemeProvider>
)

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
    {story()}
  </Box>
)
