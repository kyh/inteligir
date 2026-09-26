// the hosted vault's routes as the Worker answers them, over an in-memory history of commits: oids
// are git's own blob hash, so equal bytes share one as they do there, and a commit is the Worker's
// CAS per path (a change whose target the head holds is satisfied, a stale base is a 409 carrying
// what the head holds and who wrote it). `requests` logs each call as "tree <body>", "file
// <body>", "files <paths joined by ,> @<ref>", "asset <body>" or "commit <changes joined by ,>",
// a body the JSON the phone posted and a change spelled "put <path>@<base>", "delete
// <path>@<base>" or "move <from>><to>@<base>". A read's query in the URL, the GET form a stale
// install sends, is refused, so a suite passes only while the phone keeps paths out of the URL.

import { createHash } from "node:crypto";
import { createCloudClient } from "@repo/api/cloud/client";
import type { CloudClient, CloudFetch } from "@repo/api/cloud/client";
import { vaultCommitRequestSchema } from "@repo/api/cloud/vault/vault-commit-schema";
import type {
  VaultChangeRequest,
  VaultCommitRequest,
  VaultCommitResponse,
  VaultConflictAnswer,
  VaultConflictReason,
} from "@repo/api/cloud/vault/vault-commit-schema";
import {
  assetMediaType,
  VAULT_API_PATHS,
  VAULT_FILE_MAX_BYTES,
  vaultAssetQuerySchema,
  vaultFileQuerySchema,
  vaultFilesRequestSchema,
  vaultTreeQuerySchema,
} from "@repo/api/cloud/vault/vault-schema";
import type { VaultFilesResponse } from "@repo/api/cloud/vault/vault-schema";
import { z } from "zod";

export const blobOid = (content: string): string => {
  const bytes = Buffer.from(content, "utf-8");
  return createHash("sha1")
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest("hex");
};

const commitSha = (n: number): string => n.toString(16).padStart(40, "0");

const notFound = (message: string): Response =>
  Response.json({ error: { code: "not-found", message } }, { status: 404 });

const getFormRefused = (): Response =>
  Response.json(
    { error: { code: "bad-request", message: "Post the read's query as the body." } },
    { status: 400 },
  );

// a read answered from the query the phone posted; anything else is the GET form
const answerPosted = <TSchema extends z.ZodType>(
  schema: TSchema,
  url: URL,
  init: RequestInit | undefined,
  answer: (query: z.infer<TSchema>, body: string) => Response,
): Response => {
  const body = z.string().safeParse(init?.body);
  if (init?.method !== "POST" || url.search !== "" || !body.success) {
    return getFormRefused();
  }
  const query = schema.safeParse(JSON.parse(body.data));
  return query.success ? answer(query.data, body.data) : getFormRefused();
};

// the device every phone commit is authored as
export const FAKE_PHONE_DEVICE = "Test Phone";

// a commit that moved head answers with this header, so a test can lose exactly those answers
const APPLIED_HEADER = "x-fake-applied";

const describeChange = (change: VaultChangeRequest): string => {
  switch (change.op) {
    case "put": {
      return `put ${change.path}@${change.base ?? "absent"}`;
    }
    case "delete": {
      return `delete ${change.path}@${change.base}`;
    }
    case "move": {
      return `move ${change.from}>${change.to}@${change.base}`;
    }
    // no default
  }
};

const putText = (change: Extract<VaultChangeRequest, { op: "put" }>): string =>
  change.content.encoding === "utf-8"
    ? change.content.text
    : Buffer.from(change.content.data, "base64").toString("latin1");

interface Revision {
  sha: string;
  files: ReadonlyMap<string, string>;
}

const treePage = (revision: Revision, after: string | null, pageSize: number): Response => {
  const paths = [...revision.files.keys()].toSorted();
  const from = after === null ? paths : paths.filter((path) => path > after);
  const page = from.slice(0, pageSize);
  const last = page.at(-1);
  return Response.json({
    commit: revision.sha,
    entries: page.map((path) => {
      const content = revision.files.get(path) ?? "";
      return { oid: blobOid(content), path, size: Buffer.byteLength(content) };
    }),
    next: from.length > page.length && last !== undefined ? last : null,
  });
};

const filesAnswer = (revision: Revision | null, ref: string, paths: string[]): Response => {
  const answer: VaultFilesResponse = {
    commit: ref,
    deferred: [],
    files: [],
    missing: [],
    refused: [],
  };
  for (const path of paths) {
    const content = revision?.files.get(path);
    if (content === undefined) {
      answer.missing.push(path);
    } else {
      answer.files.push({ content, oid: blobOid(content), path });
    }
  }
  return Response.json(answer);
};

