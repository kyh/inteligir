/* eslint-disable react/jsx-props-no-spreading */
import React from 'react';
import App from 'next/app';

// Connect UI Theme
import { ThemeProvider } from '@material-ui/styles';
import CssBaseline from '@material-ui/core/CssBaseline';
import uiTheme from '@utils/theme';

class IntApp extends App {
  componentDidMount() {
    // Remove the server-side injected CSS.
    const jssStyles = document.querySelector('#jss-server-side');
    if (jssStyles) {
      jssStyles.parentNode.removeChild(jssStyles);
    }
  }

  render() {
    const { Component, pageProps } = this.props;
    return (
      <ThemeProvider theme={uiTheme}>
        <CssBaseline />
        <Component {...pageProps} />
      </ThemeProvider>
    );
  }
}

export default IntApp;
