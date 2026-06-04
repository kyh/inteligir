interface CloudflareEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_SECRET: string;
  PRODUCTION_URL: string;
}

declare module "cloudflare:workers" {
  const env: CloudflareEnv;
}
