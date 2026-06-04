import { getRequestHeaders } from "@tanstack/react-start/server";
import { createDb } from "@repo/db/drizzle-client";
import { initAuth } from "@repo/api/auth/auth";
import { getCloudflareEnv } from "@/lib/cloudflare";

export function getServerContext() {
  const cfEnv = getCloudflareEnv();
  const db = createDb(cfEnv.DB);

  const headers = new Headers(getRequestHeaders());
  const host = headers.get("host") ?? headers.get("x-forwarded-host");
  const isLocalhost = host === "localhost" || host?.startsWith("localhost:");
  const protocol = isLocalhost ? "http" : "https";
  const baseUrl = host ? `${protocol}://${host}` : "http://localhost:5173";

  const auth = initAuth({
    db,
    baseURL: baseUrl,
    secret: cfEnv.AUTH_SECRET,
    productionURL: cfEnv.PRODUCTION_URL
      ? `https://${cfEnv.PRODUCTION_URL}`
      : undefined,
  });

  return { db, auth, baseUrl };
}
