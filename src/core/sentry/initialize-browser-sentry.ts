import { siteConfig } from "~/config/site";
import isBrowser from "~/core/generic/is-browser";

let initialized = false;

async function initializeBrowserSentry() {
  const dsn = siteConfig.sentry.dsn;
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
    environment: siteConfig.environment,
  });

  initialized = true;
}

function warnSentryNotConfigured() {
  console.warn(
    `Sentry DSN was not provided. Please add a SENTRY_DSN environment variable to enable error tracking.`,
  );
}

export default initializeBrowserSentry;
