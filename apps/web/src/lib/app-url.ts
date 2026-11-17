import { parseEnv } from "@repo/service/env";

// The origin this deployment answers on, which a page names where an agent should connect: a
// preview's connector is the preview's, never the site's canonical `siteConfig.url`, or an agent
// signs in there with what the preview handed it. Vercel's variables are the platform's, not the
// app's configuration, so they are read raw.
const deploymentUrl = (): string => {
  const { PORT, VERCEL_ENV, VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL } = process.env;
  if (VERCEL_ENV === "production" && VERCEL_PROJECT_PRODUCTION_URL !== undefined) {
    return `https://${VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (VERCEL_URL !== undefined) {
    return `https://${VERCEL_URL}`;
  }
  return `http://localhost:${PORT ?? "5174"}`;
};

export const APP_URL = parseEnv(process.env).APP_URL ?? deploymentUrl();
