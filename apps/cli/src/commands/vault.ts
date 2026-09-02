import { buffer } from "node:stream/consumers";
import {
  VAULT_HISTORY_MAX_LIMIT,
  VAULT_MAX_CONTENT_LENGTH,
  contentHashHex,
  type VaultHistoryRequest,
  type VaultStatusResponse,
} from "@repo/api/local/vault/vault-schema";
import { parseBoundedInteger } from "../args";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines, writeOut } from "../output";

function renderVaultStatus(status: VaultStatusResponse): string[] {
  const lines = [`state: ${status.state}`];
  if (status.state !== "no-remote") {
    lines.push(`remote: ${status.remote}`);
  }
  lines.push(
    `last sync: ${status.lastSyncAt === null ? "never" : new Date(status.lastSyncAt).toISOString()}`,
  );
  if (status.lastError !== null) {
    lines.push(`last error: ${status.lastError}`);
  }
  if (status.state === "conflict") {
    lines.push(
      `conflict: ${status.conflict.ours.commits} local vs ${status.conflict.theirs.commits} remote commits`,
      ...status.conflict.files.map((file) => `  both changed: ${file}`),
    );
  }
  return lines;
}

// `fatal` refuses invalid UTF-8 rather than substituting U+FFFD; `ignoreBOM` keeps a leading BOM as content.
// the size bound is checked here too: the server's refusal arrives only after the whole body crossed the socket.
async function readContentFromStdin(): Promise<string> {
  const bytes = await buffer(process.stdin);
  if (bytes.byteLength > VAULT_MAX_CONTENT_LENGTH) {
    throw invalidUsage(
      `stdin is ${bytes.byteLength} bytes; the vault refuses anything over ${VAULT_MAX_CONTENT_LENGTH}`,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw invalidUsage("stdin is not valid UTF-8; vault files are text");
  }
}

function assertContentWithinBound(content: string): void {
  const byteLength = new TextEncoder().encode(content).byteLength;
  if (byteLength > VAULT_MAX_CONTENT_LENGTH) {
    throw invalidUsage(
      `--content is ${byteLength} bytes; the vault refuses anything over ${VAULT_MAX_CONTENT_LENGTH}`,
    );
  }
}

export function vaultCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "vault", description: "Files in the vault (markdown on disk)" },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "List the vault tree (folders end with /)" },
        args: {
          dir: {
            type: "positional",
            required: false,
            description: "Only this folder's subtree",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const tree = await api.vault.tree();
          const prefix = args.dir?.replace(/\/+$/u, "");
          const entries =
            prefix === undefined || prefix.length === 0
              ? tree.entries
              : tree.entries.filter(
                  (entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`),
                );
          if (outputJson(args, { root: tree.root, entries })) {
            return;
          }
          writeLines(
            entries.map((entry) => (entry.kind === "dir" ? `${entry.path}/` : entry.path)),
          );
        },
      }),

      read: defineCommand({
        meta: { name: "read", description: "Print a file's content" },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.read({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          writeOut(body.content);
        },
      }),

      history: defineCommand({
        meta: {
          name: "history",
          description: "List a note's commits, newest first, following renames",
        },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          skip: { type: "string", description: "Skip this many revisions" },
          limit: { type: "string", description: "How many revisions to answer" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const request: VaultHistoryRequest = { path: args.path };
          if (args.skip !== undefined) {
            request.skip = parseBoundedInteger(args.skip, "--skip", { min: 0 });
          }
          if (args.limit !== undefined) {
            request.limit = parseBoundedInteger(args.limit, "--limit", {
              min: 1,
              max: VAULT_HISTORY_MAX_LIMIT,
            });
          }
          const api = apiFor(deps);
          const body = await api.vault.history(request);
          if (outputJson(args, body)) {
            return;
          }
          // sha first so `cut -f1` feeds `vault revision`; the path is per revision because --follow crosses renames.
          writeLines(
            body.revisions.map((revision) =>
              [
                revision.sha,
                revision.authoredAt,
                revision.authorName,
                revision.path,
                revision.subject,
              ].join("\t"),
            ),
          );
        },
      }),

      revision: defineCommand({
        meta: {
          name: "revision",
          description: "Print what a note held at one revision (restore: pipe into `vault write`)",
        },
        args: {
          path: {
            type: "positional",
            required: true,
            description: "The path AT that revision, as `vault history` reports it",
          },
          sha: { type: "positional", required: true, description: "The revision's commit sha" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.revision({ path: args.path, sha: args.sha });
          if (outputJson(args, body)) {
            return;
          }
          writeOut(body.content);
        },
      }),

      restore: defineCommand({
        meta: {
          name: "restore",
          description: "Put a note back to what it held at one revision",
        },
        args: {
          path: { type: "positional", required: true, description: "The note's path TODAY" },
          sha: { type: "positional", required: true, description: "The revision's commit sha" },
          ...jsonArg,
        },
        // an ordinary guarded write of older bytes, never a server-side restore (a second write path with its own CAS):
        // checkpoint first so the replaced bytes survive as a revision, and carry the base read so a concurrent write is refused.
        run: async ({ args }) => {
          const api = apiFor(deps);
          const revision = await api.vault.revision({ path: args.path, sha: args.sha });
          await api.vault.commitNow();
          const current = await api.vault.read({ path: args.path });
          const body = await api.vault.write({
            path: args.path,
            content: revision.content,
            expectedHash: await contentHashHex(current.content),
          });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Restored ${body.path} to ${args.sha}`);
        },
      }),

      write: defineCommand({
        meta: {
          name: "write",
          description: "Write a file (content from --content, else stdin); parents are created",
        },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          content: {
            type: "string",
            description: "The content to write; omitted means read stdin",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          let content: string;
          if (args.content === undefined) {
            content = await readContentFromStdin();
          } else {
            assertContentWithinBound(args.content);
            content = args.content;
          }
          const api = apiFor(deps);
          const body = await api.vault.write({ path: args.path, content });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Wrote ${body.path}`);
        },
      }),

      rename: defineCommand({
        meta: {
          name: "rename",
          description: "Rename/move a note; wiki links into it are rewritten",
        },
        args: {
          from: { type: "positional", required: true, description: "The current path" },
          to: { type: "positional", required: true, description: "The new path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.rename({ from: args.from, to: args.to });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Renamed ${args.from} -> ${body.path}`);
          writeLines([
            ...body.rewritten.map((rewritten) => `  rewrote links in ${rewritten}`),
            ...body.skipped.map((skipped) => `  skipped ${skipped.path} (${skipped.reason})`),
          ]);
        },
      }),

      delete: defineCommand({
        meta: { name: "delete", description: "Delete a file or folder" },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.remove({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Deleted ${args.path}`);
        },
      }),

      mkdir: defineCommand({
        meta: { name: "mkdir", description: "Create a folder" },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.mkdir({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Created ${body.path}/`);
        },
      }),

      status: defineCommand({
        meta: { name: "status", description: "Git sync state (remote, dirty, conflicts)" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.status();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(renderVaultStatus(body));
        },
      }),

      sync: defineCommand({
        meta: { name: "sync", description: "Sync against the configured remote now" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.syncNow();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(renderVaultStatus(body));
        },
      }),
    },
  });
}
