// Bytes written into an R2 multipart upload in parts of one length, as R2 takes every part but the
// last (https://developers.cloudflare.com/r2/objects/multipart-objects/): a part goes up each time
// its length has gathered, and the bytes past the last whole part stay with the writer, which hands
// them to the sink its next run opens, so an upload a writer goes on with over many runs still has
// parts of one length.

export interface PartSink {
  // where the next byte lands, counted from the upload's first
  readonly offset: () => number;
  readonly write: (chunk: Uint8Array) => Promise<void>;
  // the parts this sink uploaded, in order
  readonly uploaded: readonly R2UploadedPart[];
  // the bytes past the last whole part
  readonly tail: () => Uint8Array;
}

const joined = (chunks: readonly Uint8Array[], length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
};

// a sink going on from `at`: the upload's bytes so far, the whole parts uploaded of them, and the
// bytes past those parts
export const partSink = (
  upload: R2MultipartUpload,
  partBytes: number,
  at: { readonly written: number; readonly parts: number; readonly tail: readonly Uint8Array[] },
): PartSink => {
  let pending = [...at.tail];
  let pendingBytes = pending.reduce((sum, chunk) => sum + chunk.length, 0);
  let offset = at.written;
  let { parts } = at;
  const uploaded: R2UploadedPart[] = [];
  return {
    offset: () => offset,
    tail: () => joined(pending, pendingBytes),
    uploaded,
    write: async (chunk) => {
      pending.push(chunk);
      pendingBytes += chunk.length;
      offset += chunk.length;
      while (pendingBytes >= partBytes) {
        const bytes = joined(pending, pendingBytes);
        parts += 1;
        uploaded.push(await upload.uploadPart(parts, bytes.subarray(0, partBytes)));
        const rest = bytes.subarray(partBytes);
        pending = rest.length === 0 ? [] : [rest];
        pendingBytes = rest.length;
      }
    },
  };
};
