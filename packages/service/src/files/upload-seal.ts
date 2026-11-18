import { shaSchema } from "@repo/contract/library/library-wire";
import { z } from "zod";

import { signerFor } from "./file-keys";

const uploadSealSchema = z.object({
  bytes: z.number().int().nonnegative(),
  mime: z.string(),
  nonce: z.string(),
  sha: shaSchema,
});

export type UploadSeal = z.infer<typeof uploadSealSchema>;

const signer = signerFor("upload");

export const sealUpload = (seal: UploadSeal) => {
  const body = Buffer.from(JSON.stringify(seal)).toString("base64url");

  return `${body}.${signer.sign(body)}`;
};

export const openUpload = (uploadId: string) => {
  const [body, signature, ...rest] = uploadId.split(".");

  if (body === undefined || signature === undefined || rest.length > 0) {
    return null;
  }

  if (!signer.verifies(body, signature)) {
    return null;
  }

  const json: unknown = JSON.parse(Buffer.from(body, "base64url").toString());
  const seal = uploadSealSchema.safeParse(json);

  return seal.success ? seal.data : null;
};
