// the hosted vault's read routes as the Worker answers them, over an in-memory history of commits:
// oids are git's own blob hash, so equal bytes share one as they do there. `requests` logs each
// call as "tree <query>", "file <query>", "files <paths joined by ,> @<ref>" or "asset <query>".

import { createHash } from "node:crypto";
import { createCloudClient } from "@repo/api/cloud/client";
import type { CloudClient, CloudFetch } from "@repo/api/cloud/client";
import {
  assetMediaType,
  VAULT_API_PATHS,
  vaultFilesRequestSchema,
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

export interface FakeVault {
  requests: string[];
  fetch: CloudFetch;
  head: () => string;
  // a new head: the current files with these changes, null deleting a path
  change: (changes: Record<string, string | null>) => string;
}

export const createFakeVault = (
  initial: Record<string, string>,
  options: { pageSize?: number } = {},
): FakeVault => {
  const pageSize = options.pageSize ?? 2;
  const history = new Map<string, ReadonlyMap<string, string>>();
  let head = "";
  const requests: string[] = [];

  const commit = (files: ReadonlyMap<string, string>): string => {
    head = commitSha(history.size + 1);
    history.set(head, files);
    return head;
  };
  commit(new Map(Object.entries(initial)));

  const at = (ref: string | null): Revision | null => {
    const sha = ref ?? head;
    const files = history.get(sha);
    return files === undefined ? null : { files, sha };
  };

  const fetch: CloudFetch = async (input, init) => {
    const url = new URL(input);
    const ref = url.searchParams.get("ref");
    const path = url.searchParams.get("path") ?? "";
    switch (url.pathname) {
      case VAULT_API_PATHS.tree: {
        requests.push(`tree ${url.search}`);
        const revision = at(ref);
        return revision === null
          ? notFound("That revision is not in the vault.")
          : treePage(revision, url.searchParams.get("after"), pageSize);
      }
      case VAULT_API_PATHS.file: {
        requests.push(`file ${url.search}`);
        const content = at(ref)?.files.get(path);
        return content === undefined
          ? notFound("That revision does not carry the path.")
          : Response.json({ commit: ref ?? head, content, oid: blobOid(content), path });
      }
      case VAULT_API_PATHS.files: {
        const request = vaultFilesRequestSchema.parse(JSON.parse(z.string().parse(init?.body)));
        requests.push(`files ${request.paths.join(",")} @${request.ref}`);
        return filesAnswer(at(request.ref), request.ref, request.paths);
      }
      case VAULT_API_PATHS.asset: {
        requests.push(`asset ${url.search}`);
        const content = at(ref)?.files.get(path);
        const mediaType = assetMediaType(path);
        return content === undefined || mediaType === null
          ? notFound("That revision does not carry the path.")
          : new Response(content, { headers: { "content-type": mediaType } });
      }
      default: {
        return notFound("No such route.");
      }
    }
  };

  return {
    change: (changes) => {
      const files = new Map(at(null)?.files);
      for (const [changed, content] of Object.entries(changes)) {
        if (content === null) {
          files.delete(changed);
        } else {
          files.set(changed, content);
        }
      }
      return commit(files);
    },
    fetch,
    head: () => head,
    requests,
  };
};

export const clientOver = (fetch: CloudFetch): CloudClient =>
  createCloudClient({ baseUrl: "https://cloud.test", credential: `igd_${"a".repeat(64)}`, fetch });

// the requests of one kind, in order
export const requestsOf = (vault: FakeVault, kind: "tree" | "file" | "files" | "asset"): string[] =>
  vault.requests.filter((line) => line.startsWith(`${kind} `));
