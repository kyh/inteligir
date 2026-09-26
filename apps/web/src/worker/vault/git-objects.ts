import { hexFromBytes } from "@repo/api/cloud/bytes";

// git's object and pack encodings, byte for byte: an oid is the SHA-1 of what these write, so an
// order or a mode spelled differently from git's is a different object, or one fsck refuses.

export type GitObjectType = "blob" | "commit" | "tree";

export interface GitObject {
  readonly type: GitObjectType;
  readonly oid: string;
  readonly body: Uint8Array;
}

export interface GitTreeEntry {
  readonly mode: string;
  // bytes, not a string: a git name is any bytes but NUL and "/", and both the order and the oid
  // are taken over those bytes
  readonly name: Uint8Array;
  readonly oid: string;
}

export const FILE_MODE = "100644";
export const TREE_MODE = "40000";

const encoder = new TextEncoder();

export const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const sha1 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));

export const gitObject = async (type: GitObjectType, body: Uint8Array): Promise<GitObject> => {
  const header = encoder.encode(`${type} ${String(body.length)}\0`);
  return { body, oid: hexFromBytes(await sha1(concatBytes([header, body]))), type };
};

export const blobObject = async (bytes: Uint8Array): Promise<GitObject> =>
  await gitObject("blob", bytes);

const OID = /^[0-9a-f]{40}$/u;

const oidBytes = (oid: string): Uint8Array => {
  if (!OID.test(oid)) {
    throw new Error(`not a full lowercase oid: ${oid}`);
  }
  return Uint8Array.from({ length: 20 }, (_, index) =>
    Number.parseInt(oid.slice(index * 2, index * 2 + 2), 16),
  );
};

// a listing read back from a cell may carry the zero-padded spelling older gits wrote
const isTreeMode = (mode: string): boolean => mode === TREE_MODE || mode === "040000";

const SLASH = 0x2f;

// past its last byte a folder's name reads as "/" and a file's as nothing
const sortByte = (entry: GitTreeEntry, index: number): number | undefined =>
  index === entry.name.length && isTreeMode(entry.mode) ? SLASH : entry.name[index];

// git orders a tree by its names' bytes, which is not the order of JavaScript's UTF-16 compare
// once a name leaves the basic plane
const compareTreeEntries = (a: GitTreeEntry, b: GitTreeEntry): number => {
  const length = Math.max(a.name.length, b.name.length) + 1;
  for (let index = 0; index < length; index += 1) {
    const x = sortByte(a, index);
    const y = sortByte(b, index);
    if (x !== y) {
      if (x === undefined) {
        return -1;
      }
      return y === undefined ? 1 : x - y;
    }
  }
  return 0;
};

export const sortTreeEntries = (entries: readonly GitTreeEntry[]): GitTreeEntry[] =>
  entries.toSorted(compareTreeEntries);

// in the order given, so a listing read from a cell can be hashed back exactly as it was stored
export const serializeTree = (entries: readonly GitTreeEntry[]): Uint8Array =>
  concatBytes(
    entries.flatMap((entry) => [
      encoder.encode(`${entry.mode} `),
      entry.name,
      Uint8Array.of(0),
      oidBytes(entry.oid),
    ]),
  );

export const treeObject = async (entries: readonly GitTreeEntry[]): Promise<GitObject> =>
  await gitObject("tree", serializeTree(sortTreeEntries(entries)));

export interface GitPerson {
  readonly name: string;
  readonly email: string;
}

// `<` and `>` delimit the email and a line break ends the header, so a device name carrying one
// could forge a header line such as a parent; git's own parse refuses NUL and CR.
const IDENT_DELIMITERS = new Set(["<", ">", "\0", "\r", "\n"]);

const identPart = (value: string): string =>
  [...value]
    .filter((char) => !IDENT_DELIMITERS.has(char))
    .join("")
    .trim();

export const gitIdent = ({ email, name }: GitPerson, unixMs: number): string =>
  `${identPart(name)} <${identPart(email)}> ${String(Math.floor(unixMs / 1000))} +0000`;

export interface CommitFields {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly committer: string;
  // without the newline git ends a message with
  readonly message: string;
}

export const commitObject = async ({
  author,
  committer,
  message,
  parents,
  tree,
}: CommitFields): Promise<GitObject> =>
  await gitObject(
    "commit",
    encoder.encode(
      [
        `tree ${tree}`,
        ...parents.map((parent) => `parent ${parent}`),
        `author ${author}`,
        `committer ${committer}`,
        "",
        `${message}\n`,
      ].join("\n"),
    ),
  );

const PACK_TYPE_CODES = { blob: 3, commit: 1, tree: 2 } as const;

// the type in the first byte's bits 4-6 beside the size's low four bits, then the rest of the
// size in 7-bit groups, each byte's top bit saying another follows
const entryHeader = (type: GitObjectType, size: number): Uint8Array => {
  const bytes: number[] = [];
  let first = PACK_TYPE_CODES[type] * 0x10 + (size % 0x10);
  let rest = Math.floor(size / 0x10);
  while (rest > 0) {
    bytes.push(first + 0x80);
    first = rest % 0x80;
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(first);
  return Uint8Array.from(bytes);
};

export const packHeader = (count: number): Uint8Array => {
  const header = new Uint8Array(12);
  header.set(encoder.encode("PACK"));
  const view = new DataView(header.buffer);
  view.setUint32(4, 2);
  view.setUint32(8, count);
  return header;
};

// "deflate" is the zlib wrapping a pack entry is stored in; "deflate-raw" would drop its header
const deflate = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );

// one entry per oid: a pack carrying an object twice is malformed
export const writePack = async (objects: readonly GitObject[]): Promise<Uint8Array> => {
  const unique = [...new Map(objects.map((object) => [object.oid, object])).values()];
  const parts = [packHeader(unique.length)];
  for (const object of unique) {
    parts.push(entryHeader(object.type, object.body.length), await deflate(object.body));
  }
  const body = concatBytes(parts);
  return concatBytes([body, await sha1(body)]);
};