// a change against head, as the Worker plans it: already held, applicable, or a conflict
type ChangeVerdict =
  | { kind: "satisfied" }
  | { kind: "apply"; writes: readonly (readonly [string, string | null])[] }
  | { kind: "conflict"; path: string; reason: VaultConflictReason };

const classifyPut = (
  before: ReadonlyMap<string, string>,
  change: Extract<VaultChangeRequest, { op: "put" }>,
): ChangeVerdict => {
  const text = putText(change);
  const current = before.get(change.path);
  if (current !== undefined && blobOid(current) === blobOid(text)) {
    return { kind: "satisfied" };
  }
  if (current === undefined ? change.base === null : blobOid(current) === change.base) {
    return { kind: "apply", writes: [[change.path, text]] };
  }
  if (current === undefined) {
    return { kind: "conflict", path: change.path, reason: "missing" };
  }
  return {
    kind: "conflict",
    path: change.path,
    reason: change.base === null ? "exists" : "changed",
  };
};

const classifyChange = (
  before: ReadonlyMap<string, string>,
  change: VaultChangeRequest,
): ChangeVerdict => {
  switch (change.op) {
    case "put": {
      return classifyPut(before, change);
    }
    case "delete": {
      const current = before.get(change.path);
      if (current === undefined) {
        return { kind: "satisfied" };
      }
      return blobOid(current) === change.base
        ? { kind: "apply", writes: [[change.path, null]] }
        : { kind: "conflict", path: change.path, reason: "changed" };
    }
    case "move": {
      const source = before.get(change.from);
      const destination = before.get(change.to);
      if (source === undefined) {
        return destination !== undefined && blobOid(destination) === change.base
          ? { kind: "satisfied" }
          : { kind: "conflict", path: change.from, reason: "missing" };
      }
      if (blobOid(source) !== change.base) {
        return { kind: "conflict", path: change.from, reason: "changed" };
      }
      if (destination !== undefined) {
        return { kind: "conflict", path: change.to, reason: "exists" };
      }
      return {
        kind: "apply",
        writes: [
          [change.from, null],
          [change.to, source],
        ],
      };
    }
    // no default
  }
};

const resultOf = (change: VaultChangeRequest): VaultCommitResponse["results"][number] => {
  switch (change.op) {
    case "put": {
      return { oid: blobOid(putText(change)), path: change.path };
    }
    case "delete": {
      return { oid: null, path: change.path };
    }
    case "move": {
      return { oid: change.base, path: change.to };
    }
    // no default
  }
};

export interface FakeVault {
  requests: string[];
  fetch: CloudFetch;
  head: () => string;
  // a new head: the current files with these changes, null deleting a path, written by `device`
  change: (changes: Record<string, string | null>, device?: string) => string;
  // what head holds
  files: () => Record<string, string>;
  commits: () => number;
}

