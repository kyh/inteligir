import NextDocument, { Html, Head, Main, NextScript } from "next/document";
import { ColorModeScript } from "@chakra-ui/react";

const NAME = "Inteligir";
const TITLE = "Inteligir";
const DESCRIPTION = "Your bite-sized micro lesson portal";
const URL = "https://inteligir.com";

export default class Document extends NextDocument {
  render() {
    return (
      <Html lang="en">
        <Head>
          <meta name="referrer" content="origin" />
          <meta name="application-name" content={NAME} />
          <meta name="theme-color" content="#1F2937" />
          <meta name="title" content={TITLE} />
          <meta name="robots" content="index, follow" />
          <meta name="description" content={DESCRIPTION} />

          <meta property="fb:app_id" content="{FB_ID}" />
          <meta property="og:url" content={URL} />
          <meta property="og:type" content="website" />
          <meta property="og:title" content={TITLE} />
          <meta property="og:image" content="/featured.png" />
          <meta property="og:description" content={DESCRIPTION} />
          <meta property="og:site_name" content={NAME} />
          <meta property="og:locale" content="en_US" />

          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:site" content="@kaiyuhsu" />
          <meta name="twitter:creator" content="@kaiyuhsu" />
          <meta name="twitter:url" content="" />
          <meta name="twitter:title" content={TITLE} />
          <meta name="twitter:description" content={DESCRIPTION} />
          <meta name="twitter:image" content="/featured.png" />

          <link rel="manifest" href="/manifest.json" />
          <link rel="icon" href="/logo192.png" />
        </Head>
        <body>
          <ColorModeScript />
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
