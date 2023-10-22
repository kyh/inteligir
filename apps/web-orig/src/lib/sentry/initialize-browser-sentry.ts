import { isBrowser } from "@/lib/utils/is-browser";

let initialized = false;

export const initializeBrowserSentry = async () => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const Sentry = await import("@sentry/react");
  const { Integrations: SentryIntegrations } = await import("@sentry/tracing");

  if (!isBrowser() || initialized) {
    return;
  }

  if (!dsn) {
    warnSentryNotConfigured();
  }

  Sentry.init({
    dsn,
    integrations: [new SentryIntegrations.BrowserTracing()],
    tracesSampleRate: 1.0,
    environment: process.env.NEXT_PUBLIC_ENVIRONMENT,
  });

  initialized = true;
};

const warnSentryNotConfigured = () => {
  console.warn(
    `Sentry DSN was not provided. Please add a SENTRY_DSN environment variable to enable error tracking.`,
  );
};
