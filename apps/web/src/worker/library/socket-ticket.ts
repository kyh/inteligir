// The ticket the account's socket opens with: a browser's WebSocket carries no header, so an
// authenticated `/v1` call (`account.socketTicket`) mints one and the socket's query string brings
// it back. It names the account and the credential that asked, expires in a minute, and is signed
// with HMAC-SHA-256 under a key derived from the Worker's secret by HKDF, all Web Crypto
// (https://developers.cloudflare.com/workers/runtime-apis/web-crypto/); its signature is compared
// as hashes with `timingSafeEqual`, so the comparison takes the same time whatever was presented.

import { base64FromBytes, bytesFromBase64 } from "@repo/contract/cloud/bytes";
import { z } from "zod";

import type { SocketHolder } from "./cell-sockets";

export const SOCKET_TICKET_TTL_MS = 60_000;

const KEY_INFO = "inteligir library socket ticket";

const encoder = new TextEncoder();

const claimSchema = z.strictObject({
  accountId: z.string().min(1).max(128),
  expiresAt: z.number().int().nonnegative(),
  holder: z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
    kind: z.enum(["device", "session"]),
  }),
});

export interface SocketClaim {
  readonly accountId: string;
  readonly holder: SocketHolder;
  readonly expiresAt: number;
}

const base64Url = (bytes: Uint8Array): string =>
  base64FromBytes(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/[=]+$/u, "");

const BASE64_URL = /^[A-Za-z0-9_-]+$/u;

const bytesOfBase64Url = (text: string): Uint8Array | null => {
  if (!BASE64_URL.test(text) || text.length % 4 === 1) {
    return null;
  }
  const padded = text
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  return bytesFromBase64(padded);
};

const ticketKey = async (secret: string): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return await crypto.subtle.deriveKey(
    { hash: "SHA-256", info: encoder.encode(KEY_INFO), name: "HKDF", salt: new Uint8Array(0) },
    material,
    { hash: "SHA-256", length: 256, name: "HMAC" },
    false,
    ["sign"],
  );
};

const signatureOf = async (key: CryptoKey, payload: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));

const digest = async (bytes: Uint8Array): Promise<ArrayBuffer> =>
  await crypto.subtle.digest("SHA-256", bytes);

export const mintSocketTicket = async (
  secret: string,
  claim: { readonly accountId: string; readonly holder: SocketHolder },
  now: number,
): Promise<{ readonly ticket: string; readonly expiresAt: number }> => {
  const expiresAt = now + SOCKET_TICKET_TTL_MS;
  const payload = base64Url(
    encoder.encode(JSON.stringify({ accountId: claim.accountId, expiresAt, holder: claim.holder })),
  );
  const signature = await signatureOf(await ticketKey(secret), payload);
  return { expiresAt, ticket: `${payload}.${base64Url(signature)}` };
};

// the claim a ticket signed and still holds, or null for one forged, mangled or expired
export const readSocketTicket = async (
  secret: string,
  ticket: string,
  now: number,
): Promise<SocketClaim | null> => {
  const [payload, signature, ...rest] = ticket.split(".");
  if (payload === undefined || signature === undefined || rest.length > 0) {
    return null;
  }
  const presented = bytesOfBase64Url(signature);
  const body = bytesOfBase64Url(payload);
  if (presented === null || body === null) {
    return null;
  }
  const expected = await signatureOf(await ticketKey(secret), payload);
  const [left, right] = await Promise.all([digest(expected), digest(presented)]);
  if (!crypto.subtle.timingSafeEqual(left, right)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  const claim = claimSchema.safeParse(raw);
  return claim.success && claim.data.expiresAt > now ? claim.data : null;
};
