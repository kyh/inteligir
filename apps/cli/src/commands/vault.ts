import { buffer } from "node:stream/consumers";
import { isDefinedError, safe } from "@orpc/client";
import {
  VAULT_HISTORY_MAX_LIMIT,
  VAULT_MAX_CONTENT_LENGTH,
  contentHashHex,
} from "@repo/api/local/vault/vault-schema";
import type {
  VaultHistoryRequest,
  VaultStatusResponse,
  VaultWriteRequest,
} from "@repo/api/local/vault/vault-schema";
import {
  ATTACHMENT_LOCATION_SPELLINGS,
  describeAttachmentLocation,
  formatAttachmentLocation,
  parseAttachmentLocation,
} from "@repo/api/local/vault/attachment-location";
import { restoreCommentStore } from "@repo/api/local/vault/restore-comment-store";
import { parseBoundedInteger } from "../args";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines, writeOut } from "../output";
import { resolveAppConfig, writeManagedVaultDir } from "../server/config";
import type { ResolveAppConfigArgs } from "../server/config";
import { resolveCheckoutRoot } from "../server/dev-instance";
import { readServerFile } from "../server/server-file";
import {
  planVaultSelection,
  resolveVaultCandidate,
  selectionRefusalMessage,
} from "../server/vault-switch";

const renderVaultStatus = (status: VaultStatusResponse): string[] => {
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
};

// `fatal` refuses invalid UTF-8 rather than substituting U+FFFD; `ignoreBOM` keeps a leading BOM as content.
// the size bound is checked here too: the server's refusal arrives only after the whole body crossed the socket.
const readContentFromStdin = async (): Promise<string> => {
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
};

const assertContentWithinBound = (content: string): void => {
  const { byteLength } = new TextEncoder().encode(content);
  if (byteLength > VAULT_MAX_CONTENT_LENGTH) {
    throw invalidUsage(
      `--content is ${byteLength} bytes; the vault refuses anything over ${VAULT_MAX_CONTENT_LENGTH}`,
    );
  }
};

interface VaultSelection {
  vaultDir: string;
  dataDir: string;
  previousVaultDir: string;
  // the server serving the previous vault, if one is up: a selection never restarts it
  running: { baseUrl: string } | null;
}

// the same plan the shell's switch runs, minus the restart: the root config.json is the selector
// `inteligir serve` reads, so the next boot is on the new vault and a running server is untouched
const selectVault = (deps: CliDeps, rawDir: string): VaultSelection => {
  const configArgs: ResolveAppConfigArgs = { checkoutPath: resolveCheckoutRoot(), env: deps.env };
  if (deps.homeDir !== undefined) {
    configArgs.homeDir = deps.homeDir;
  }
  const current = resolveAppConfig(configArgs);
  let candidate: ReturnType<typeof resolveVaultCandidate>;
  try {
    candidate = resolveVaultCandidate(configArgs, rawDir);
  } catch (error) {
    throw invalidUsage(error instanceof Error ? error.message : String(error));
  }
  const plan = planVaultSelection(current, candidate.vaultDir);
  if (plan.kind === "refused") {
    throw invalidUsage(selectionRefusalMessage(plan.reason));
  }
  writeManagedVaultDir(current.rootDataDir, candidate.vaultDir);
  const server = readServerFile(current.dataDir);
  return {
    dataDir: candidate.dataDir,
    previousVaultDir: current.vaultDir,
    running: server === null ? null : { baseUrl: `http://127.0.0.1:${String(server.port)}` },
    vaultDir: candidate.vaultDir,
  };
};

