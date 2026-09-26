import { hexFromBytes } from "@repo/api/cloud/bytes";
import { SELF } from "cloudflare:test";
import {
  blobObject,
  commitObject,
  concatBytes,
  FILE_MODE,
  packHeader,
  TREE_MODE,
  treeObject,
  writePack,
} from "../vault/git-objects";
import type { GitObject, GitTreeEntry } from "../vault/git-objects";
import { FLUSH_PKT, pktLine, receivePackBody } from "../vault/receive-pack";
import { deviceHeaders, ORIGIN } from "./cloud-helpers";

// stock git's side of the wire, pushed and fetched at the in-process Worker

const REMOTE = `${ORIGIN}/v1/git/vault.git`;

export const ZERO_OID = "0".repeat(40);

const MAIN = "refs/heads/main";

const encoder = new TextEncoder();

interface PushedBytes {
  content: string | Uint8Array;
  mode?: "100644" | "100755" | "120000";
}

// raw segments carry a name that is not UTF-8
export type PushFile =
  | (PushedBytes & { path: string })
  | (PushedBytes & { segments: readonly Uint8Array[] });

interface DirNode {
  name: Uint8Array;
  files: Map<string, { name: Uint8Array; bytes: Uint8Array; mode: string }>;
  dirs: Map<string, DirNode>;
}

const emptyDir = (name: Uint8Array): DirNode => ({ dirs: new Map(), files: new Map(), name });

const segmentsOf = (file: PushFile): readonly Uint8Array[] =>
  "segments" in file
    ? file.segments
    : file.path.split("/").map((segment) => encoder.encode(segment));

const insert = (root: DirNode, file: PushFile): void => {
  const segments = segmentsOf(file);
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    const key = hexFromBytes(segment);
    const next = node.dirs.get(key) ?? emptyDir(segment);
    node.dirs.set(key, next);
    node = next;
  }
  const leaf = segments.at(-1);
  if (leaf === undefined) {
    throw new Error("a pushed file needs a path");
  }
  node.files.set(hexFromBytes(leaf), {
    bytes: file.content instanceof Uint8Array ? file.content : encoder.encode(file.content),
    mode: file.mode ?? FILE_MODE,
    name: leaf,
  });
};

const writeTree = async (node: DirNode, objects: GitObject[]): Promise<string> => {
  const entries: GitTreeEntry[] = [];
  for (const file of node.files.values()) {
    const blob = await blobObject(file.bytes);
    objects.push(blob);
    entries.push({ mode: file.mode, name: file.name, oid: blob.oid });
  }
  for (const dir of node.dirs.values()) {
    entries.push({ mode: TREE_MODE, name: dir.name, oid: await writeTree(dir, objects) });
  }
  const tree = await treeObject(entries);
  objects.push(tree);
  return tree.oid;
};

// a body sent with no length is what a stock git client streams for a large push, and it is
// what sends durable-git's pack bytes to R2 rather than the cell's SQLite
const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

interface PushOptions {
  readonly parent?: string;
  readonly length?: "declared" | "undeclared";
}

const TEST_PERSON = "Test <t@example.test> 1700000000 +0000";

export const pushVaultFiles = async (
  credential: string,
  message: string,
  files: readonly PushFile[],
  oldOid: string,
  { length = "declared", parent }: PushOptions = {},
): Promise<{ response: Response; commit: string }> => {
  const root = emptyDir(new Uint8Array());
  for (const file of files) {
    insert(root, file);
  }
  const objects: GitObject[] = [];
  const tree = await writeTree(root, objects);
  const commit = await commitObject({
    author: TEST_PERSON,
    committer: TEST_PERSON,
    message,
    parents: parent === undefined ? [] : [parent],
    tree,
  });
  const body = receivePackBody({
    next: commit.oid,
    old: oldOid,
    pack: await writePack([...objects, commit]),
    ref: MAIN,
  });
  const response = await SELF.fetch(`${REMOTE}/git-receive-pack`, {
    body: length === "declared" ? body : streamOf(body),
    headers: {
      ...deviceHeaders(credential),
      "content-type": "application/x-git-receive-pack-request",
    },
    method: "POST",
  });
  return { commit: commit.oid, response };
};

const OVERSIZED_CHUNK_BYTES = 1024 * 1024;

// what a stock git client streams for a vault over the push cap: a command, then `packBytes` of
// pack with no declared length. zeros past the header, since the cap has to refuse before a parse
export const pushOversizedPack = async (
  credential: string,
  packBytes: number,
): Promise<Response> => {
  const header = packHeader(1);
  let sent = header.length;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= packBytes) {
        controller.close();
        return;
      }
      const chunk = new Uint8Array(Math.min(OVERSIZED_CHUNK_BYTES, packBytes - sent));
      sent += chunk.length;
      controller.enqueue(chunk);
    },
    start(controller) {
      controller.enqueue(
        receivePackBody({ next: "1".repeat(40), old: ZERO_OID, pack: header, ref: MAIN }),
      );
    },
  });
  return await SELF.fetch(`${REMOTE}/git-receive-pack`, {
    body,
    headers: {
      ...deviceHeaders(credential),
      "content-type": "application/x-git-receive-pack-request",
    },
    method: "POST",
  });
};

// a v0 full clone over side-band-64k: the one fetch durable-git keeps a pack cache for
export const cloneVault = async (credential: string, head: string): Promise<Response> =>
  await SELF.fetch(`${REMOTE}/git-upload-pack`, {
    body: concatBytes([pktLine(`want ${head} side-band-64k\n`), FLUSH_PKT, pktLine("done\n")]),
    headers: {
      ...deviceHeaders(credential),
      "content-type": "application/x-git-upload-pack-request",
    },
    method: "POST",
  });
