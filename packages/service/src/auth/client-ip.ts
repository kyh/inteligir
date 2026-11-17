// Who a request is from, for every per-address window: Better Auth's limiter and the app's own
// (../rate-limit.ts) read it alike, so both count the same caller. On Vercel the platform writes
// x-vercel-forwarded-for itself; elsewhere Better Auth's default trusts a single-valued
// X-Forwarded-For, which `next start` fills only when absent, so a local caller may name its own.
// getIP masks an IPv6 address to its /64, which one host holds whole and could otherwise walk for a
// fresh window on every request.

import { getIP } from "better-auth/api";

interface ClientIpOptions {
  readonly ipAddressHeaders?: string[];
}

const VERCEL_IP_HEADERS = ["x-vercel-forwarded-for", "x-forwarded-for"];

export const clientIpOptions = (vercel: boolean): ClientIpOptions =>
  vercel ? { ipAddressHeaders: [...VERCEL_IP_HEADERS] } : {};

export const CLIENT_IP = clientIpOptions(process.env.VERCEL !== undefined);

export const clientAddressOf = (request: Request): string | null =>
  getIP(request, { advanced: { ipAddress: { ...CLIENT_IP } } });
