import {
  assetMediaType,
  DEFAULT_ATTACHMENT_LOCATION,
  VAULT_ASSET_MAX_BYTES,
  VAULT_HISTORY_DEFAULT_LIMIT,
} from "@repo/api/local/vault/vault-schema";
import type { VaultRenameResponse } from "@repo/api/local/vault/vault-schema";
import { removeEntryWithComments } from "../comments/remove-with-comments";
import { base, refusals } from "../orpc";
import { vaultWireError } from "./vault-refusals";
import type { GuardedWriteGuard } from "./vault-service";

export type RenameNote = (from: string, to: string) => Promise<VaultRenameResponse>;

const refusing = refusals(vaultWireError);

const tree = base.vault.tree.handler(async ({ context }) => await context.vault.service.listTree());

const read = base.vault.read.handler(
  async ({ context, input }) =>
    await refusing(async () => await context.vault.service.read(input.path)),
);

const history = base.vault.history.handler(async ({ context, input }) => ({
  revisions: await context.vault.git.history(input.path, {
    limit: input.limit ?? VAULT_HISTORY_DEFAULT_LIMIT,
    skip: input.skip ?? 0,
  }),
}));

const revision = base.vault.revision.handler(
  async ({ context, input }) =>
    await refusing(async () => ({
      content: await context.vault.git.revision(input.path, input.sha),
    })),
);

const write = base.vault.write.handler(
  async ({ context, input, errors }) =>
    await refusing(async () => {
      if (input.expectedHash === undefined && input.ifAbsent === undefined) {
        return await context.vault.service.write(input.path, input.content);
      }
      const guard: GuardedWriteGuard =
        input.expectedHash === undefined
          ? { ifAbsent: true }
          : { expectedHash: input.expectedHash };
      const result = await context.vault.service.writeGuarded(input.path, input.content, guard);
      if (result.applied) {
        return { path: result.path };
      }
      if (result.reason === "exists") {
        throw errors.ALREADY_EXISTS({ message: `A file already exists at ${input.path}` });
      }
      // the client merges current with diff3 and retries; current is absent when the file is gone.
      throw errors.CAS_MISMATCH({
        data: result.current === null ? {} : { current: result.current },
        message: `${input.path} changed since the base this write was derived from`,
      });
    }),
);

const assetWrite = base.vault.assetWrite.handler(async ({ context, input, errors }) => {
  if (assetMediaType(input.baseName) === null) {
    throw errors.INVALID_PATH({
      message: `${input.baseName} is not an image type this vault serves`,
    });
  }
  const byteLength = Math.floor((input.bytesBase64.length * 3) / 4);
  if (byteLength > VAULT_ASSET_MAX_BYTES) {
    throw errors.PAYLOAD_TOO_LARGE({
      message: `attachment is ~${byteLength} bytes; the cap is ${VAULT_ASSET_MAX_BYTES}`,
    });
  }
  const bytes = new Uint8Array(Buffer.from(input.bytesBase64, "base64"));
  return await refusing(
    async () => await context.vault.service.writeAsset(input.dir, input.baseName, bytes),
  );
});

const rename = base.vault.rename.handler(
  async ({ context, input }) =>
    await refusing(async () => await context.renameNote(input.from, input.to)),
);

const mkdir = base.vault.mkdir.handler(
  async ({ context, input }) =>
    await refusing(async () => await context.vault.service.createDir(input.path)),
);

const deleted = base.vault.deleted.handler(async ({ context }) => ({
  entries: await context.vault.git.deleted(),
}));

const remove = base.vault.remove.handler(
  async ({ context, input }) =>
    await refusing(async () => {
      await removeEntryWithComments(context.vault.service, input.path);
      return { ok: true } as const;
    }),
);

const commitNow = base.vault.commitNow.handler(async ({ context }) => {
  const committed = await context.vault.git.commitNow();
  return { files: committed?.files ?? 0 };
});

const status = base.vault.status.handler(async ({ context }) => await context.vault.status());

const syncNow = base.vault.syncNow.handler(async ({ context }) => await context.vault.syncNow());

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
  deleted,
  history,
  mkdir,
  prefs,
  read,
  remove,
  rename,
  revision,
  setPrefs,
  status,
  syncNow,
  tree,
  write,
};
