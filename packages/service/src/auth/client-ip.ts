import { getIP } from "better-auth/api";

interface ClientIpOptions {
  readonly ipAddressHeaders?: string[];
}

const VERCEL_IP_HEADERS = ["x-vercel-forwarded-for", "x-forwarded-for"];

export const clientIpOptions = (vercel: boolean) =>
  (vercel ? { ipAddressHeaders: [...VERCEL_IP_HEADERS] } : {}) satisfies ClientIpOptions;

export const CLIENT_IP = clientIpOptions(process.env.VERCEL !== undefined);

export const clientAddressOf = (request: Request) =>
  getIP(request, { advanced: { ipAddress: { ...CLIENT_IP } } });
