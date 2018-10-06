import React from 'react';
import { Provider } from 'react-redux';
import App, { Container } from 'next/app';
import withRedux from 'next-redux-wrapper';
import Head from 'next/head';

import initStore from '@client/utils/store';

/* debug to log how the store is being used */
export default withRedux(initStore, {
  debug: typeof window !== 'undefined' && process.env.NODE_ENV !== 'production',
})(
  class MyApp extends App {
    static async getInitialProps({ Component, ctx }) {
      return {
        pageProps: {
          // Call page-level getInitialProps
          ...(Component.getInitialProps
            ? await Component.getInitialProps(ctx)
            : {}),
        },
      };
    }

    render() {
      const { Component, pageProps, store } = this.props;
      return (
        <Container>
          <Head>
            <title>Inteligir</title>
          </Head>
          <Provider store={store}>
            <Component {...pageProps} />
          </Provider>
        </Container>
      );
    }
  },
);
