// The upload a server off Vercel takes on its own origin, in place of the store's presigned URL:
// `/api/dev/files` with the pathname, type, size and deadline in its query, signed over all four,
// so a device sends one object, once, as a presigned PUT lets it.

import { z } from "zod";

import type { UploadAsk } from "./file-store";
import { signerFor } from "./file-keys";

export const DEV_FILES_PATH = "/api/dev/files";

const signer = signerFor("dev-files");

const canonical = ({ bytes, mime, pathname, validUntil }: UploadAsk): string =>
  [pathname, mime, String(bytes), String(validUntil)].join("\n");

export const devUploadUrl = (ask: UploadAsk): string => {
  const query = new URLSearchParams({
    bytes: String(ask.bytes),
    mime: ask.mime,
    pathname: ask.pathname,
    until: String(ask.validUntil),
  });
  query.set("signature", signer.sign(canonical(ask)));
  return `${DEV_FILES_PATH}?${query.toString()}`;
};

const whole = z
  .string()
  .regex(/^\d{1,15}$/u)
  .transform(Number);
const querySchema = z.object({
  bytes: whole,
  mime: z.string(),
  pathname: z.string(),
  signature: z.string(),
  until: whole,
});

// the upload a URL signs while its deadline has not passed, or null
export const devUploadOf = (url: URL): UploadAsk | null => {
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) {
    return null;
  }
  const { bytes, mime, pathname, signature, until } = query.data;
  const ask = { bytes, mime, pathname, validUntil: until };
  return signer.verifies(canonical(ask), signature) && until > Date.now() ? ask : null;
};
