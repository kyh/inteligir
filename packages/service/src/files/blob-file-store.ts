// The file store on private Vercel Blob, the one importer of @vercel/blob. A device's upload goes
// straight to Blob on a URL presigned for its one pathname, size and type, past a function's 4.5 MB
// body (sp-presigned-put); a read asks Blob for the range it was handed and says which range Blob
// answered, since the SDK calls every answer 200 (sp-ranged-stream).

import { setTimeout as sleep } from "node:timers/promises";

import {
  BlobNotFoundError,
  BlobServiceRateLimited,
  del,
  get,
  head,
  issueSignedToken,
  list,
  presignUrl,
  put,
  setTtl,
} from "@vercel/blob";

import { UNKEPT_TTL_DAYS } from "./file-store";
import type { ByteRange, FileStore } from "./file-store";

// Blob's own page size for a listing
const PAGE = 1000;

// A prefix's removal goes a batch, then a pause: Blob's rate limit counts each pathname of a delete
// of many, 4,500 a minute on Pro, and the SDK never retries one it refused. This pace is two thirds
// of that, leaving room for uploads
const REMOVE_BATCH = 100;
const REMOVE_PAUSE_MS = 2000;

const CONTENT_RANGE = /^bytes (?<start>\d+)-(?<end>\d+)\/\d+$/u;

const servedRange = (header: string | null): ByteRange | null => {
  const groups = CONTENT_RANGE.exec(header ?? "")?.groups;
  return groups?.start === undefined || groups.end === undefined
    ? null
    : { end: Number(groups.end), start: Number(groups.start) };
};

type RemovedBatch = "more" | "emptied" | "limited";

const removeBatch = async (prefix: string, token: string): Promise<RemovedBatch> => {
  try {
    const page = await list({ limit: REMOVE_BATCH, prefix, token });
    if (page.blobs.length > 0) {
      await del(
        page.blobs.map((blob) => blob.pathname),
        { token },
      );
    }
    return page.hasMore ? "more" : "emptied";
  } catch (error) {
    if (error instanceof BlobServiceRateLimited) {
      return "limited";
    }
    throw error;
  }
};

export const blobFileStore = (token: string): FileStore => ({
  folders: async (prefix) => {
    const folders: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ cursor, limit: PAGE, mode: "folded", prefix, token });
      folders.push(...page.folders);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor !== undefined);
    return folders;
  },
  head: async (pathname) => {
    try {
      const object = await head(pathname, { token });
      return {
        bytes: object.size,
        expiresAt: object.expiresAt?.getTime() ?? null,
        mime: object.contentType,
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return null;
      }
      throw error;
    }
  },
  // a list of one, since only a list's answer says when no object was there to keep
  keep: async (pathname) => {
    const [kept] = await setTtl([pathname], { token, ttlDays: null });
    if (kept === undefined || "error" in kept) {
      throw new Error(`Blob kept nothing at ${pathname}: ${kept?.error.code ?? "no answer"}`);
    }
  },
  put: async (pathname, bytes, mime) => {
    await put(pathname, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: mime,
      token,
      ttlDays: UNKEPT_TTL_DAYS,
    });
  },
  read: async (pathname, range) => {
    const answer = await get(pathname, {
      access: "private",
      headers: range === null ? undefined : { range: `bytes=${range.start}-${range.end}` },
      token,
    });
    if (answer === null) {
      return null;
    }
    if (answer.statusCode !== 200) {
      throw new Error(`Blob answered a read of ${pathname} with ${String(answer.statusCode)}`);
    }
    return { body: answer.stream, range: servedRange(answer.headers.get("content-range")) };
  },
  remove: async (pathname) => {
    await del(pathname, { token });
  },
  removePrefix: async (prefix, deadline) => {
    for (;;) {
      const removed = await removeBatch(prefix, token);
      if (removed !== "more") {
        return removed === "emptied" ? "emptied" : "unfinished";
      }
      if (Date.now() + REMOVE_PAUSE_MS >= deadline) {
        return "unfinished";
      }
      await sleep(REMOVE_PAUSE_MS);
    }
  },
  uploadTicket: async ({ bytes, mime, pathname, validUntil }) => {
    const allowedContentTypes = [mime];
    const signed = await issueSignedToken({
      allowedContentTypes,
      maximumSizeInBytes: bytes,
      operations: ["put"],
      pathname,
      token,
      validUntil,
    });
    const { presignedUrl } = await presignUrl(signed, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      allowedContentTypes,
      maximumSizeInBytes: bytes,
      operation: "put",
      pathname,
      ttlDays: UNKEPT_TTL_DAYS,
      validUntil,
    });
    return { headers: { "content-type": mime }, url: presignedUrl };
  },
});
