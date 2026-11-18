// What `library.files.reserve` told a device, carried back to `settle` in the upload's id: the
// sha, the size and the type it reserved and the nonce naming its object, signed, so the cloud
// writes nothing down between the two and trusts only what it sealed. It names no account: the
// object sits under the settling account's own pathname, and no expiry: the object's own
// (`UNKEPT_TTL_DAYS`) bounds how long it can be settled.

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

export const sealUpload = (seal: UploadSeal): string => {
  const body = Buffer.from(JSON.stringify(seal)).toString("base64url");
  return `${body}.${signer.sign(body)}`;
};

// the seal an upload's id carries, or null for an id the cloud never signed
export const openUpload = (uploadId: string): UploadSeal | null => {
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
