import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { devUploadUrl } from "./dev-upload-signature";
import { UNKEPT_TTL_DAYS } from "./file-store";
import type { ByteRange, FileStore, StoredObject } from "./file-store";

const DAY_MS = 86_400_000;
const READ_CHUNK_BYTES = 256 * 1024;

const sidecarSchema = z.object({ expiresAt: z.number().nullable(), mime: z.string() });

type Sidecar = z.infer<typeof sidecarSchema>;

type Body = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

type Received = "stored" | "exists" | "too-large";

export interface DiskFileStore extends FileStore {
  readonly receive: (
    pathname: string,
    body: Body,
    object: { readonly mime: string; readonly maxBytes: number },
  ) => Promise<Received>;
}

const failedWith = (cause: unknown, code: string) =>
  cause instanceof Error && "code" in cause && cause.code === code;

const sidecarOf = async (at: string) => {
  try {
    const sidecar = sidecarSchema.parse(JSON.parse(await readFile(`${at}.json`, "utf-8")));

    return sidecar.expiresAt !== null && sidecar.expiresAt <= Date.now() ? null : sidecar;
  } catch (error) {
    if (failedWith(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
};

const writeSidecar = async (at: string, sidecar: Sidecar) => {
  const next = `${at}.json.next`;
  await writeFile(next, JSON.stringify(sidecar));
  await rename(next, `${at}.json`);
};

const writeNew = async (at: string, body: Body, maxBytes: number) => {
  await mkdir(path.dirname(at), { recursive: true });
  let handle;

  try {
    handle = await open(at, "wx");
  } catch (error) {
    if (failedWith(error, "EEXIST")) {
      return "exists" as const;
    }

    throw error;
  }

  let written = 0;

  try {
    for await (const chunk of body) {
      written += chunk.byteLength;

      if (written > maxBytes) {
        break;
      }

      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }

  if (written > maxBytes) {
    await rm(at, { force: true });

    return "too-large" as const;
  }

  return "stored" as const;
};

const streamOf = async (at: string, { end, start }: ByteRange) => {
  const handle = await open(at, "r");
  let position = start;

  return new ReadableStream<Uint8Array>({
    cancel: async () => {
      await handle.close();
    },
    pull: async (controller) => {
      const length = Math.min(READ_CHUNK_BYTES, end - position + 1);
      const chunk = new Uint8Array(Math.max(length, 0));

      const { bytesRead } =
        length > 0 ? await handle.read(chunk, 0, length, position) : { bytesRead: 0 };

      if (bytesRead === 0) {
        await handle.close();
        controller.close();

        return;
      }

      position += bytesRead;
      controller.enqueue(chunk.subarray(0, bytesRead));
    },
  }) satisfies ReadableStream<Uint8Array>;
};

export const diskFileStore = (dir: string) => {
  const root = path.resolve(dir);

  const fileAt = (pathname: string) => {
    const at = path.resolve(root, pathname);

    if (!at.startsWith(`${root}${path.sep}`)) {
      throw new Error(`the pathname ${pathname} is outside the file store`);
    }

    return at;
  };

  const receive: DiskFileStore["receive"] = async (pathname, body, { maxBytes, mime }) => {
    const at = fileAt(pathname);
    const received = await writeNew(at, body, maxBytes);

    if (received === "stored") {
      await writeSidecar(at, { expiresAt: Date.now() + UNKEPT_TTL_DAYS * DAY_MS, mime });
    }

    return received;
  };

  const head = async (pathname: string) => {
    const at = fileAt(pathname);
    const sidecar = await sidecarOf(at);

    if (sidecar === null) {
      return null;
    }

    const { size } = await stat(at);

    return {
      bytes: size,
      expiresAt: sidecar.expiresAt,
      mime: sidecar.mime,
    } satisfies StoredObject | null;
  };

  return {
    folders: async (prefix) => {
      try {
        const entries = await readdir(fileAt(prefix), { withFileTypes: true });

        return entries
          .filter((entry) => entry.isDirectory())
          .map(({ name }) => `${prefix}${name}/`);
      } catch (error) {
        if (failedWith(error, "ENOENT")) {
          return [];
        }

        throw error;
      }
    },
    head,
    keep: async (pathname) => {
      const at = fileAt(pathname);
      const sidecar = await sidecarOf(at);

      if (sidecar === null) {
        throw new Error(`no object at ${pathname} to keep`);
      }

      await writeSidecar(at, { ...sidecar, expiresAt: null });
    },
    put: async (pathname, bytes, mime) => {
      const received = await receive(pathname, [bytes], { maxBytes: bytes.byteLength, mime });

      if (received !== "stored") {
        throw new Error(`the object at ${pathname} ${received}`);
      }
    },
    read: async (pathname, range) => {
      const object = await head(pathname);

      if (object === null) {
        return null;
      }

      const span = range ?? { end: object.bytes - 1, start: 0 };

      return { body: await streamOf(fileAt(pathname), span), range };
    },
    receive,
    remove: async (pathname) => {
      const at = fileAt(pathname);
      await rm(`${at}.json`, { force: true });
      await rm(at, { force: true });
    },
    removePrefix: async (prefix) => {
      await rm(fileAt(prefix), { force: true, recursive: true });

      return "emptied";
    },
    uploadTicket: async (ask) =>
      await Promise.resolve({ headers: { "content-type": ask.mime }, url: devUploadUrl(ask) }),
  } satisfies DiskFileStore;
};
