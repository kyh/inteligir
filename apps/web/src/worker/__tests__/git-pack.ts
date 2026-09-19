import { hexFromBytes } from "@repo/api/cloud/bytes";
import { SELF } from "cloudflare:test";
import { deviceHeaders, ORIGIN } from "./cloud-helpers";

// enough of the receive-pack wire to push real commits at the in-process Worker

const REMOTE = `${ORIGIN}/v1/git/vault.git`;

export const ZERO_OID = "0".repeat(40);

const encoder = new TextEncoder();

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const sha1 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));

const deflate = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const wrote = (async () => {
    await writer.write(bytes);
    await writer.close();
  })();
  const out = new Uint8Array(await new Response(stream.readable).arrayBuffer());
  await wrote;
  return out;
};

interface GitObject {
  type: 1 | 2 | 3;
  oid: string;
  raw: Uint8Array;
}

const TYPE_NAMES = { 1: "commit", 2: "tree", 3: "blob" } as const;

const gitObject = async (type: 1 | 2 | 3, raw: Uint8Array): Promise<GitObject> => {
  const header = encoder.encode(`${TYPE_NAMES[type]} ${raw.length}\0`);
  return { oid: hexFromBytes(await sha1(concat([header, raw]))), raw, type };
};

const oidBytes = (oid: string): Uint8Array => {
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) {
    out[i] = Number.parseInt(oid.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

// pack entry header: 4 bits of type, then the size in little-endian 7-bit groups
/* oxlint-disable eslint/no-bitwise -- the pack format is defined in bits */
const entryHeader = (type: number, size: number): Uint8Array => {
  const bytes: number[] = [];
  let first = (type << 4) | (size & 0x0f);
  let rest = size >> 4;
  while (rest > 0) {
    bytes.push(first | 0x80);
    first = rest & 0x7f;
    rest >>= 7;
  }
  bytes.push(first);
  return new Uint8Array(bytes);
};
/* oxlint-enable eslint/no-bitwise */

const buildPack = async (objects: GitObject[]): Promise<Uint8Array> => {
  const head = new Uint8Array(12);
  head.set(encoder.encode("PACK"));
  new DataView(head.buffer).setUint32(4, 2);
  new DataView(head.buffer).setUint32(8, objects.length);
  const entries: Uint8Array[] = [head];
  for (const object of objects) {
    entries.push(entryHeader(object.type, object.raw.length), await deflate(object.raw));
  }
  const body = concat(entries);
  return concat([body, await sha1(body)]);
};

const pktLine = (text: string): Uint8Array => {
  const payload = encoder.encode(text);
  const length = (payload.length + 4).toString(16).padStart(4, "0");
  return concat([encoder.encode(length), payload]);
};

export interface PushFile {
  path: string;
  content: string | Uint8Array;
}

interface DirNode {
  files: Map<string, Uint8Array>;
  dirs: Map<string, DirNode>;
}

const emptyDir = (): DirNode => ({ dirs: new Map(), files: new Map() });

const insert = (root: DirNode, path: string, bytes: Uint8Array): void => {
  const segments = path.split("/");
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    let next = node.dirs.get(segment);
    if (next === undefined) {
      next = emptyDir();
      node.dirs.set(segment, next);
    }
    node = next;
  }
  const leaf = segments.at(-1);
  if (leaf === undefined) {
    throw new Error(`empty path: ${path}`);
  }
  node.files.set(leaf, bytes);
};

// git sorts tree entries as if a directory name carried a trailing slash
const treeSortKey = (name: string, isTree: boolean): string => (isTree ? `${name}/` : name);

const writeTree = async (node: DirNode, objects: GitObject[]): Promise<string> => {
  const entries: { name: string; mode: string; oid: string; isTree: boolean }[] = [];
  for (const [name, bytes] of node.files) {
    const blob = await gitObject(3, bytes);
    objects.push(blob);
    entries.push({ isTree: false, mode: "100644", name, oid: blob.oid });
  }
  for (const [name, dir] of node.dirs) {
    const oid = await writeTree(dir, objects);
    entries.push({ isTree: true, mode: "40000", name, oid });
  }
  entries.sort((a, b) => {
    const ka = treeSortKey(a.name, a.isTree);
    const kb = treeSortKey(b.name, b.isTree);
    if (ka < kb) {
      return -1;
    }
    return ka > kb ? 1 : 0;
  });
  const raw = concat(
    entries.map((entry) =>
      concat([encoder.encode(`${entry.mode} ${entry.name}\0`), oidBytes(entry.oid)]),
    ),
  );
  const tree = await gitObject(2, raw);
  objects.push(tree);
  return tree.oid;
};

export const pushVaultFiles = async (
  credential: string,
  message: string,
  files: readonly PushFile[],
  oldOid: string,
  parent?: string,
): Promise<{ response: Response; commit: string }> => {
  const root = emptyDir();
  for (const file of files) {
    insert(
      root,
      file.path,
      file.content instanceof Uint8Array ? file.content : encoder.encode(file.content),
    );
  }
  const objects: GitObject[] = [];
  const treeOid = await writeTree(root, objects);
  const person = "Test <t@example.test> 1700000000 +0000";
  const commit = await gitObject(
    1,
    encoder.encode(
      `tree ${treeOid}\n${
        parent === undefined ? "" : `parent ${parent}\n`
      }author ${person}\ncommitter ${person}\n\n${message}\n`,
    ),
  );
  objects.push(commit);
  // a pack carrying the same blob twice is malformed
  const unique = [...new Map(objects.map((object) => [object.oid, object])).values()];
  const command = pktLine(`${oldOid} ${commit.oid} refs/heads/main\0report-status`);
  const body = concat([command, encoder.encode("0000"), await buildPack(unique)]);
  const response = await SELF.fetch(`${REMOTE}/git-receive-pack`, {
    body,
    headers: {
      ...deviceHeaders(credential),
      "content-type": "application/x-git-receive-pack-request",
    },
    method: "POST",
  });
  return { commit: commit.oid, response };
};
