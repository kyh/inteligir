import { env } from "cloudflare:workers";

export function getCloudflareEnv(): CloudflareEnv {
  return env as unknown as CloudflareEnv;
}
