// The file store as a folder on disk, for every server off Vercel: development, the e2e run and
// the suites, with no secret and no network. Each object is its bytes at its pathname under the
// folder and a sidecar beside them, `<pathname>.json`, holding its type and when it goes; the
// sidecar is written last, so bytes half written are no object, and an object past its time reads
// as gone. Nothing sweeps what expired: a folder of development's files is the developer's to clear.

import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

// what became of bytes sent to a pathname
type Received = "stored" | "exists" | "too-large";

export interface DiskFileStore extends FileStore {
  // an upload's body as it streams in, refused once it passes `maxBytes`
  readonly receive: (
    pathname: string,
    body: Body,
    object: { readonly mime: string; readonly maxBytes: number },
  ) => Promise<Received>;
}

const failedWith = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;

// an object's sidecar while it has not expired, or null
const sidecarOf = async (at: string): Promise<Sidecar | null> => {
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

// replaced whole, so a read never meets half a sidecar
const writeSidecar = async (at: string, sidecar: Sidecar): Promise<void> => {
  const next = `${at}.json.next`;
  await writeFile(next, JSON.stringify(sidecar));
  await rename(next, `${at}.json`);
};

// the bytes of `body` written to a file made for them, refused past `maxBytes`
const writeNew = async (at: string, body: Body, maxBytes: number): Promise<Received> => {
  await mkdir(path.dirname(at), { recursive: true });
  let handle;
  try {
    handle = await open(at, "wx");
  } catch (error) {
    if (failedWith(error, "EEXIST")) {
      return "exists";
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
    return "too-large";
  }
  return "stored";
};

// bytes `start` through `end` of the file at `at`, read as they are pulled
const streamOf = async (
  at: string,
  { end, start }: ByteRange,
): Promise<ReadableStream<Uint8Array>> => {
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
  });
};

export const diskFileStore = (dir: string): DiskFileStore => {
  const root = path.resolve(dir);

  const fileAt = (pathname: string): string => {
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

  const head = async (pathname: string): Promise<StoredObject | null> => {
    const at = fileAt(pathname);
    const sidecar = await sidecarOf(at);
    if (sidecar === null) {
      return null;
    }
    const { size } = await stat(at);
    return { bytes: size, expiresAt: sidecar.expiresAt, mime: sidecar.mime };
  };

  return {
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
    },
    uploadTicket: async (ask) =>
      await Promise.resolve({ headers: { "content-type": ask.mime }, url: devUploadUrl(ask) }),
  };
};
