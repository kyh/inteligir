import { z } from "zod";

import type { UploadAsk } from "./file-store";
import { signerFor } from "./file-keys";

export const DEV_FILES_PATH = "/api/dev/files";

const signer = signerFor("dev-files");

const canonical = ({ bytes, mime, pathname, validUntil }: UploadAsk) =>
  [pathname, mime, String(bytes), String(validUntil)].join("\n");

export const devUploadUrl = (ask: UploadAsk) => {
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

export const devUploadOf = (url: URL) => {
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams));

  if (!query.success) {
    return null;
  }

  const { bytes, mime, pathname, signature, until } = query.data;
  const ask = { bytes, mime, pathname, validUntil: until };

  return signer.verifies(canonical(ask), signature) && until > Date.now() ? ask : null;
};
