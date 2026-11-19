import { env } from "./env";

// The one origin the app names itself by: Better Auth's base URL, and so where a reset link points
// and which Origin a browser's sign-in must carry. Vercel's own variables are the platform's, read
// raw here as dataembed reads them.

const VERCEL_PRODUCTION_URL =
  process.env.VERCEL_PROJECT_PRODUCTION_URL === undefined
    ? null
    : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;

const deploymentUrl = (): string => {
  if (process.env.VERCEL_ENV === "production" && VERCEL_PRODUCTION_URL !== null) {
    return VERCEL_PRODUCTION_URL;
  }
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL !== undefined) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://localhost:${process.env.PORT ?? "5174"}`;
};

export const APP_URL = env.APP_URL ?? deploymentUrl();

// The deployment's own address, which its pages and a check run on it before a domain points there
// (`pnpm smoke`, `.github/workflows/smoke.yml`) sign in from: only this deployment's own pages carry
// it, so Better Auth trusts it beside APP_URL, which a deployment may not be serving yet
export const DEPLOYMENT_ORIGIN =
  process.env.VERCEL_URL === undefined ? null : `https://${process.env.VERCEL_URL}`;