export const createFakeVault = (
  initial: Record<string, string>,
  options: { pageSize?: number } = {},
): FakeVault => {
  const pageSize = options.pageSize ?? 2;
  const history = new Map<string, ReadonlyMap<string, string>>();
  // the device whose commit last touched each path, which a conflict names
  const writers = new Map<string, string>();
  let head = "";
  const requests: string[] = [];

  const commit = (files: ReadonlyMap<string, string>, device: string): string => {
    const previous = history.get(head) ?? new Map<string, string>();
    for (const path of new Set([...previous.keys(), ...files.keys()])) {
      if (previous.get(path) !== files.get(path)) {
        writers.set(path, device);
      }
    }
    head = commitSha(history.size + 1);
    history.set(head, files);
    return head;
  };
  commit(new Map(Object.entries(initial)), "Mac");

  const at = (ref: string | null): Revision | null => {
    const sha = ref ?? head;
    const files = history.get(sha);
    return files === undefined ? null : { files, sha };
  };

  const conflictOn = (
    files: ReadonlyMap<string, string>,
    path: string,
    reason: VaultConflictReason,
  ): VaultConflictAnswer["conflict"]["conflicts"][number] => {
    const content = files.get(path);
    return {
      current: content === undefined ? null : { content, oid: blobOid(content) },
      device: writers.get(path) ?? null,
      path,
      reason,
    };
  };

  const commitAnswer = (request: VaultCommitRequest): Response => {
    const tooLarge = request.changes.some(
      (change) =>
        change.op === "put" &&
        change.content.encoding === "utf-8" &&
        Buffer.byteLength(change.content.text) > VAULT_FILE_MAX_BYTES,
    );
    if (tooLarge) {
      return Response.json(
        { error: { code: "file-too-large", message: "notes over the cap do not cross" } },
        { status: 413 },
      );
    }
    const before = history.get(head) ?? new Map<string, string>();
    const verdicts = request.changes.map((change) => classifyChange(before, change));
    const conflicts = verdicts.flatMap((verdict) =>
      verdict.kind === "conflict" ? [conflictOn(before, verdict.path, verdict.reason)] : [],
    );
    if (conflicts.length > 0) {
      const answer: VaultConflictAnswer = {
        conflict: { conflicts, head },
        error: { code: "vault-conflict", message: "The vault changed under this change set." },
      };
      return Response.json(answer, { status: 409 });
    }
    const results = request.changes.map(resultOf);
    const writes = verdicts.flatMap((verdict) => (verdict.kind === "apply" ? verdict.writes : []));
    if (writes.length === 0) {
      return Response.json({ commit: head, results });
    }
    const files = new Map(before);
    for (const [path, text] of writes) {
      if (text === null) {
        files.delete(path);
      } else {
        files.set(path, text);
      }
    }
    const body: VaultCommitResponse = { commit: commit(files, FAKE_PHONE_DEVICE), results };
    return Response.json(body, { headers: { [APPLIED_HEADER]: "true" } });
  };

  const fetch: CloudFetch = async (input, init) => {
    const url = new URL(input);
    switch (url.pathname) {
      case VAULT_API_PATHS.tree: {
        return answerPosted(vaultTreeQuerySchema, url, init, ({ after, ref }, body) => {
          requests.push(`tree ${body}`);
          const revision = at(ref ?? null);
          return revision === null
            ? notFound("That revision is not in the vault.")
            : treePage(revision, after ?? null, pageSize);
        });
      }
      case VAULT_API_PATHS.file: {
        return answerPosted(vaultFileQuerySchema, url, init, ({ path, ref }, body) => {
          requests.push(`file ${body}`);
          const content = at(ref ?? null)?.files.get(path);
          return content === undefined
            ? notFound("That revision does not carry the path.")
            : Response.json({ commit: ref ?? head, content, oid: blobOid(content), path });
        });
      }
      case VAULT_API_PATHS.files: {
        const request = vaultFilesRequestSchema.parse(JSON.parse(z.string().parse(init?.body)));
        requests.push(`files ${request.paths.join(",")} @${request.ref}`);
        return filesAnswer(at(request.ref), request.ref, request.paths);
      }
      case VAULT_API_PATHS.commit: {
        const request = vaultCommitRequestSchema.parse(JSON.parse(z.string().parse(init?.body)));
        requests.push(`commit ${request.changes.map(describeChange).join(",")}`);
        return commitAnswer(request);
      }
      case VAULT_API_PATHS.asset: {
        return answerPosted(vaultAssetQuerySchema, url, init, ({ path, ref }, body) => {
          requests.push(`asset ${body}`);
          const content = at(ref)?.files.get(path);
          const mediaType = assetMediaType(path);
          return content === undefined || mediaType === null
            ? notFound("That revision does not carry the path.")
            : new Response(content, { headers: { "content-type": mediaType } });
        });
      }
      default: {
        return notFound("No such route.");
      }
    }
  };

  return {
    change: (changes, device = "Mac") => {
      const files = new Map(at(null)?.files);
      for (const [changed, content] of Object.entries(changes)) {
        if (content === null) {
          files.delete(changed);
        } else {
          files.set(changed, content);
        }
      }
      return commit(files, device);
    },
    commits: () => history.size,
    fetch,
    files: () => Object.fromEntries(at(null)?.files ?? []),
    head: () => head,
    requests,
  };
};

export const clientOver = (fetch: CloudFetch): CloudClient =>
  createCloudClient({ baseUrl: "https://cloud.test", credential: `igd_${"a".repeat(64)}`, fetch });

// the network between the phone and the vault: off, or on and losing the answer to every set
// the vault applied, once
export interface Network {
  online: boolean;
  loseApplied: boolean;
}

export const networkOver =
  (vault: FakeVault, net: Network): CloudFetch =>
  async (input, init) => {
    if (!net.online) {
      throw new Error("offline");
    }
    const response = await vault.fetch(input, init);
    if (net.loseApplied && response.headers.get(APPLIED_HEADER) === "true") {
      throw new Error("the answer was lost on the way back");
    }
    return response;
  };

// the requests of one kind, in order
export const requestsOf = (
  vault: FakeVault,
  kind: "tree" | "file" | "files" | "asset" | "commit",
): string[] => vault.requests.filter((line) => line.startsWith(`${kind} `));
