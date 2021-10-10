import type { AppProps, NextWebVitalsMetric } from "next/app";
import type { NextPage } from "next";
import Router from "next/router";
import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { ProgressBar } from "components";
import { initAnalytics, logPageView, logEvent } from "util/analytics";

import "tailwindcss/tailwind.css";

const progress = new ProgressBar();

type Page<P = Record<string, unknown>> = NextPage<P>;

type Props = AppProps & {
  Component: Page;
};

Router.events.on("routeChangeStart", progress.start);
Router.events.on("routeChangeError", progress.finish);
Router.events.on("routeChangeComplete", () => {
  logPageView();
  progress.finish();
});

export const reportWebVitals = ({
  id,
  name,
  label,
  value,
}: NextWebVitalsMetric) => {
  logEvent({
    name,
    category: label === "web-vital" ? "Web Vitals" : "Custom metric",
    label: id,
    value: Math.round(name === "CLS" ? value * 1000 : value),
    interaction: false,
  });
};

const MyApp = ({ Component, pageProps: { session, ...otherProps } }: Props) => {
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <SessionProvider session={session}>
      <Component {...otherProps} />
    </SessionProvider>
  );
};

export default MyApp;
