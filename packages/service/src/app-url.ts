import { env } from "./env";

const VERCEL_PRODUCTION_URL =
  process.env.VERCEL_PROJECT_PRODUCTION_URL === undefined
    ? null
    : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;

const deploymentUrl = () => {
  if (process.env.VERCEL_ENV === "production" && VERCEL_PRODUCTION_URL !== null) {
    return VERCEL_PRODUCTION_URL;
  }

  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL !== undefined) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return `http://localhost:${process.env.PORT ?? "5174"}`;
};

export const APP_URL = env.APP_URL ?? deploymentUrl();

export const DEPLOYMENT_ORIGIN =
  process.env.VERCEL_URL === undefined ? null : `https://${process.env.VERCEL_URL}`;
