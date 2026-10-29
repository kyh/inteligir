// A zip in R2 as the reader takes it (`./zip-read`): its size from the object's head and each read
// a ranged get (https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), so a zip
// is never held whole, however large.

import type { ByteSource } from "./zip-read";
import { ZipError } from "./zip-read";

// the object under `key` as a source, or null when the bucket holds none
export const r2Source = async (bucket: R2Bucket, key: string): Promise<ByteSource | null> => {
  const head = await bucket.head(key);
  if (head === null) {
    return null;
  }
  return {
    read: async (offset, length) => {
      if (length === 0) {
        return new Uint8Array();
      }
      const object = await bucket.get(key, { range: { length, offset } });
      if (object === null) {
        throw new ZipError("corrupt", "the zip went while it was read");
      }
      return new Uint8Array(await object.arrayBuffer());
    },
    size: head.size,
  };
};
