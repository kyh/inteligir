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

const PAGE = 1000;

const REMOVE_BATCH = 100;
const REMOVE_PAUSE_MS = 2000;

const CONTENT_RANGE = /^bytes (?<start>\d+)-(?<end>\d+)\/\d+$/u;

const servedRange = (header: string | null) => {
  const groups = CONTENT_RANGE.exec(header ?? "")?.groups;

  return (
    groups?.start === undefined || groups.end === undefined
      ? null
      : { end: Number(groups.end), start: Number(groups.start) }
  ) satisfies ByteRange | null;
};

type RemovedBatch = "more" | "emptied" | "limited";

const removeBatch = async (prefix: string, token: string) => {
  try {
    const page = await list({ limit: REMOVE_BATCH, prefix, token });

    if (page.blobs.length > 0) {
      await del(
        page.blobs.map((blob) => blob.pathname),
        { token },
      );
    }

    return (page.hasMore ? "more" : "emptied") satisfies RemovedBatch;
  } catch (error) {
    if (error instanceof BlobServiceRateLimited) {
      return "limited" as const;
    }

    throw error;
  }
};

export const blobFileStore = (token: string) =>
  ({
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
  }) satisfies FileStore;
