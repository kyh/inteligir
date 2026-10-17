import {
  DEFAULT_ATTACHMENT_LOCATION,
  takesBytes,
  VAULT_ASSET_MAX_BYTES,
} from "@repo/contract/local/vault/vault-schema";
import type { VaultRenameResponse } from "@repo/contract/local/vault/vault-schema";
import { VAULT_REMOTE_PIN_ENV_VAR } from "@repo/contract/local/vault/remote-url";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { joinPath } from "@repo/notes/knowledge/vault-path";
import { attributeWrites, base, refusing } from "../orpc";
import type { AppContext } from "../orpc";
import { removeEntry } from "./remove-entry";
import { vaultWireError } from "./vault-refusals";
import { guardRefusalError } from "./write-guard";

export type RenameNote = (from: string, to: string) => Promise<VaultRenameResponse>;

const vaultRefusals = refusing(vaultWireError);

// what a byte write says of a path that takes text: a doc is written as text, and the app's own
// stores are its own
const NOT_A_FILE_MESSAGE = "a note is saved as text, not as a file";

const tree = base.vault.tree.handler(async ({ context }) => await context.vault.service.listTree());

const read = base.vault.read
  .use(vaultRefusals)
  .handler(async ({ context, input }) => await context.vault.service.read(input.path));

const history = base.vault.history.handler(async ({ context, input }) => ({
  revisions: await context.vault.git.history(input.path, {
    limit: input.limit,
    skip: input.skip,
  }),
}));

const revision = base.vault.revision.use(vaultRefusals).handler(async ({ context, input }) => ({
  content: await context.vault.git.revision(input.path, input.sha),
}));

// a stub written back through this Mac (a restore from Deleted or History) is filled as its own
// again, since the row its first fill held went with the stub
const adoptIfStub = async (context: AppContext, path: string, content: string): Promise<void> => {
  if (isItemStub(itemFactsOf(content))) {
    await context.items.adoptOwn([path]);
  }
};

const write = base.vault.write.use(vaultRefusals).handler(async ({ context, input, errors }) => {
  const { guard } = input;
  if (guard.kind === "overwrite") {
    const written = await context.vault.service.write(input.path, input.content);
    attributeWrites(context, [written.path]);
    await adoptIfStub(context, written.path, input.content);
    return written;
  }
  const result = await context.vault.service.writeGuarded(input.path, input.content, guard);
  if (!result.applied) {
    throw guardRefusalError(errors, input.path, result);
  }
  attributeWrites(context, [result.path]);
  await adoptIfStub(context, result.path, input.content);
  return { path: result.path };
});

const assetWrite = base.vault.assetWrite
  .use(vaultRefusals)
  .handler(async ({ context, input, errors }) => {
    // what lands is a file, never a doc, a highlight store or a dot-folder's own file, wherever
    // the folder is
    if (!takesBytes(input.baseName) || !takesBytes(joinPath(input.dir, input.baseName))) {
      throw errors.INVALID_PATH({ message: NOT_A_FILE_MESSAGE });
    }
    if (input.file.size > VAULT_ASSET_MAX_BYTES) {
      throw errors.PAYLOAD_TOO_LARGE({
        message: `attachment is ${input.file.size} bytes; the cap is ${VAULT_ASSET_MAX_BYTES}`,
      });
    }
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const written = await context.vault.service.writeAsset(input.dir, input.baseName, bytes);
    attributeWrites(context, [written.path]);
    return written;
  });

const rename = base.vault.rename.use(vaultRefusals).handler(async ({ context, input }) => {
  const renamed = await context.renameNote(input.from, input.to);
  attributeWrites(context, [input.from, renamed.path, ...renamed.rewritten]);
  return renamed;
});

// nothing to attribute: git tracks no empty folder, and a file written into it is its own write.
const mkdir = base.vault.mkdir
  .use(vaultRefusals)
  .handler(async ({ context, input }) => await context.vault.service.createDir(input.path));

const deleted = base.vault.deleted.handler(async ({ context }) => ({
  entries: await context.vault.git.deleted(),
}));

const remove = base.vault.remove.use(vaultRefusals).handler(async ({ context, input }) => {
  // `add -A` stages a deletion under a pathspec, a folder's included.
  attributeWrites(context, await removeEntry(context.vault.service, input.path, context.knowledge));
  return { ok: true } as const;
});

const commitNow = base.vault.commitNow.handler(async ({ context, input }) => {
  const committed = await context.vault.git.commitNow(input?.paths);
  return { files: committed?.files ?? 0 };
});

const status = base.vault.status.handler(async ({ context }) => await context.vault.git.status());

// an octet-stream Blob: nothing renders it, and the client hands it straight to createFile
const revisionBytes = base.vault.revisionBytes
  .use(vaultRefusals)
  .handler(async ({ context, input }) => {
    const bytes = await context.vault.git.revisionBytes(input.path, input.sha);
    return new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });
  });

// the byte twin of a write's `absent` guard: exactly this path, or refused
const createFile = base.vault.createFile
  .use(vaultRefusals)
  .handler(async ({ context, input, errors }) => {
    if (!takesBytes(input.path)) {
      throw errors.INVALID_PATH({ message: NOT_A_FILE_MESSAGE });
    }
    if (input.file.size > VAULT_ASSET_MAX_BYTES) {
      throw errors.PAYLOAD_TOO_LARGE({
        message: `${input.path} is ${String(input.file.size)} bytes; the cap is ${String(VAULT_ASSET_MAX_BYTES)}`,
      });
    }
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const written = await context.vault.service.writeBytesGuarded(input.path, bytes, {
      kind: "absent",
    });
    if (!written.applied) {
      throw errors.ALREADY_EXISTS({ message: `A file already exists at ${input.path}` });
    }
    attributeWrites(context, [written.path]);
    return { path: written.path };
  });

const syncNow = base.vault.syncNow.handler(
  async ({ context }) => await context.vault.git.syncNow(),
);

// the new remote's first pass is kicked, never awaited: the answer is the choice, and the pass
// announces its own progress on the bus.
const setRemote = base.vault.setRemote.handler(async ({ context, input, errors }) => {
  if ((await context.vault.git.setOrigin(input)) === "pinned") {
    throw errors.CONFLICT({
      message: `${VAULT_REMOTE_PIN_ENV_VAR} pins this vault's remote; unset it to choose another`,
    });
  }
  void context.vault.git.syncNow();
  return await context.vault.git.status();
});

const prefs = base.vault.prefs.handler(({ context }) => ({
  attachments: context.vaultPrefs.read().attachments ?? DEFAULT_ATTACHMENT_LOCATION,
}));

// a folder that is a file today would refuse every paste; refused here, once, instead.
const setPrefs = base.vault.setPrefs.handler(async ({ context, input, errors }) => {
  if (input.attachments.kind === "folder") {
    const existing = await context.vault.service.statEntry(input.attachments.path);
    if (existing === "file") {
      throw errors.INVALID_PATH({ message: `${input.attachments.path} is a file, not a folder` });
    }
  }
  context.vaultPrefs.write({ ...context.vaultPrefs.read(), attachments: input.attachments });
  return { attachments: input.attachments };
});

export const vaultRouter = {
  assetWrite,
  commitNow,
  createFile,
  deleted,
  history,
  mkdir,
  prefs,
  read,
  remove,
  rename,
  revision,
  revisionBytes,
  setPrefs,
  setRemote,
  status,
  syncNow,
  tree,
  write,
};