export const vaultCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Files in the vault (markdown on disk)", name: "vault" },
    subCommands: {
      attachments: defineCommand({
        args: {
          location: {
            description: ATTACHMENT_LOCATION_SPELLINGS,
            required: false,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: {
          description: "Where a pasted image lands; with no argument, print the current choice",
          name: "attachments",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          if (args.location === undefined) {
            const body = await api.vault.prefs();
            if (outputJson(args, body)) {
              return;
            }
            writeOut(`${formatAttachmentLocation(body.attachments)}\n`);
            return;
          }
          const location = parseAttachmentLocation(args.location);
          if (location === null) {
            throw invalidUsage(
              `"${args.location}" is not a location — use ${ATTACHMENT_LOCATION_SPELLINGS}`,
            );
          }
          const body = await api.vault.setPrefs({ attachments: location });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Pasted images land ${describeAttachmentLocation(body.attachments)}.`);
        },
      }),

      delete: defineCommand({
        args: {
          path: { description: "The vault-relative path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Delete a file or folder", name: "delete" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.remove({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Deleted ${args.path}`);
        },
      }),

      deleted: defineCommand({
        args: { ...jsonArg },
        meta: {
          description:
            "Docs no longer on disk, newest deletion first, with the sha that holds them",
          name: "deleted",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.deleted();
          if (outputJson(args, body)) {
            return;
          }
          if (body.entries.length === 0) {
            out.info("Nothing has been deleted.");
            return;
          }
          // sha first so `cut -f1` feeds `vault restore`.
          writeLines(
            body.entries.map((entry) => [entry.sha, entry.deletedAt, entry.path].join("\t")),
          );
        },
      }),

      history: defineCommand({
        args: {
          limit: { description: "How many revisions to answer", type: "string" },
          path: { description: "The vault-relative path", required: true, type: "positional" },
          skip: { description: "Skip this many revisions", type: "string" },
          ...jsonArg,
        },
        meta: {
          description: "List a note's commits, newest first, following renames",
          name: "history",
        },
        run: async ({ args }) => {
          const request: VaultHistoryRequest = { path: args.path };
          if (args.skip !== undefined) {
            request.skip = parseBoundedInteger(args.skip, "--skip", { min: 0 });
          }
          if (args.limit !== undefined) {
            request.limit = parseBoundedInteger(args.limit, "--limit", {
              max: VAULT_HISTORY_MAX_LIMIT,
              min: 1,
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

      list: defineCommand({
        args: {
          dir: {
            description: "Only this folder's subtree",
            required: false,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: { description: "List the vault tree (folders end with /)", name: "list" },
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
          if (outputJson(args, { entries, root: tree.root })) {
            return;
          }
          writeLines(
            entries.map((entry) => (entry.kind === "dir" ? `${entry.path}/` : entry.path)),
          );
        },
      }),

      mkdir: defineCommand({
        args: {
          path: { description: "The vault-relative path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Create a folder", name: "mkdir" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.mkdir({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Created ${body.path}/`);
        },
      }),

      open: defineCommand({
        args: {
          dir: {
            description: "Absolute path of an existing folder (a ~/ path is fine)",
            required: true,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: {
          description: "Select the vault the next `serve` boots on; a running server is untouched",
          name: "open",
        },
        run: ({ args }) => {
          const body = selectVault(deps, args.dir);
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Selected ${body.vaultDir}; the next \`inteligir serve\` boots on it.`);
          writeLines([`  data: ${body.dataDir}`]);
          if (body.running !== null) {
            out.info(
              `The server at ${body.running.baseUrl} keeps serving ${body.previousVaultDir}; restart it, or reopen Inteligir, to switch.`,
            );
          }
        },
      }),

      read: defineCommand({
        args: {
          path: { description: "The vault-relative path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Print a file's content", name: "read" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.read({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          writeOut(body.content);
        },
      }),

      rename: defineCommand({
        args: {
          from: { description: "The current path", required: true, type: "positional" },
          to: { description: "The new path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Rename/move a note; wiki links into it are rewritten",
          name: "rename",
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

      restore: defineCommand({
        args: {
          path: {
            description: "The note's path TODAY, or the path `vault deleted` lists",
            required: true,
            type: "positional",
          },
          sha: { description: "The revision's commit sha", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Put a note back to what it held at one revision",
          name: "restore",
        },
        // an ordinary guarded write of older bytes, never a server-side restore (a second write path with its own CAS):
        // checkpoint first so the replaced bytes survive as a revision, and carry the base read so a concurrent write is refused.
        run: async ({ args }) => {
          const api = apiFor(deps);
          const revision = await api.vault.revision({ path: args.path, sha: args.sha });
          await api.vault.commitNow();
          const current = await safe(api.vault.read({ path: args.path }));
          let request: VaultWriteRequest;
          if (current.error === null) {
            request = {
              content: revision.content,
              expectedHash: await contentHashHex(current.data.content),
              path: args.path,
            };
          } else if (isDefinedError(current.error) && current.error.code === "NOT_FOUND") {
            // a deleted note has no base to guard against; create-exclusively, so a note that
            // reappeared there in the meantime is refused rather than replaced.
            request = { content: revision.content, ifAbsent: true, path: args.path };
          } else {
            throw current.error;
          }
          const body = await api.vault.write(request);
          const comments =
            "ifAbsent" in request
              ? await restoreCommentStore(api, revision.content, args.sha)
              : "none";
          if (outputJson(args, { ...body, comments })) {
            return;
          }
          out.success(
            `Restored ${body.path} to ${args.sha}${comments === "restored" ? ", with its comments" : ""}`,
          );
        },
      }),

      revision: defineCommand({
        args: {
          path: {
            description: "The path AT that revision, as `vault history` reports it",
            required: true,
            type: "positional",
          },
          sha: { description: "The revision's commit sha", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Print what a note held at one revision (restore: pipe into `vault write`)",
          name: "revision",
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

      status: defineCommand({
        args: { ...jsonArg },
        meta: { description: "Git sync state (remote, dirty, conflicts)", name: "status" },
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
        args: { ...jsonArg },
        meta: { description: "Sync against the configured remote now", name: "sync" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.syncNow();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(renderVaultStatus(body));
        },
      }),

      write: defineCommand({
        args: {
          content: {
            description: "The content to write; omitted means read stdin",
            type: "string",
          },
          path: { description: "The vault-relative path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Write a file (content from --content, else stdin); parents are created",
          name: "write",
        },
        run: async ({ args }) => {
          let content: string;
          if (args.content === undefined) {
            content = await readContentFromStdin();
          } else {
            assertContentWithinBound(args.content);
            ({ content } = args);
          }
          const api = apiFor(deps);
          const body = await api.vault.write({ content, path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Wrote ${body.path}`);
        },
      }),
    },
  });
